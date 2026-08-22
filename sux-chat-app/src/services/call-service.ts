import { WebSocketService } from "@/services/websocket";

type CallType = "audio" | "video";
export type CallState = "idle" | "outgoing" | "incoming" | "connecting" | "active";
type CallEndReason = "rejected" | "ended" | "missed" | "failed";

export type IncomingCall = {
  callId: string;
  chatId: string;
  fromUserId: string;
  fromUsername: string;
  fromUserAvatar?: string;
  callType: CallType;
};

type SignalData = {
  call_id?: string;
  chat_id?: string;
  from_user_id?: string;
  from_username?: string;
  from_user_avatar?: string;
  to_user_id?: string;
  call_type?: CallType;
  offer?: RTCSessionDescriptionInit;
  answer?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  status?: string;
};

type CallServiceOptions = {
  wsService: WebSocketService;
  chatId: string;
  userId: string;
  iceServers: RTCIceServer[];
  onStateChange?: (state: CallState) => void;
  onIncomingCall?: (incomingCall: IncomingCall) => void;
  onRemoteStream?: (stream: MediaStream) => void;
  onCallEnded?: (reason: CallEndReason) => void;
  onError?: (message: string) => void;
};

export class OneToOneCallService {
  private wsService: WebSocketService;
  private chatId: string;
  private userId: string;
  private iceServers: RTCIceServer[];
  private onStateChange?: (state: CallState) => void;
  private onIncomingCall?: (incomingCall: IncomingCall) => void;
  private onRemoteStream?: (stream: MediaStream) => void;
  private onCallEnded?: (reason: CallEndReason) => void;
  private onError?: (message: string) => void;

  private peerConnection: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private currentCallId: string | null = null;
  private targetUserId: string | null = null;
  private isCaller = false;
  private state: CallState = "idle";

  constructor(options: CallServiceOptions) {
    this.wsService = options.wsService;
    this.chatId = options.chatId;
    this.userId = options.userId;
    this.iceServers = options.iceServers;
    this.onStateChange = options.onStateChange;
    this.onIncomingCall = options.onIncomingCall;
    this.onRemoteStream = options.onRemoteStream;
    this.onCallEnded = options.onCallEnded;
    this.onError = options.onError;
  }
  
  // Обновление chatId при переключении чата (для глобального Call Service)
  updateChatId(newChatId: string): void {
    this.chatId = newChatId;
    console.log(`📞 [CallService] Chat ID обновлен: ${newChatId}`);
  }

  /** Уведомить о входящем звонке (вызывается из Chat при получении notification) */
  notifyIncomingCall(data: {
    callId: string;
    chatId: string;
    fromUserId: string;
    fromUsername: string;
    fromUserAvatar?: string;
    callType?: CallType;
  }): void {
    this.currentCallId = data.callId;
    this.targetUserId = data.fromUserId;
    this.chatId = data.chatId;
    this.isCaller = false;
    this.setState("incoming");
    this.onIncomingCall?.({
      callId: data.callId,
      chatId: data.chatId,
      fromUserId: data.fromUserId,
      fromUsername: data.fromUsername || "Неизвестный",
      fromUserAvatar: data.fromUserAvatar,
      callType: data.callType || "audio",
    });
  }

  async startOutgoingCall(targetUserId: string): Promise<void> {
    console.log('📞 [CallService.startOutgoingCall] Вызван с параметрами:', {
      targetUserId,
      currentState: this.state,
      chatId: this.chatId,
      userId: this.userId,
    });
    
    if (!targetUserId) {
      console.error('❌ [CallService] targetUserId не указан');
      return;
    }
    
    if (this.state !== "idle") {
      console.error(`❌ [CallService] Состояние не idle (текущее: ${this.state})`);
      return;
    }

    try {
      console.log('📞 [CallService] Получение доступа к микрофону...');
      await this.ensureLocalAudioStream();
      console.log('✅ [CallService] Микрофон получен');
      
      this.currentCallId = this.generateCallId();
      this.targetUserId = targetUserId;
      this.isCaller = true;
      this.setState("outgoing");

      const payload = {
        type: "call_invite",
        data: {
          chat_id: this.chatId,
          call_id: this.currentCallId,
          to_user_id: targetUserId,
          call_type: "audio",
        },
      };
      
      console.log('📞 [CallService] Отправка call_invite через WebSocket:', payload);
      this.wsService.send(payload);
      console.log('✅ [CallService] call_invite отправлен');
    } catch (error) {
      console.error('❌ [CallService] Ошибка при звонке:', error);
      this.onError?.("Не удалось получить доступ к микрофону");
      this.cleanupLocalStream();
      this.resetState();
    }
  }

