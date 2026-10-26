import { WebSocketService } from "@/services/websocket";
import { micConstraints, micKey, onMicSettings, swapMicTrack } from "@/lib/micSettings";
import { t as tr } from "@/lib/i18n";
import { openCallCamera } from "@/lib/callCamera";
import type { AudioLevels } from "@/lib/nativeCall";
import { canCaptureScreen, isScreenTransceiver, openScreenCapture, sdpCanVideo, tuneScreenSender, type AdoptedVideo } from "./call-service";
import { myDeviceId } from "./deviceId";

export type GroupCallState = "idle" | "outgoing" | "incoming" | "active";

export type GroupCallInvite = {
  callId: string;
  chatId: string;
  fromUserId: string;
  fromUsername: string;
  chatName: string;
};

/** Поток участника вместе с его id — UI рисует громкость по каждому. */
export type PeerStream = { peerId: string; stream: MediaStream };

/** Что известно о медиа участника: камера, микрофон, умеет ли видео. */
export type GroupPeerMedia = {
  /** Камера включена (сигнал webrtc_media). */
  video: boolean;
  /** Микрофон выключен. */
  muted: boolean;
  /** В соединении есть видеоканал (по SDP) — версия с видео. */
  canVideo: boolean;
  /** SDP уже пришёл: canVideo достоверно. */
  known: boolean;
  /** Соединение поднялось. */
  connected: boolean;
  /** Участник транслирует звонок в OBS (сигнал webrtc_media, поле obs). */
  obs?: boolean;
  /** Участник показывает экран (webrtc_media, поле screen). */
  screen?: boolean;
  /** Участник умеет смотреть демонстрацию (webrtc_media rx_screen: веб и
   *  программа WYX; приложения на телефонах — нет). */
  rxScreen?: boolean;
};

export type GroupMedia = {
  /** Своя камера (поток для превью) — в браузере; в приложении null. */
  localVideo: MediaStream | null;
  localOn: boolean;
  front: boolean;
  canFlip: boolean;
  /** Видео рисует нативный движок под страницей (приложение). */
  native?: boolean;
  peers: Record<string, GroupPeerMedia>;
  /** Я показываю экран. */
  screenOn?: boolean;
  /** Показать экран можно: здесь есть захват, а кто-то из участников его увидит. */
  canScreen?: boolean;
  /** Захват есть, но никто из участников экран не увидит (телефоны, старые версии). */
  screenUnavailable?: boolean;
};

export const emptyPeerMedia = (): GroupPeerMedia => ({ video: false, muted: false, canVideo: false, known: false, connected: false });

type Options = {
  wsService: WebSocketService;
  userId: string;
  iceServers: RTCIceServer[];
  onStateChange?: (state: GroupCallState) => void;
  onIncoming?: (invite: GroupCallInvite) => void;
  onStreams?: (streams: PeerStream[]) => void;
  onPeers?: (peerIds: string[]) => void;
  onMedia?: (media: GroupMedia) => void;
  /** Демонстрации экрана участников — отдельными потоками (не вместо камеры). */
  onScreens?: (streams: PeerStream[]) => void;
  onError?: (message: string) => void;
};

/**
 * Групповой звонок по схеме mesh: каждый участник держит отдельное
 * соединение с каждым. Для небольших компаний это проще и честнее сервера
 * микширования — звук и видео идут напрямую, без промежуточного узла.
 *
 * Кто кому шлёт offer, решает сравнение идентификаторов: инициирует тот,
 * чей id меньше. Иначе оба бросаются навстречу, и соединение не сходится.
 *
 * Видео — как в личном звонке: в каждом соединении с начала есть пустой
 * видеоканал, камера (одна на всех) подставляется заменой дорожки, без
 * пересогласования; о камере и микрофоне участники узнают сигналом
 * webrtc_media.
 */
export class GroupCallService {
  private ws: WebSocketService;
  private userId: string;
  private iceServers: RTCIceServer[];
  private cb: Options;

