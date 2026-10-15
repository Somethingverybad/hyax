import { WebSocketService } from "@/services/websocket";
import { t } from "@/lib/i18n";
import { myDeviceId } from "./deviceId";

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
  /** webrtc_media: собеседник включил или выключил камеру. */
  video?: boolean;
};

/** Видео и шумодав в звонке — для экрана звонка (CallHost). */
export type CallMedia = {
  /** Моя камера (поток для превью) или null. */
  localVideo: MediaStream | null;
  /** Собеседник показывает видео. */
  remoteVideo: boolean;
  /** У собеседника новая версия: можно включить видео (по его SDP). */
  peerCanVideo: boolean;
  /** Камер больше одной — есть что переключать. */
  canFlip: boolean;
  /** Фронтальная камера — превью зеркалим. */
  front: boolean;
  noiseSuppression: boolean;
  /** Моя камера включена (в приложении потока в JS нет — только флаг). */
  localOn: boolean;
  /** Видео рисует нативный движок под страницей (приложение). */
  native?: boolean;
  /** Шумодав переключается (пока только в браузере). */
  canNoise?: boolean;
};

const NS_KEY = "hyax:call-noise-suppression";
const readNs = () => { try { return localStorage.getItem(NS_KEY) !== "0"; } catch { return true; } };

/** Есть ли видеоканал «отправка и приём» в SDP собеседника — значит, у него
 *  новая версия с видео. Приложения на телефонах пока отвечают без видео. */