  async acceptIncomingCall(callId: string, fromUserId: string): Promise<void> {
    console.log('📞 [CallService.acceptIncomingCall] Принимаем звонок:', { callId, fromUserId });
    if (!callId || !fromUserId) {
      console.error('❌ [CallService.acceptIncomingCall] Неверные параметры');
      return;
    }

    try {
      console.log('📞 [CallService.acceptIncomingCall] Получаем доступ к микрофону...');
      await this.ensureLocalAudioStream();
      console.log('✅ [CallService.acceptIncomingCall] Микрофон получен');
      
      this.currentCallId = callId;
      this.targetUserId = fromUserId;
      this.isCaller = false;
      this.setState("connecting");

      console.log('📞 [CallService.acceptIncomingCall] Отправляем call_accept');
      this.wsService.send({
        type: "call_accept",
        data: {
          chat_id: this.chatId,
          call_id: callId,
          to_user_id: fromUserId,
        },
      });
    } catch {
      this.onError?.("Не удалось получить доступ к микрофону");
      this.cleanupLocalStream();
      this.resetState();
    }
  }

  rejectIncomingCall(callId: string, fromUserId: string): void {
    if (!callId || !fromUserId) {
      return;
    }

    this.wsService.send({
      type: "call_reject",
      data: {
        chat_id: this.chatId,
        call_id: callId,
        to_user_id: fromUserId,
      },
    });

    this.finishCall("rejected");
  }

  endCall(status: "ended" | "missed" | "failed" = "ended", notify = true): void {
    if (notify && this.currentCallId) {
      this.wsService.send({
        type: "call_end",
        data: {
          chat_id: this.chatId,
          call_id: this.currentCallId,
          to_user_id: this.targetUserId,
          status,
        },
      });
    }

    this.finishCall(status);
  }

  toggleMute(): boolean {
    if (!this.localStream) {
      return false;
    }

    const tracks = this.localStream.getAudioTracks();
    if (tracks.length === 0) {
      return false;
    }

    const willBeMuted = tracks[0].enabled;
    tracks.forEach((track) => {
      track.enabled = !willBeMuted;
    });

    return willBeMuted;
  }

  async handleSignal(signalType: string, data: SignalData): Promise<void> {
    console.log(`📞 [CallService.handleSignal] Получен сигнал: ${signalType}`, {
      chatId: data.chat_id,
      currentChatId: this.chatId,
      callId: data.call_id,
      fromUserId: data.from_user_id,
    });
    
    if (!data) return;

    const callId = data.call_id || null;
    const fromUserId = data.from_user_id || null;

    if (fromUserId === this.userId) {
      console.log('ℹ️ [CallService.handleSignal] Пропускаем (от нас самих)');
      return;
    }

    // call_invite принимаем всегда (даже если смотрим другой чат) — обновляем chatId
    if (signalType === "call_invite" && callId && fromUserId && data.chat_id) {
      if (data.chat_id !== this.chatId) {
        this.chatId = data.chat_id;
        console.log(`📞 [CallService] chatId обновлен для входящего звонка: ${this.chatId}`);
      }
      if (this.state !== "idle") {
        this.wsService.send({
          type: "call_reject",
          data: {
            chat_id: this.chatId,
            call_id: callId,
            to_user_id: fromUserId,
          },
        });
        return;
      }

      this.currentCallId = callId;
      this.targetUserId = fromUserId;
      this.isCaller = false;
      this.setState("incoming");
      
      console.log('📞 Входящий звонок, данные:', data);
      
      this.onIncomingCall?.({
        callId,
        chatId: data.chat_id || this.chatId,
        fromUserId,
        fromUsername: data.from_username || "Неизвестный",
        fromUserAvatar: data.from_user_avatar,
        callType: data.call_type || "audio",
      });
      return;
    }

    if (!this.currentCallId || callId !== this.currentCallId) {
      return;
    }

    switch (signalType) {
      case "call_accept":
        console.log('📞 [CallService.handleSignal] Обработка call_accept, isCaller:', this.isCaller);
        if (this.isCaller) {
          this.setState("connecting");
          await this.ensurePeerConnection();
          await this.createAndSendOffer();
        }
        break;
      case "call_reject":
        console.log('📞 [CallService.handleSignal] Обработка call_reject');
        this.finishCall("rejected");
        break;
      case "call_end":
        console.log('📞 [CallService.handleSignal] Обработка call_end');
        this.finishCall((data.status as CallEndReason) || "ended");
        break;
      case "webrtc_offer":
        console.log('📞 [CallService.handleSignal] Обработка webrtc_offer');
        await this.handleOffer(data.offer);
        break;
      case "webrtc_answer":
        console.log('📞 [CallService.handleSignal] Обработка webrtc_answer');
        await this.handleAnswer(data.answer);
        break;
      case "webrtc_ice_candidate":
        console.log('📞 [CallService.handleSignal] Обработка webrtc_ice_candidate');
        await this.handleIceCandidate(data.candidate);
        break;
      default:
        console.log(`⚠️ [CallService.handleSignal] Неизвестный тип сигнала: ${signalType}`);
        break;
    }
  }

