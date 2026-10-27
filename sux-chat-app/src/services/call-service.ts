import { WebSocketService } from "@/services/websocket";
import { getMicSettings, micConstraints, micKey, onMicSettings, setMicSettings, swapMicTrack } from "@/lib/micSettings";
import { t } from "@/lib/i18n";
import { openCallCamera } from "@/lib/callCamera";
import { openCallMic } from "@/lib/callMic";
import { myDeviceId } from "./deviceId";

type CallType = "audio" | "video";
export type CallState = "idle" | "outgoing" | "incoming" | "connecting" | "active";
type CallEndReason = "rejected" | "ended" | "missed" | "failed";
// Потеря пути в звонке: сколько ждать восстановления, через сколько инициатор
// перезапускает ICE после «disconnected», сколько рестартов на одну потерю.
const LINK_LOST_MS = 15000;
const ICE_RESTART_DELAY_MS = 3000;
const ICE_RESTARTS_MAX = 2;

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
  /** webrtc_media: собеседник транслирует звонок в OBS. */
  obs?: boolean;
  /** webrtc_media: собеседник показывает экран. call_accept: отвечающий
   *  умеет смотреть демонстрацию — звонящий заведёт под неё второй канал. */
  screen?: boolean;
  /** webrtc_media: у собеседника нет микрофона (говорит одна сторона, отвечает в чате). */
  nomic?: boolean;
};

/** Видео и шумодав в звонке — для экрана звонка (CallHost). */
export type CallMedia = {
  /** Моя камера (поток для превью) или null. */
  localVideo: MediaStream | null;
  /** Собеседник показывает видео. */
  remoteVideo: boolean;
  /** У собеседника новая версия: можно включить видео (по его SDP). */
  peerCanVideo: boolean;
  /** SDP собеседника уже пришёл — до этого (пока звонок звонит) про видео
   *  ничего не известно, и камеру можно включить заранее. */
  peerKnown: boolean;
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
  /** Собеседник транслирует звонок в OBS (сигнал webrtc_media, поле obs). */
  peerObs?: boolean;
  /** Я показываю экран. */
  screenOn?: boolean;
  /** Экран можно показать: здесь есть захват экрана (компьютер), а у
   *  собеседника — канал под демонстрацию (веб или программа с новой версией). */
  canScreen?: boolean;
  /** Здесь захват экрана есть, но собеседник демонстрацию не увидит (телефон, старая версия). */
  screenUnavailable?: boolean;
  /** Демонстрация собеседника — отдельным потоком (камера остаётся своей). */
  remoteScreen?: MediaStream | null;
  /** Приложение: собеседник показывает экран — картинку рисует нативный
   *  движок (окно `${peerId}#screen`), потока в JS нет. */
  remoteScreenOn?: boolean;
  /** Мой микрофон не открылся — меня не слышно (lib/callMic). */
  micMissing?: boolean;
  micMissingReason?: string;
  /** У собеседника нет микрофона. */
  peerNoMic?: boolean;
};

/** Захват экрана есть: браузер на компьютере или программа WYX. На телефонах
 *  getDisplayMedia нет (мобильные браузеры, приложения) — показать экран оттуда
 *  пока нельзя, смотреть можно. */
export const canCaptureScreen = (): boolean => {
  if (typeof navigator === "undefined" || typeof navigator.mediaDevices?.getDisplayMedia !== "function") return false;
  // Программа WYX до этой версии выбора экрана не умеет — getDisplayMedia там отклоняется.
  const ea = typeof window !== "undefined" ? window.electronAPI : undefined;
  return !ea || typeof ea.onScreenPick === "function";
};

/** Захватить экран для звонка: частота кадров невысокая, приоритет — чёткость
 *  текста. На компьютере выбор экрана или окна — у браузера или окна WYX
 *  (electron/main.cjs, ScreenPicker). */
export async function openScreenCapture(): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 } }, audio: false });
  const track = stream.getVideoTracks()[0];
  if (!track) { stream.getTracks().forEach((t) => t.stop()); throw new DOMException("no video", "NotFoundError"); }
  try { track.contentHint = "detail"; } catch { /* старый браузер */ }
  return stream;
}