  private peers = new Map<string, RTCPeerConnection>();
  private streams = new Map<string, MediaStream>();
  private localStream: MediaStream | null = null;
  /** Параметры, с которыми открыт микрофон (micKey), и очередь его подмен. */
  private micOpenedWith = "";
  private micChain: Promise<void> = Promise.resolve();
  /** Я транслирую звонок в OBS — участники узнают сигналом webrtc_media. */
  private broadcasting = false;
  private callId: string | null = null;
  private chatId: string | null = null;
  private state: GroupCallState = "idle";

  private cam: MediaStream | null = null;
  private front = true;
  private deviceIdx = 0;
  private canFlip = false;
  private videoTx = new Map<string, RTCRtpTransceiver>();
  private peerMedia = new Map<string, GroupPeerMedia>();
  // Демонстрация экрана: второй видеоканал в соединении с каждым, кто умеет
  // её смотреть (rx_screen). Заводит его участник с меньшим id — тот же, кто
  // шлёт предложения, — сразу, как узнал о собеседнике, одним
  // пересогласованием; показ потом — только замена дорожки. Встречных
  // предложений нет — и столкновения тоже. Приложениям на телефонах канал не
  // заводим: они приняли бы его за камеру.
  private screen: MediaStream | null = null;
  private screenTx = new Map<string, RTCRtpTransceiver>();
  /** Свой поток демонстрации — msid отдельный от микрофона и камеры. */
  private screenOut: MediaStream | null = null;
  private screens = new Map<string, MediaStream>();

  constructor(options: Options) {
    this.ws = options.wsService;
    this.userId = options.userId;
    this.iceServers = options.iceServers;
    this.cb = options;
    // Настройки → Микрофон поменяли посреди разговора — применяем сразу.
    onMicSettings(() => { void this.applyMicSettings().catch(() => {}); });
  }

  /** Переоткрыть микрофон с новыми настройками и подменить дорожку во всех соединениях. */
  private applyMicSettings(): Promise<void> {
    const key = micKey();
    if (!this.localStream || this.micOpenedWith === key) return this.micChain;
    this.micOpenedWith = key;
    this.micChain = this.micChain.catch(() => {}).then(() => {
      if (this.localStream) return swapMicTrack(this.localStream, this.peers.values());
    });
    return this.micChain;
  }

  getState() {
    return this.state;
  }

  getCallId() {
    return this.callId;
  }

  getPeers(): string[] {
    return [...this.peers.keys()];
  }

  /** Позвать ещё людей в идущий звонок (сервер разошлёт им вызов). */
  addParticipants(userIds: string[]): void {
    if (!this.callId || !userIds.length) return;
    this.send("call_add", { user_ids: userIds });
  }

  /** Личный звонок стал групповым: забираем готовое соединение из
   *  OneToOneCallService, не пересобирая его — разговор не прерывается,
   *  камера тоже. */
  adopt(input: { callId: string; chatId: string; peerId: string; pc: RTCPeerConnection; localStream: MediaStream | null; remoteStream: MediaStream | null; video?: AdoptedVideo }): void {
    this.callId = input.callId;
    this.chatId = input.chatId;
    this.localStream = input.localStream;
    // Микрофон открыт личным звонком с теми же настройками.
    this.micOpenedWith = micKey();
    const pc = input.pc;
    const id = input.peerId;
    this.peers.set(id, pc);
    if (input.remoteStream) this.streams.set(id, input.remoteStream);
    const v = input.video;
    if (v) {
      this.cam = v.cam;
      this.front = v.front;
      this.deviceIdx = v.deviceIdx;
      this.canFlip = v.canFlip;
      if (v.transceiver) this.videoTx.set(id, v.transceiver);
    }
    // Канал демонстрации, если личный звонок его завёл, — тот же.
    const vids = pc.getTransceivers().filter((x) => x.receiver.track?.kind === "video");
    if (vids.length > 1) this.screenTx.set(id, vids[1]);
    this.peerMedia.set(id, { ...emptyPeerMedia(), video: !!v?.remoteVideo, canVideo: !!v?.canVideo, known: v ? v.known : true, connected: true });
    this.wire(id, pc);
    this.setState("active");
    this.cb.onPeers?.([id]);
    this.emitStreams();
    this.emitMedia();
  }

  /** Мой микрофон (для трансляции в OBS); нет звонка — null. */
  getLocalStream(): MediaStream | null { return this.localStream; }