export function sdpCanVideo(sdp?: string): boolean {
  if (!sdp) return false;
  const parts = sdp.split(/\r?\nm=/);
  const video = parts.find((p, i) => (i === 0 ? p.startsWith("m=video") : p.startsWith("video")));
  if (!video) return false;
  if (/^(m=)?video 0 /.test(video)) return false;
  return /a=sendrecv/.test(video) || !/a=(sendonly|recvonly|inactive)/.test(video);
}

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
  onMedia?: (media: CallMedia) => void;
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
  private onMedia?: (media: CallMedia) => void;

  private peerConnection: RTCPeerConnection | null = null;
  // Видео: канал есть с начала звонка, камера включается заменой дорожки —
  // без пересогласования. Собеседник узнаёт о камере сигналом webrtc_media.
  private videoTransceiver: RTCRtpTransceiver | null = null;
  private localVideoTrack: MediaStream | null = null;
  private front = true;
  private videoDeviceIdx = 0;
  private canFlip = false;
  private remoteVideo = false;
  private peerCanVideo = false;
  private noiseSuppression = readNs();
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private currentCallId: string | null = null;
  private targetUserId: string | null = null;
  /** Собеседник текущего звонка (входящего или исходящего). */
  getPeerId(): string | null { return this.targetUserId; }
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
    this.onMedia = options.onMedia;
  }

  // ===== Видео и шумодав =====

  getMedia(): CallMedia {
    return {
      localVideo: this.localVideoTrack,
      remoteVideo: this.remoteVideo,
      peerCanVideo: this.peerCanVideo,
      canFlip: this.canFlip,
      front: this.front,
      noiseSuppression: this.noiseSuppression,
      localOn: !!this.localVideoTrack,
      canNoise: true,
    };
  }

  private emitMedia(): void {
    this.onMedia?.(this.getMedia());
  }

  /** Включить или выключить камеру. Нет разрешения — бросает ошибку с
   *  name NotAllowedError: экран звонка подскажет, где его дать; при
   *  следующем нажатии разрешение запрашивается снова. */
  async setVideo(on: boolean): Promise<void> {
    const sender = this.videoTransceiver?.sender;
    if (!sender) return;
    if (on) {
      if (this.localVideoTrack) return;
      const stream = await this.openCamera();
      this.localVideoTrack = stream;
      await sender.replaceTrack(stream.getVideoTracks()[0] || null);
    } else {
      await sender.replaceTrack(null).catch(() => {});
      this.stopLocalVideo();
    }
    this.sendMedia();
    this.emitMedia();
  }

  /** Другая камера: на телефоне — передняя/задняя, на компьютере — следующая. */
  async flipCamera(): Promise<void> {
    const sender = this.videoTransceiver?.sender;
    if (!sender || !this.localVideoTrack) return;
    const old = this.localVideoTrack;
    this.front = !this.front;
    this.videoDeviceIdx += 1;
    try {
      const stream = await this.openCamera();
      await sender.replaceTrack(stream.getVideoTracks()[0] || null);
      this.localVideoTrack = stream;
      old.getTracks().forEach((t) => t.stop());
    } catch (e) {
      this.front = !this.front;
      this.videoDeviceIdx -= 1;
      throw e;
    }
    this.emitMedia();
  }

  private async openCamera(): Promise<MediaStream> {
    // Сначала по стороне (телефон), камеры компьютера — по списку устройств.
    const devices = (await navigator.mediaDevices.enumerateDevices?.().catch(() => [])) || [];
    const cams = devices.filter((d) => d.kind === "videoinput");
    const byDevice = cams.length > 1 && cams.every((c) => c.label) && !/android|iphone|ipad/i.test(navigator.userAgent);
    const video: MediaTrackConstraints = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
    if (byDevice) video.deviceId = { exact: cams[this.videoDeviceIdx % cams.length].deviceId };
    else video.facingMode = this.front ? "user" : "environment";
    const stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    // Список с названиями камер есть только после разрешения — пересчитываем.
    const after = (await navigator.mediaDevices.enumerateDevices?.().catch(() => [])) || [];
    this.canFlip = after.filter((d) => d.kind === "videoinput").length > 1;
    if (byDevice) {
      const label = stream.getVideoTracks()[0]?.label || "";
      this.front = !/back|rear|environment|задн/i.test(label);
    }
    return stream;
  }

  private stopLocalVideo(): void {
    this.localVideoTrack?.getTracks().forEach((t) => t.stop());
    this.localVideoTrack = null;
  }

  private sendMedia(): void {
    if (!this.currentCallId) return;
    this.wsService.send({
      type: "webrtc_media",
      data: { chat_id: this.chatId, call_id: this.currentCallId, to_user_id: this.targetUserId, video: !!this.localVideoTrack },
    });
  }

  /** Шумоподавление микрофона: настройка запоминается; в идущем звонке
   *  микрофон переоткрывается с новым параметром и дорожка подменяется на
   *  лету, без пересогласования (выключенный микрофон остаётся выключенным). */
  async setNoiseSuppression(on: boolean): Promise<void> {
    this.noiseSuppression = on;
    try { localStorage.setItem(NS_KEY, on ? "1" : "0"); } catch { /* приватный режим */ }
    const old = this.localStream?.getAudioTracks()[0];
    const sender = this.peerConnection?.getSenders().find((x) => x.track?.kind === "audio");
    if (old && this.localStream) {
      const fresh = await navigator.mediaDevices.getUserMedia({ audio: this.audioConstraints(), video: false });
      const track = fresh.getAudioTracks()[0];
      if (track) {
        track.enabled = old.enabled;
        if (sender) await sender.replaceTrack(track);
        this.localStream.removeTrack(old);
        this.localStream.addTrack(track);
        old.stop();
      }
    }
    this.emitMedia();
  }

  private audioConstraints(): MediaTrackConstraints {
    return { echoCancellation: true, noiseSuppression: this.noiseSuppression, autoGainControl: true };
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
      fromUsername: data.fromUsername || t("Неизвестный"),
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
      this.onError?.(t("Не удалось получить доступ к микрофону"));
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
          device_id: myDeviceId(),
        },
      });
    } catch {
      this.onError?.(t("Не удалось получить доступ к микрофону"));
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
        device_id: myDeviceId(),
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
        fromUsername: data.from_username || t("Неизвестный"),
        fromUserAvatar: data.from_user_avatar,
        callType: data.call_type || "audio",
      });
      return;
    }

    if (!this.currentCallId || callId !== this.currentCallId) {
      return;
    }
    // Пока здесь не ответили, медиасигналы звонящего не наши: он шлёт их на
    // все мои устройства, а ответить должно только то, где приняли звонок.
    if (this.state === "incoming" && signalType.startsWith("webrtc_")) return;

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
      case "webrtc_media":
        this.remoteVideo = !!data.video;
        this.emitMedia();
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
      audio: this.audioConstraints(),
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
      // Звук и видео приходят отдельными дорожками — собираем их в один
      // поток (раньше видео заменило бы звук).
      const incoming = event.streams?.[0]?.getTracks() ?? [event.track];
      const kinds = new Set(incoming.map((t) => t.kind));
      const keep = (this.remoteStream?.getTracks() || []).filter((t) => !kinds.has(t.kind));
      this.remoteStream = new MediaStream([...keep, ...incoming]);
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
        // Камеру могли включить, пока звонок ещё звонил, — тот сигнал
        // собеседник пропустил (до ответа медиасигналы не принимаются).
        if (this.localVideoTrack) this.sendMedia();
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
    // Видеоканал звонящего — сразу, пустой: камера потом подставляется в него.
    // Отвечающий берёт канал из предложения (handleOffer).
    if (this.isCaller && this.localStream) {
      this.videoTransceiver = this.peerConnection.addTransceiver("video", { direction: "sendrecv", streams: [this.localStream] });
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
      // Видеоканал из предложения: отвечаем «и отправляю, и принимаю», чтобы
      // потом включить камеру без пересогласования. Старые клиенты и
      // приложения шлют предложение без видео — тогда видео не будет.
      this.peerCanVideo = sdpCanVideo(offer.sdp);
      const vt = this.peerConnection.getTransceivers().find((x) => x.receiver.track?.kind === "video");
      if (vt && this.peerCanVideo) {
        vt.direction = "sendrecv";
        if (this.localStream) vt.sender.setStreams?.(this.localStream);
        this.videoTransceiver = vt;
      }
      this.emitMedia();
      
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
      this.onError?.(t("Не удалось обработать входящий звонок"));
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
      this.peerCanVideo = sdpCanVideo(answer.sdp);
      this.emitMedia();
    } catch (error) {
      console.error('❌ [CallService.handleAnswer] Ошибка:', error);
      this.onError?.(t("Не удалось установить ответ звонка"));
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
      this.onError?.(t("Не удалось добавить ICE-кандидат"));
    }
  }

  /** Отдать живое соединение групповому сервису (добор участников): ничего
   *  не закрываем и не сообщаем об окончании — звонок продолжается. */
  detach(): { callId: string; chatId: string; peerId: string; pc: RTCPeerConnection; localStream: MediaStream | null; remoteStream: MediaStream | null } | null {
    if (!this.peerConnection || !this.currentCallId || !this.targetUserId) return null;
    // Групповой звонок пока без видео: камеру выключаем.
    this.videoTransceiver?.sender.replaceTrack(null).catch(() => {});
    this.resetMedia();
    const out = {
      callId: this.currentCallId, chatId: this.chatId, peerId: this.targetUserId,
      pc: this.peerConnection, localStream: this.localStream, remoteStream: this.remoteStream,
    };
    this.peerConnection = null;
    this.localStream = null;
    this.remoteStream = null;
    this.currentCallId = null;
    this.targetUserId = null;
    this.isCaller = false;
    this.setState("idle");
    return out;
  }

  private finishCall(reason: CallEndReason): void {
    this.cleanupPeerConnection();
    this.cleanupLocalStream();
    this.resetMedia();
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

  private resetMedia(): void {
    this.stopLocalVideo();
    this.videoTransceiver = null;
    this.remoteVideo = false;
    this.peerCanVideo = false;
    this.front = true;
    this.videoDeviceIdx = 0;
    this.canFlip = false;
    this.emitMedia();
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