/** Канал демонстрации: битрейт повыше и разрешение не жертвуем ради кадров. */
export async function tuneScreenSender(sender: RTCRtpSender): Promise<void> {
  try {
    const p = sender.getParameters();
    if (!p.encodings?.length) p.encodings = [{}];
    p.encodings[0].maxBitrate = 2_500_000;
    p.encodings[0].maxFramerate = 15;
    (p as RTCRtpSendParameters & { degradationPreference?: string }).degradationPreference = "maintain-resolution";
    await sender.setParameters(p);
  } catch { /* не везде поддерживается — пусть решает браузер */ }
}

/** Канал демонстрации — второй видеоканал соединения (первый — камера). */
export const isScreenTransceiver = (pc: RTCPeerConnection, tr: RTCRtpTransceiver | null | undefined): boolean => {
  if (!tr) return false;
  const vids = pc.getTransceivers().filter((x) => x.receiver.track?.kind === "video");
  return vids.length > 1 && vids.indexOf(tr) === 1;
};

/** Видео личного звонка, который стал групповым (GroupCallService.adopt). */
export type AdoptedVideo = {
  transceiver: RTCRtpTransceiver | null;
  cam: MediaStream | null;
  remoteVideo: boolean;
  canVideo: boolean;
  known: boolean;
  front: boolean;
  deviceIdx: number;
  canFlip: boolean;
};


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
  private peerKnown = false;
  /** Параметры, с которыми открыт микрофон (micKey): поменялись — переоткрываем. */
  /** Я транслирую звонок в OBS — собеседник узнаёт об этом сигналом webrtc_media. */
  private broadcasting = false;
  private peerObs = false;
  // Демонстрация экрана: второй видеоканал, как у камеры, — пустой с начала
  // звонка, экран подставляется заменой дорожки. Заводится, только если обе
  // стороны его понимают (call_accept со screen, два видеоканала в
  // предложении): приложение на телефоне приняло бы его за камеру.
  private screenTransceiver: RTCRtpTransceiver | null = null;
  /** Свой поток демонстрации (у второго канала — свой msid, не как у микрофона). */
  private screenOut: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private peerCanScreen = false;
  private remoteScreen = false;
  private remoteScreenStream: MediaStream | null = null;
  private micOpenedWith = "";
  /** Микрофон не открылся — в соединении тихая дорожка (lib/callMic). */
  private micMissing = false;
  private micMissingReason: string | undefined;
  private peerNoMic = false;
  /** Подмены микрофона — по очереди: две разом остановили бы не ту дорожку. */
  private micChain: Promise<void> = Promise.resolve();
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private currentCallId: string | null = null;
  private targetUserId: string | null = null;
  /** Собеседник текущего звонка (входящего или исходящего). */
  getPeerId(): string | null { return this.targetUserId; }
  private isCaller = false;
  // Потеря пути: «disconnected» — переходное (сменилась сеть, провал на
  // мобильном), «failed» — ICE сдался. Раньше вешали трубку сразу, и любой
  // секундный провал связи заканчивал звонок. Теперь инициатор делает
  // ICE-рестарт (новые кандидаты, в том числе через TURN), отвечающий ждёт его
  // предложение; не восстановилось за LINK_LOST_MS — завершаем.
  private linkLostTimer: ReturnType<typeof setTimeout> | null = null;
  private iceRestartTimer: ReturnType<typeof setTimeout> | null = null;
  private iceRestarts = 0;
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
    // Настройки → Микрофон поменяли посреди разговора — применяем сразу.
    onMicSettings(() => { void this.applyMicSettings().catch(() => {}); this.emitMedia(); });
  }

  // ===== Видео и шумодав =====

  getMedia(): CallMedia {
    return {
      localVideo: this.localVideoTrack,
      remoteVideo: this.remoteVideo,
      peerCanVideo: this.peerCanVideo,
      peerKnown: this.peerKnown,
      canFlip: this.canFlip,
      front: this.front,
      noiseSuppression: getMicSettings().noiseSuppression,
      localOn: !!this.localVideoTrack,
      canNoise: true,
      peerObs: this.peerObs,
      screenOn: !!this.screenStream,
      canScreen: canCaptureScreen() && !!this.screenTransceiver,
      screenUnavailable: canCaptureScreen() && this.peerKnown && !this.screenTransceiver,
      remoteScreen: this.remoteScreen ? this.remoteScreenStream : null,
      micMissing: this.micMissing,
      micMissingReason: this.micMissingReason,
      peerNoMic: this.peerNoMic,
    };
  }

  /** Показать экран или перестать. Отмена в окне выбора — NotAllowedError
   *  (экран звонка промолчит). Демонстрацию можно закончить и кнопкой браузера
   *  «Прекратить доступ» — тогда дорожка завершается сама. */
  async setScreen(on: boolean): Promise<void> {
    const sender = this.screenTransceiver?.sender;
    if (on) {
      if (this.screenStream || !sender) return;
      const stream = await openScreenCapture();
      const track = stream.getVideoTracks()[0];
      track.addEventListener("ended", () => { if (this.screenStream === stream) void this.setScreen(false); });
      this.screenStream = stream;
      await sender.replaceTrack(track);
      await tuneScreenSender(sender);
    } else {
      if (!this.screenStream) return;
      await sender?.replaceTrack(null).catch(() => {});
      this.stopScreen();
    }
    this.sendMedia();
    this.emitMedia();
  }

  private stopScreen(): void {
    this.screenStream?.getTracks().forEach((t) => t.stop());
    this.screenStream = null;
  }

  private emitMedia(): void {
    this.onMedia?.(this.getMedia());
  }

  /** Включить или выключить камеру. Нет разрешения — бросает ошибку с
   *  name NotAllowedError: экран звонка подскажет, где его дать; при
   *  следующем нажатии разрешение запрашивается снова. */
  async setVideo(on: boolean): Promise<void> {
    // Канала может ещё не быть (звонок звонит) — тогда камера подставится,
    // когда он появится (ensurePeerConnection / handleOffer).
    const sender = this.videoTransceiver?.sender;
    if (on) {
      if (this.localVideoTrack) return;
      const stream = await this.openCamera();
      this.localVideoTrack = stream;
      if (sender) await sender.replaceTrack(stream.getVideoTracks()[0] || null);
    } else {
      if (sender) await sender.replaceTrack(null).catch(() => {});
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
    const r = await openCallCamera({ front: this.front, deviceIdx: this.videoDeviceIdx });
    this.canFlip = r.canFlip;
    this.front = r.front;
    return r.stream;
  }

  private stopLocalVideo(): void {
    this.localVideoTrack?.getTracks().forEach((t) => t.stop());
    this.localVideoTrack = null;
  }

  private sendMedia(): void {
    if (!this.currentCallId) return;
    this.wsService.send({
      type: "webrtc_media",
      data: { chat_id: this.chatId, call_id: this.currentCallId, to_user_id: this.targetUserId, video: !!this.localVideoTrack, obs: this.broadcasting, screen: !!this.screenStream, nomic: this.micMissing },
    });
  }

  /** Мой микрофон (для трансляции в OBS); нет звонка — null. */
  getLocalStream(): MediaStream | null { return this.localStream; }

  /** Трансляция в OBS включена — собеседник увидит пометку на экране звонка. */
  setBroadcasting(on: boolean): void {
    if (this.broadcasting === on) return;
    this.broadcasting = on;
    this.sendMedia();
  }

  /** Шумоподавление из экрана звонка: это та же настройка, что в
   *  «Настройки → Микрофон»; идущий звонок переоткрывает микрофон. */
  async setNoiseSuppression(on: boolean): Promise<void> {
    setMicSettings({ noiseSuppression: on });
    await this.applyMicSettings();
    this.emitMedia();
  }

  /** Переоткрыть микрофон, если настройки разошлись с теми, с которыми он открыт. */
  private applyMicSettings(): Promise<void> {
    const key = micKey();
    if (!this.localStream || this.micMissing || this.micOpenedWith === key) return this.micChain;
    this.micOpenedWith = key;
    this.micChain = this.micChain.catch(() => {}).then(() => {
      if (this.localStream) return swapMicTrack(this.localStream, this.peerConnection ? [this.peerConnection] : []);
    });
    return this.micChain;
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
          // Смотреть демонстрацию умеем — звонящий заведёт под неё канал.
          screen: true,
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
    if (this.micMissing) return true; // микрофона нет — включать нечего
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
          this.peerCanScreen = !!data.screen;
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
        this.peerObs = !!data.obs;
        this.remoteScreen = !!data.screen;
        this.peerNoMic = !!data.nomic;
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
    if (this.micMissing) return true;
    const track = this.localStream?.getAudioTracks()[0];
    return track ? !track.enabled : false;
  }

  private async ensureLocalAudioStream(): Promise<void> {
    if (this.localStream) {
      return;
    }

    this.micOpenedWith = micKey();
    // Не открылся микрофон — звонок всё равно идёт, без голоса (lib/callMic).
    const mic = await openCallMic(micConstraints());
    this.localStream = mic.stream;
    this.micMissing = mic.missing;
    this.micMissingReason = mic.reason;
    this.emitMedia();
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
      // Демонстрация собеседника — своим потоком, не вместо его камеры.
      if (this.peerConnection && event.track.kind === "video" && isScreenTransceiver(this.peerConnection, event.transceiver)) {
        this.remoteScreenStream = new MediaStream([event.track]);
        this.emitMedia();
        return;
      }
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
        this.clearLinkLost();
        this.iceRestarts = 0;
        this.setState("active");
        // Камеру могли включить, пока звонок ещё звонил, — тот сигнал
        // собеседник пропустил (до ответа медиасигналы не принимаются).
        if (this.localVideoTrack || this.screenStream || this.micMissing) this.sendMedia();
      }
      if (state === "closed") {
        console.error("❌ [CallService] Соединение закрыто");
        this.finishCall("failed");
      }
      if (state === "failed" || state === "disconnected") this.onLinkLost(state);
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
      // Камеру могли включить, пока звонок звонил, — сразу с ней.
      const cam = this.localVideoTrack?.getVideoTracks()[0];
      this.videoTransceiver = this.peerConnection.addTransceiver(cam ?? "video", { direction: "sendrecv", streams: [this.localStream] });
      if (this.peerCanScreen) {
        this.screenOut = new MediaStream();
        this.screenTransceiver = this.peerConnection.addTransceiver("video", { direction: "sendrecv", streams: [this.screenOut] });
      }
    }
  }

  private onLinkLost(state: "failed" | "disconnected"): void {
    console.warn(`⚠️ [CallService] Соединение ${state} — ждём восстановления`);
    if (!this.linkLostTimer) {
      this.linkLostTimer = setTimeout(() => {
        this.linkLostTimer = null;
        if (this.peerConnection && this.peerConnection.connectionState !== "connected") {
          console.error("❌ [CallService] Связь не восстановилась");
          this.finishCall("failed");
        }
      }, LINK_LOST_MS);
    }
    // Предложения в этой схеме делает только инициатор — он и перезапускает
    // ICE: при «failed» сразу, при «disconnected» — дав пару секунд
    // восстановиться самому.
    if (!this.isCaller || this.iceRestartTimer) return;
    this.iceRestartTimer = setTimeout(() => {
      this.iceRestartTimer = null;
      const st = this.peerConnection?.connectionState;
      if (st && st !== "connected" && st !== "closed") void this.restartIce();
    }, state === "failed" ? 0 : ICE_RESTART_DELAY_MS);
  }

  private async restartIce(): Promise<void> {
    const pc = this.peerConnection;
    if (!pc || !this.currentCallId || this.iceRestarts >= ICE_RESTARTS_MAX) return;
    this.iceRestarts += 1;
    console.log(`🔁 [CallService] ICE-рестарт ${this.iceRestarts}`);
    try {
      pc.restartIce?.();
      const offer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(offer);
      this.wsService.send({
        type: "webrtc_offer",
        data: { chat_id: this.chatId, call_id: this.currentCallId, to_user_id: this.targetUserId, offer },
      });
    } catch (e) {
      console.error("❌ [CallService] ICE-рестарт не удался:", e);
    }
  }

  private clearLinkLost(): void {
    if (this.linkLostTimer) { clearTimeout(this.linkLostTimer); this.linkLostTimer = null; }
    if (this.iceRestartTimer) { clearTimeout(this.iceRestartTimer); this.iceRestartTimer = null; }
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
      this.peerKnown = true;
      const vt = this.peerConnection.getTransceivers().find((x) => x.receiver.track?.kind === "video");
      if (vt && this.peerCanVideo) {
        vt.direction = "sendrecv";
        if (this.localStream) vt.sender.setStreams?.(this.localStream);
        this.videoTransceiver = vt;
        const cam = this.localVideoTrack?.getVideoTracks()[0];
        if (cam) await vt.sender.replaceTrack(cam);
      } else if (this.localVideoTrack) {
        // Камеру включили заранее, а у собеседника версия без видео.
        this.stopLocalVideo();
      }
      // Второй видеоканал — под демонстрацию экрана (звонящий завёл его,
      // потому что мы в call_accept сказали, что умеем её смотреть).
      const vids = this.peerConnection.getTransceivers().filter((x) => x.receiver.track?.kind === "video");
      if (this.peerCanVideo && vids.length > 1 && !this.screenTransceiver) {
        const st = vids[1];
        st.direction = "sendrecv";
        this.screenOut = new MediaStream();
        st.sender.setStreams?.(this.screenOut);
        this.screenTransceiver = st;
        this.peerCanScreen = true;
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
      this.peerKnown = true;
      if (!this.peerCanVideo && this.localVideoTrack) {
        // Камеру включили, пока звонил, а у собеседника версия без видео.
        await this.videoTransceiver?.sender.replaceTrack(null).catch(() => {});
        this.stopLocalVideo();
      }
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
  detach(): { callId: string; chatId: string; peerId: string; pc: RTCPeerConnection; localStream: MediaStream | null; remoteStream: MediaStream | null; video: AdoptedVideo; micMissing?: boolean; micMissingReason?: string } | null {
    if (!this.peerConnection || !this.currentCallId || !this.targetUserId) return null;
    // Камера и видеоканал переходят в групповой звонок как есть.
    const video: AdoptedVideo = {
      transceiver: this.videoTransceiver, cam: this.localVideoTrack, remoteVideo: this.remoteVideo,
      canVideo: this.peerCanVideo, known: this.peerKnown, front: this.front, deviceIdx: this.videoDeviceIdx, canFlip: this.canFlip,
    };
    this.localVideoTrack = null;
    // Демонстрацию в групповой звонок не переносим: там свой порядок каналов.
    void this.screenTransceiver?.sender.replaceTrack(null).catch(() => {});
    this.stopScreen();
    this.resetMedia();
    const out = {
      callId: this.currentCallId, chatId: this.chatId, peerId: this.targetUserId,
      pc: this.peerConnection, localStream: this.localStream, remoteStream: this.remoteStream, video,
      micMissing: this.micMissing, micMissingReason: this.micMissingReason,
    };
    this.micMissing = false;
    this.micMissingReason = undefined;
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
    this.clearLinkLost();
    this.iceRestarts = 0;
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
    this.micMissing = false;
    this.micMissingReason = undefined;
    if (!this.localStream) {
      return;
    }
    this.localStream.getTracks().forEach((track) => track.stop());
    this.localStream = null;
  }

  private resetMedia(): void {
    this.stopLocalVideo();
    this.stopScreen();
    this.screenTransceiver = null;
    this.screenOut = null;
    this.peerCanScreen = false;
    this.remoteScreen = false;
    this.remoteScreenStream = null;
    this.peerNoMic = false;
    this.videoTransceiver = null;
    this.remoteVideo = false;
    this.peerObs = false;
    this.broadcasting = false;
    this.peerCanVideo = false;
    this.peerKnown = false;
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