  /** Трансляция в OBS включена — участники увидят пометку на экране звонка. */
  setBroadcasting(on: boolean): void {
    if (this.broadcasting === on) return;
    this.broadcasting = on;
    this.broadcastMedia();
  }

  isMuted(): boolean {
    const track = this.localStream?.getAudioTracks()[0];
    return track ? !track.enabled : false;
  }

  toggleMute(): boolean {
    const tracks = this.localStream?.getAudioTracks() ?? [];
    if (!tracks.length) return false;
    const willMute = tracks[0].enabled;
    tracks.forEach((t) => (t.enabled = !willMute));
    this.broadcastMedia();
    return willMute;
  }

  // ===== Видео =====

  getMedia(): GroupMedia {
    const peers = [...this.peerMedia.values()];
    const viewers = peers.some((m) => m.rxScreen);
    return {
      localVideo: this.cam,
      localOn: !!this.cam,
      front: this.front,
      canFlip: this.canFlip,
      peers: Object.fromEntries(this.peerMedia),
      screenOn: !!this.screen,
      canScreen: canCaptureScreen() && viewers,
      screenUnavailable: canCaptureScreen() && peers.length > 0 && !viewers && peers.every((m) => m.connected),
    };
  }

  /** Показать экран всем, кто умеет его смотреть, или перестать. Отмена в
   *  окне выбора — NotAllowedError (экран звонка промолчит). */
  async setScreen(on: boolean): Promise<void> {
    if (on) {
      if (this.screen || this.state === "idle") return;
      const stream = await openScreenCapture();
      // Пока выбирали экран, звонок могли завершить.
      if (this.getState() === "idle") { stream.getTracks().forEach((t) => t.stop()); return; }
      stream.getVideoTracks()[0].addEventListener("ended", () => { if (this.screen === stream) void this.setScreen(false); });
      this.screen = stream;
      await Promise.all([...this.screenTx.keys()].map((id) => this.applyScreen(id)));
    } else {
      if (!this.screen) return;
      await Promise.all([...this.screenTx.values()].map((tx) => tx.sender.replaceTrack(null).catch(() => {})));
      this.screen.getTracks().forEach((t) => t.stop());
      this.screen = null;
    }
    this.broadcastMedia();
    this.emitMedia();
  }

  /** Свой экран — в канал демонстрации участника (если показываю). */
  private async applyScreen(peerId: string): Promise<void> {
    const tx = this.screenTx.get(peerId);
    const track = this.screen?.getVideoTracks()[0];
    if (!tx || !track) return;
    await tx.sender.replaceTrack(track).catch(() => {});
    await tuneScreenSender(tx.sender);
  }