  dispose(): void {
    this.endCall("ended", false);
  }

  getCurrentCallId(): string | null {
    return this.currentCallId;
  }

  getState(): CallState {
    return this.state;
  }

  isMuted(): boolean {
    const track = this.localStream?.getAudioTracks()[0];
    return track ? !track.enabled : false;
  }

  private async ensureLocalAudioStream(): Promise<void> {
    if (this.localStream) {
      return;
    }

    this.localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
  }

  private async ensurePeerConnection(): Promise<void> {
    if (this.peerConnection) {
      console.log('ℹ️ [CallService] PeerConnection уже существует');
      return;
    }

    console.log('📞 [CallService] Создание PeerConnection с ICE серверами:', this.iceServers);
    this.peerConnection = new RTCPeerConnection({
      iceServers: this.iceServers,
    });

    // Поток отдаём только с готовой дорожкой и каждый раз новым объектом:
    // WebKit (iOS) не начинает играть дорожки, добавленные в MediaStream уже
    // после присвоения в srcObject — раньше туда уходил пустой поток, и
    // разговор был беззвучным.
    this.peerConnection.ontrack = (event) => {
      console.log('🎵 [CallService] Получен удалённый трек:', event.track.kind);
      const tracks = event.streams?.[0]?.getTracks() ?? [event.track];
      this.remoteStream = new MediaStream(tracks);
      this.onRemoteStream?.(this.remoteStream);
      this.setState("active");
    };

    this.peerConnection.onicecandidate = (event) => {
      if (!event.candidate || !this.currentCallId) {
        console.log('ℹ️ [CallService] ICE gathering завершён (пустой кандидат)');
        return;
      }

      console.log('🧊 [CallService] Отправка ICE кандидата');
      this.wsService.send({
        type: "webrtc_ice_candidate",
        data: {
          chat_id: this.chatId,
          call_id: this.currentCallId,
          to_user_id: this.targetUserId,
          candidate: event.candidate,
        },
      });
    };

    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection?.connectionState;
      console.log(`🔌 [CallService] Connection state: ${state}`);
      if (state === "connected") {
        this.setState("active");
      }
      if (state === "failed" || state === "disconnected" || state === "closed") {
        console.error(`❌ [CallService] Соединение ${state}`);
        this.finishCall("failed");
      }
    };