  /** Завести канал демонстрации с участником, который умеет её смотреть:
   *  только со стороны меньшего id и когда соединение устоялось (иначе —
   *  при следующем stable, см. wire). */
  private ensureScreenTx(peerId: string): void {
    const pc = this.peers.get(peerId);
    if (!pc || this.screenTx.has(peerId) || !(this.userId < peerId)) return;
    if (!this.peerMedia.get(peerId)?.rxScreen || pc.signalingState !== "stable" || !this.videoTx.has(peerId)) return;
    this.screenOut ??= new MediaStream();
    const tx = pc.addTransceiver("video", { direction: "sendrecv", streams: [this.screenOut] });
    this.screenTx.set(peerId, tx);
    void this.applyScreen(peerId);
    void (async () => {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        this.send("webrtc_offer", { to_user_id: peerId, offer });
      } catch (e) {
        console.warn("[GroupCall] канал демонстрации не завёлся", e);
      }
    })();
  }

  /** Камера для всех соединений сразу. Ошибки getUserMedia — наверх
   *  (NotAllowedError и т. п.): экран звонка подскажет, что делать. */
  async setVideo(on: boolean): Promise<void> {
    if (on) {
      if (this.cam) return;
      const r = await openCallCamera({ front: this.front, deviceIdx: this.deviceIdx });
      if (this.state === "idle") { r.stream.getTracks().forEach((t) => t.stop()); return; }
      this.cam = r.stream;
      this.front = r.front;
      this.canFlip = r.canFlip;
    } else {
      this.cam?.getTracks().forEach((t) => t.stop());
      this.cam = null;
    }
    await this.applyCam();
    this.broadcastMedia();
    this.emitMedia();
  }

  async flipCamera(): Promise<void> {
    if (!this.cam) return;
    const old = this.cam;
    this.front = !this.front;
    this.deviceIdx += 1;
    try {
      const r = await openCallCamera({ front: this.front, deviceIdx: this.deviceIdx });
      this.cam = r.stream;
      this.front = r.front;
      this.canFlip = r.canFlip;
      await this.applyCam();
      old.getTracks().forEach((t) => t.stop());
    } catch (e) {
      this.front = !this.front;
      this.deviceIdx -= 1;
      throw e;
    }
    this.emitMedia();
  }

  /** Кто говорит: уровень входящего звука по каждому соединению и свой микрофон. */
  async getAudioLevels(): Promise<AudioLevels> {
    const peers: Record<string, number> = {};
    let local = 0;
    await Promise.all([...this.peers].map(async ([id, pc]) => {
      const stats = await pc.getStats().catch(() => null);
      stats?.forEach((s: { type: string; kind?: string; audioLevel?: number; remoteSource?: boolean }) => {
        if (typeof s.audioLevel !== "number" || s.kind !== "audio") return;
        if (s.type === "inbound-rtp" || (s.type === "track" && s.remoteSource)) peers[id] = Math.max(peers[id] || 0, s.audioLevel);
        else if (s.type === "media-source" || (s.type === "track" && s.remoteSource === false)) local = Math.max(local, s.audioLevel);
      });
    }));
    return { peers, local: this.isMuted() ? 0 : local };
  }

  async start(chatId: string): Promise<void> {
    if (this.state !== "idle") return;
    try {
      await this.ensureMic();
    } catch {
      this.cb.onError?.(tr("Не удалось получить доступ к микрофону"));
      return;
    }
    this.callId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.chatId = chatId;
    this.setState("outgoing");
    this.send("call_invite", { call_type: "audio" });
  }

  notifyIncoming(invite: GroupCallInvite): void {
    if (this.state !== "idle") return;
    this.callId = invite.callId;
    this.chatId = invite.chatId;
    this.setState("incoming");
    this.cb.onIncoming?.(invite);
  }

  async accept(): Promise<void> {
    if (!this.callId) return;
    try {
      await this.ensureMic();
    } catch {
      this.cb.onError?.(tr("Не удалось получить доступ к микрофону"));
      this.leave();
      return;
    }
    this.setState("active");
    this.send("call_accept", { device_id: myDeviceId() });
  }

  reject(): void {
    if (!this.callId) return;
    this.send("call_reject", { device_id: myDeviceId() });
    this.cleanup();
  }

  /** Приглашение приняли или отклонили на другом моём устройстве — молча
   *  перестать звонить, ничего не отправляя. */
  dismissIncoming(): void {
    if (this.state === "incoming") this.cleanup();
  }

  leave(): void {
    if (this.callId) this.send("call_end", {});
    this.cleanup();
  }

  async handleSignal(signalType: string, data: any): Promise<void> {
    if (!data) return;
    const from = data.from_user_id as string | undefined;
    if (data.call_id && this.callId && data.call_id !== this.callId) return;
    // Звоним, но здесь ещё не ответили — медиасигналы для того устройства, где приняли.
    if (this.state === "incoming" && signalType.startsWith("webrtc_")) return;

    switch (signalType) {
      case "call_peers": {
        const peerIds: string[] = (data.peers || []).filter((id: string) => id !== this.userId);
        this.cb.onPeers?.(peerIds);
        // Ушедших закрываем, с новыми — поднимаем соединение.
        for (const id of [...this.peers.keys()]) {
          if (!peerIds.includes(id)) this.dropPeer(id);
        }
        if (this.state === "outgoing" && peerIds.length) this.setState("active");
        for (const id of peerIds) {
          if (this.peers.has(id)) continue;
          if (this.userId < id) await this.offerTo(id);
        }
        break;
      }
      case "webrtc_offer": {
        if (!from) return;
        const pc = await this.ensurePeer(from, false);
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        // Видеоканал из предложения: «и отправляю, и принимаю». Старые
        // версии шлют предложение без видео — тогда с ними только голос.
        const can = sdpCanVideo(data.offer?.sdp);
        this.patchPeer(from, { canVideo: can, known: true });
        const vt = pc.getTransceivers().find((x) => x.receiver.track?.kind === "video");
        if (vt && can) {
          vt.direction = "sendrecv";
          if (this.localStream) vt.sender.setStreams?.(this.localStream);
          this.videoTx.set(from, vt);
          const cam = this.camTrack();
          if (cam) await vt.sender.replaceTrack(cam).catch(() => {});
        }
        // Второй видеоканал — демонстрация (его заводит участник с меньшим id).
        const vids = pc.getTransceivers().filter((x) => x.receiver.track?.kind === "video");
        if (vids.length > 1 && !this.screenTx.has(from)) {
          const st = vids[1];
          st.direction = "sendrecv";
          this.screenOut ??= new MediaStream();
          st.sender.setStreams?.(this.screenOut);
          this.screenTx.set(from, st);
          await this.applyScreen(from);
        }
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.send("webrtc_answer", { to_user_id: from, answer });
        if (this.state !== "active") this.setState("active");
        break;
      }
      case "webrtc_answer": {
        if (!from) return;
        const pc = this.peers.get(from);
        // Ждём ответа на своё предложение — первое или повторное (канал
        // демонстрации). Раньше повторный ответ отбрасывался.
        if (pc && pc.signalingState === "have-local-offer") {
          const first = !pc.currentRemoteDescription;
          await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
          if (first) this.patchPeer(from, { canVideo: sdpCanVideo(data.answer?.sdp), known: true });
        }
        break;
      }
      case "webrtc_ice_candidate": {
        if (!from || !data.candidate) return;
        const pc = this.peers.get(from);
        if (pc) await pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(() => {});
        break;
      }
      case "webrtc_media": {
        // Участник включил или выключил камеру / микрофон.
        if (!from) return;
        const patch: Partial<GroupPeerMedia> = { video: !!data.video, screen: !!data.screen };
        if (typeof data.audio === "boolean") patch.muted = !data.audio;
        if (typeof data.obs === "boolean") patch.obs = data.obs;
        if (data.rx_screen) patch.rxScreen = true;
        this.patchPeer(from, patch);
        this.emitScreens();
        if (data.rx_screen) this.ensureScreenTx(from);
        break;
      }
      case "call_end":
      case "call_reject":
        if (from) this.dropPeer(from);
        break;
    }
  }

  dispose(): void {
    this.leave();
  }

  // ===== внутреннее =====

  private send(type: string, extra: Record<string, unknown>): void {
    this.ws.send({
      type,
      data: { chat_id: this.chatId, call_id: this.callId, ...extra },
    });
  }

  private camTrack(): MediaStreamTrack | null {
    return this.cam?.getVideoTracks()[0] ?? null;
  }

  private async applyCam(): Promise<void> {
    const track = this.camTrack();
    await Promise.all([...this.videoTx.values()].map((tx) => tx.sender.replaceTrack(track).catch(() => {})));
  }

  /** Своя камера и микрофон — одному участнику (новому — при соединении). */
  private sendMediaTo(peerId: string): void {
    if (!this.callId) return;
    this.send("webrtc_media", { to_user_id: peerId, video: !!this.cam, audio: !this.isMuted(), obs: this.broadcasting, screen: !!this.screen, rx_screen: true });
  }

  private broadcastMedia(): void {
    for (const id of this.peers.keys()) this.sendMediaTo(id);
  }

  private patchPeer(peerId: string, patch: Partial<GroupPeerMedia>): void {
    this.peerMedia.set(peerId, { ...(this.peerMedia.get(peerId) ?? emptyPeerMedia()), ...patch });
    this.emitMedia();
  }

  private emitMedia(): void {
    this.cb.onMedia?.(this.getMedia());
  }

  private async ensureMic(): Promise<void> {
    if (this.localStream) return;
    this.micOpenedWith = micKey();
    this.localStream = await navigator.mediaDevices.getUserMedia({
      audio: micConstraints(),
      video: false,
    });
  }

  private async ensurePeer(peerId: string, offerer: boolean): Promise<RTCPeerConnection> {
    const existing = this.peers.get(peerId);
    if (existing) return existing;

    await this.ensureMic();
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    this.peers.set(peerId, pc);
    if (!this.peerMedia.has(peerId)) this.peerMedia.set(peerId, emptyPeerMedia());

    this.localStream?.getTracks().forEach((t) => pc.addTrack(t, this.localStream as MediaStream));
    // Видеоканал предлагающего — сразу (с камерой, если она уже включена);
    // отвечающий берёт его из предложения.
    if (offerer) {
      const tx = pc.addTransceiver(this.camTrack() ?? "video", { direction: "sendrecv", streams: this.localStream ? [this.localStream] : [] });
      this.videoTx.set(peerId, tx);
    }
    this.wire(peerId, pc);
    return pc;
  }

  private wire(peerId: string, pc: RTCPeerConnection): void {
    // Дорожки участника копим в одном потоке: звук и видео приходят
    // отдельными событиями. Новый объект каждый раз — иначе WebKit не
    // начинает играть добавленную дорожку.
    pc.ontrack = (event) => {
      // Демонстрация участника — своим потоком, не вместо его камеры.
      if (event.track.kind === "video" && isScreenTransceiver(pc, event.transceiver)) {
        this.screens.set(peerId, new MediaStream([event.track]));
        this.emitScreens();
        return;
      }
      const incoming = event.streams?.[0]?.getTracks() ?? [event.track];
      const kinds = new Set(incoming.map((t) => t.kind));
      const keep = (this.streams.get(peerId)?.getTracks() || []).filter((t) => !kinds.has(t.kind));
      this.streams.set(peerId, new MediaStream([...keep, ...incoming]));
      this.emitStreams();
    };
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.send("webrtc_ice_candidate", { to_user_id: peerId, candidate: event.candidate });
      }
    };
    // Канал демонстрации ждал, пока устоится первое согласование.
    pc.onsignalingstatechange = () => { if (pc.signalingState === "stable") this.ensureScreenTx(peerId); };
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === "connected") {
        this.patchPeer(peerId, { connected: true });
        // Камеру и микрофон могли переключить до соединения — повторяем.
        this.sendMediaTo(peerId);
      }
      if (st === "failed" || st === "closed") this.dropPeer(peerId);
    };
  }

  private async offerTo(peerId: string): Promise<void> {
    const pc = await this.ensurePeer(peerId, true);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.send("webrtc_offer", { to_user_id: peerId, offer });
  }

  private dropPeer(peerId: string): void {
    const pc = this.peers.get(peerId);
    if (pc) {
      pc.ontrack = null;
      pc.onicecandidate = null;
      pc.onconnectionstatechange = null;
      pc.onsignalingstatechange = null;
      pc.close();
    }
    this.peers.delete(peerId);
    this.streams.delete(peerId);
    this.videoTx.delete(peerId);
    this.screenTx.delete(peerId);
    this.screens.delete(peerId);
    this.emitScreens();
    this.peerMedia.delete(peerId);
    this.emitStreams();
    this.emitMedia();
  }

  private emitStreams(): void {
    this.cb.onStreams?.([...this.streams].map(([peerId, stream]) => ({ peerId, stream })));
  }

  /** Демонстрации тех, кто сейчас показывает экран (по webrtc_media). */
  private emitScreens(): void {
    this.cb.onScreens?.([...this.screens].filter(([id]) => this.peerMedia.get(id)?.screen).map(([peerId, stream]) => ({ peerId, stream })));
  }

  private cleanup(): void {
    this.broadcasting = false;
    [...this.peers.keys()].forEach((id) => this.dropPeer(id));
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    this.cam?.getTracks().forEach((t) => t.stop());
    this.cam = null;
    this.screen?.getTracks().forEach((t) => t.stop());
    this.screen = null;
    this.screenOut = null;
    this.front = true;
    this.deviceIdx = 0;
    this.canFlip = false;
    this.callId = null;
    this.chatId = null;
    this.emitMedia();
    this.setState("idle");
  }

  private setState(next: GroupCallState): void {
    this.state = next;
    this.cb.onStateChange?.(next);
  }
}