    if (this.localStream) {
      const tracks = this.localStream.getTracks();
      console.log(`📤 [CallService] Добавление локальных треков: ${tracks.length}`);
      tracks.forEach((track) => {
        console.log(`  - Трек: ${track.kind}, enabled: ${track.enabled}`);
        this.peerConnection?.addTrack(track, this.localStream as MediaStream);
      });
    } else {
      console.error('❌ [CallService] Нет локального потока для добавления треков!');
    }
  }

  private async createAndSendOffer(): Promise<void> {
    console.log('📞 [CallService.createAndSendOffer] Создание offer');
    if (!this.peerConnection || !this.currentCallId) {
      console.error('❌ [CallService.createAndSendOffer] Нет PeerConnection или callId');
      return;
    }
    if (this.peerConnection.localDescription) {
      console.log('ℹ️ [CallService.createAndSendOffer] Local description уже установлен');
      return;
    }

    const offer = await this.peerConnection.createOffer();
    console.log('✅ [CallService.createAndSendOffer] Offer создан:', offer.type);
    await this.peerConnection.setLocalDescription(offer);
    console.log('✅ [CallService.createAndSendOffer] Local description установлен');

    console.log('📤 [CallService.createAndSendOffer] Отправка offer через WebSocket');
    this.wsService.send({
      type: "webrtc_offer",
      data: {
        chat_id: this.chatId,
        call_id: this.currentCallId,
        to_user_id: this.targetUserId,
        offer,
      },
    });
  }

  private async handleOffer(offer?: RTCSessionDescriptionInit): Promise<void> {
    console.log('📞 [CallService.handleOffer] Получен offer, isCaller:', this.isCaller);
    if (!offer || this.isCaller) {
      console.log('ℹ️ [CallService.handleOffer] Пропускаем (нет offer или мы инициатор)');
      return;
    }

    try {
      console.log('📞 [CallService.handleOffer] Получаем локальный поток...');
      await this.ensureLocalAudioStream();
      console.log('📞 [CallService.handleOffer] Создаём PeerConnection...');
      await this.ensurePeerConnection();
      if (!this.peerConnection) {
        console.error('❌ [CallService.handleOffer] Не удалось создать PeerConnection');
        return;
      }

      console.log('📞 [CallService.handleOffer] Устанавливаем remote description');
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
      console.log('✅ [CallService.handleOffer] Remote description установлен');
      
      console.log('📞 [CallService.handleOffer] Создаём answer');
      const answer = await this.peerConnection.createAnswer();
      console.log('✅ [CallService.handleOffer] Answer создан');
      await this.peerConnection.setLocalDescription(answer);
      console.log('✅ [CallService.handleOffer] Local description установлен');

      console.log('📤 [CallService.handleOffer] Отправляем answer через WebSocket');
      this.wsService.send({
        type: "webrtc_answer",
        data: {
          chat_id: this.chatId,
          call_id: this.currentCallId,
          to_user_id: this.targetUserId,
          answer,
        },
      });
    } catch {
      this.onError?.("Не удалось обработать входящий звонок");
      this.finishCall("failed");
    }
  }

  private async handleAnswer(answer?: RTCSessionDescriptionInit): Promise<void> {
    console.log('📞 [CallService.handleAnswer] Получен answer, isCaller:', this.isCaller);
    if (!answer || !this.peerConnection || !this.isCaller) {
      console.log('ℹ️ [CallService.handleAnswer] Пропускаем (нет answer/PC или мы не инициатор)');
      return;
    }

    try {
      console.log('📞 [CallService.handleAnswer] Устанавливаем remote description');
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
      console.log('✅ [CallService.handleAnswer] Remote description установлен');
    } catch (error) {
      console.error('❌ [CallService.handleAnswer] Ошибка:', error);
      this.onError?.("Не удалось установить ответ звонка");
      this.finishCall("failed");
    }
  }

  private async handleIceCandidate(candidate?: RTCIceCandidateInit): Promise<void> {
    console.log('🧊 [CallService.handleIceCandidate] Получен ICE кандидат');
    if (!candidate || !this.peerConnection) {
      console.log('ℹ️ [CallService.handleIceCandidate] Пропускаем (нет candidate или PC)');
      return;
    }

    try {
      await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      console.log('✅ [CallService.handleIceCandidate] ICE кандидат добавлен');
    } catch (error) {
      console.error('❌ [CallService.handleIceCandidate] Ошибка:', error);
      this.onError?.("Не удалось добавить ICE-кандидат");
    }
  }

  private finishCall(reason: CallEndReason): void {
    this.cleanupPeerConnection();
    this.cleanupLocalStream();
    this.currentCallId = null;
    this.targetUserId = null;
    this.isCaller = false;
    this.setState("idle");
    this.onCallEnded?.(reason);
  }

  private cleanupPeerConnection(): void {
    if (this.peerConnection) {
      this.peerConnection.ontrack = null;
      this.peerConnection.onicecandidate = null;
      this.peerConnection.onconnectionstatechange = null;
      this.peerConnection.close();
      this.peerConnection = null;
    }
    this.remoteStream = null;
  }

  private cleanupLocalStream(): void {
    if (!this.localStream) {
      return;
    }
    this.localStream.getTracks().forEach((track) => track.stop());
    this.localStream = null;
  }

  private resetState(): void {
    this.currentCallId = null;
    this.targetUserId = null;
    this.isCaller = false;
    this.setState("idle");
  }

  private setState(nextState: CallState): void {
    this.state = nextState;
    this.onStateChange?.(nextState);
  }

  private generateCallId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}
