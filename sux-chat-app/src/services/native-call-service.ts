import { WebSocketService } from "@/services/websocket";
import { nativeCall, type NativeIce, type NativeSdp, type NativePeerState } from "@/lib/nativeCall";
import type { CallState, IncomingCall } from "@/services/call-service";
import type { GroupCallInvite, GroupCallState } from "@/services/group-call-service";

/**
 * Звонки на нативном движке: сигналинг и состояние — здесь, звук — в
 * нативном плагине. Полностью повторяет поведение веб-версии сервисов,
 * поэтому собеседником может быть и телефон, и браузер.
 *
 * Зачем: в WebView разговор не уживался с CallKit (аудио-сессией не могут
 * владеть двое) и умирал при блокировке экрана. Нативный движок решает оба
 * ограничения разом.
 */

type SignalData = Record<string, any>;

/** Общая часть: подписки на события плагина и отправка сигналов. */
abstract class NativeBase {
  protected ws: WebSocketService;
  protected userId: string;
  protected iceServers: RTCIceServer[];
  protected callId: string | null = null;
  protected chatId: string | null = null;
  protected peers = new Set<string>();
  protected muted = false;
  private listeners: Array<Promise<{ remove: () => Promise<void> } | undefined>> = [];

  constructor(ws: WebSocketService, userId: string, iceServers: RTCIceServer[]) {
    this.ws = ws;
    this.userId = userId;
    this.iceServers = iceServers;

    // События приходят всем сервисам сразу — берём только свои соединения.
    this.listeners.push(
      nativeCall.onSdp((d: NativeSdp) => {
        if (!this.peers.has(d.peerId)) return;
        this.send(d.type === "offer" ? "webrtc_offer" : "webrtc_answer", {
          to_user_id: d.peerId,
          [d.type]: { type: d.type, sdp: d.sdp },
        });
      }),
      nativeCall.onIce((d: NativeIce) => {
        if (!this.peers.has(d.peerId)) return;
        this.send("webrtc_ice_candidate", {
          to_user_id: d.peerId,
          candidate: {
            candidate: d.candidate,
            sdpMid: d.sdpMid,
            sdpMLineIndex: d.sdpMLineIndex,
          },
        });
      }),
      nativeCall.onPeerState((d: NativePeerState) => {
        if (!this.peers.has(d.peerId)) return;
        this.onPeerState(d.peerId, d.state);
      })
    );
  }

  protected abstract onPeerState(peerId: string, state: string): void;

  protected send(type: string, extra: SignalData): void {
    this.ws.send({ type, data: { chat_id: this.chatId, call_id: this.callId, ...extra } });
  }

  protected newCallId(): string {
    return typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  protected async addPeer(peerId: string, offer: boolean): Promise<void> {
    if (this.peers.has(peerId)) return;
    this.peers.add(peerId);
    await nativeCall.createPeer(peerId);
    if (offer) await nativeCall.createOffer(peerId);
  }

  protected async dropPeer(peerId: string): Promise<void> {
    if (!this.peers.delete(peerId)) return;
    await nativeCall.closePeer(peerId).catch(() => {});
  }

  protected async handleMedia(signalType: string, from: string, data: SignalData): Promise<void> {
    switch (signalType) {
      case "webrtc_offer":
        this.peers.add(from);
        await nativeCall.setRemote(from, "offer", data.offer?.sdp || "");
        break;
      case "webrtc_answer":
        if (this.peers.has(from)) await nativeCall.setRemote(from, "answer", data.answer?.sdp || "");
        break;
      case "webrtc_ice_candidate":
        if (this.peers.has(from) && data.candidate) {
          await nativeCall.addCandidate(from, data.candidate);
        }
        break;
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    nativeCall.setMuted(this.muted).catch(() => {});
    return this.muted;
  }

  protected async cleanupMedia(): Promise<void> {
    for (const id of [...this.peers]) await this.dropPeer(id);
    this.muted = false;
    await nativeCall.end().catch(() => {});
  }

  protected removeListeners(): void {
    this.listeners.forEach((l) => l.then((h) => h?.remove()).catch(() => {}));
    this.listeners = [];
  }
}

/** Личный звонок — поведение OneToOneCallService на нативном движке. */
export class NativeCallService extends NativeBase {
  private state: CallState = "idle";
  private targetUserId: string | null = null;
  private isCaller = false;

  onStateChange?: (state: CallState) => void;
  onIncomingCall?: (call: IncomingCall) => void;
  onRemoteStream?: (stream: MediaStream) => void;
  onCallEnded?: (reason: string) => void;
  onError?: (message: string) => void;

  constructor(options: {
    wsService: WebSocketService;
    chatId: string;
    userId: string;
    iceServers: RTCIceServer[];
    onStateChange?: (state: CallState) => void;
    onIncomingCall?: (call: IncomingCall) => void;
    onRemoteStream?: (stream: MediaStream) => void;
    onCallEnded?: (reason: string) => void;
    onError?: (message: string) => void;
  }) {
    super(options.wsService, options.userId, options.iceServers);
    this.chatId = options.chatId || null;
    this.onStateChange = options.onStateChange;
    this.onIncomingCall = options.onIncomingCall;
    this.onRemoteStream = options.onRemoteStream;
    this.onCallEnded = options.onCallEnded;
    this.onError = options.onError;
  }

  updateChatId(chatId: string): void {
    this.chatId = chatId;
  }

  getState(): CallState {
    return this.state;
  }

  getCurrentCallId(): string | null {
    return this.callId;
  }

  notifyIncomingCall(data: {
    callId: string;
    chatId: string;
    fromUserId: string;
    fromUsername: string;
    fromUserAvatar?: string;
    callType?: "audio" | "video";
  }): void {
    this.callId = data.callId;
    this.chatId = data.chatId;
    this.targetUserId = data.fromUserId;
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
    if (this.state !== "idle" || !targetUserId) return;
    try {
      await nativeCall.start(this.iceServers);
    } catch {
      this.onError?.("Не удалось получить доступ к микрофону");
      return;
    }
    this.callId = this.newCallId();
    this.targetUserId = targetUserId;
    this.isCaller = true;
    this.setState("outgoing");
    this.send("call_invite", { to_user_id: targetUserId, call_type: "audio" });
  }

  async acceptIncomingCall(callId: string, fromUserId: string): Promise<void> {
    if (!callId || !fromUserId) return;
    try {
      await nativeCall.start(this.iceServers);
    } catch {
      this.onError?.("Не удалось получить доступ к микрофону");
      this.finish("failed");
      return;
    }
    this.callId = callId;
    this.targetUserId = fromUserId;
    this.isCaller = false;
    this.setState("connecting");
    this.send("call_accept", { to_user_id: fromUserId });
  }

  rejectIncomingCall(callId: string, fromUserId: string): void {
    if (!callId || !fromUserId) return;
    this.callId = callId;
    this.send("call_reject", { to_user_id: fromUserId });
    this.finish("rejected");
  }

  endCall(status: "ended" | "missed" | "failed" = "ended", notify = true): void {
    if (notify && this.callId) {
      this.send("call_end", { to_user_id: this.targetUserId, status });
    }
    this.finish(status);
  }

  async handleSignal(signalType: string, data: SignalData): Promise<void> {
    if (!data) return;
    const from = data.from_user_id as string | undefined;
    if (!from || from === this.userId) return;

    if (signalType === "call_invite") {
      // Приглашение приходит уведомлением, здесь его не ждём.
      return;
    }
    if (this.callId && data.call_id && data.call_id !== this.callId) return;

    switch (signalType) {
      case "call_accept":
        if (this.isCaller) {
          this.setState("connecting");
          await this.addPeer(from, true);
        }
        break;
      case "call_reject":
        this.finish("rejected");
        break;
      case "call_end":
        this.finish((data.status as string) || "ended");
        break;
      default:
        await this.handleMedia(signalType, from, data);
        break;
    }
  }

  protected onPeerState(_peerId: string, state: string): void {
    if (state === "connected") this.setState("active");
    if (state === "failed") this.finish("failed");
  }

  dispose(): void {
    this.endCall("ended", false);
    this.removeListeners();
  }

  private finish(reason: string): void {
    void this.cleanupMedia();
    this.callId = null;
    this.targetUserId = null;
    this.isCaller = false;
    this.setState("idle");
    this.onCallEnded?.(reason);
  }

  private setState(next: CallState): void {
    this.state = next;
    this.onStateChange?.(next);
  }
}

/** Групповой звонок — mesh на нативном движке. */
export class NativeGroupCallService extends NativeBase {
  private state: GroupCallState = "idle";
  private cb: {
    onStateChange?: (s: GroupCallState) => void;
    onIncoming?: (invite: GroupCallInvite) => void;
    onPeers?: (ids: string[]) => void;
    onError?: (m: string) => void;
  };

  constructor(options: {
    wsService: WebSocketService;
    userId: string;
    iceServers: RTCIceServer[];
    onStateChange?: (s: GroupCallState) => void;
    onIncoming?: (invite: GroupCallInvite) => void;
    onStreams?: (streams: MediaStream[]) => void;
    onPeers?: (ids: string[]) => void;
    onError?: (m: string) => void;
  }) {
    super(options.wsService, options.userId, options.iceServers);
    this.cb = options;
  }

  getState(): GroupCallState {
    return this.state;
  }

  getCallId(): string | null {
    return this.callId;
  }

  async start(chatId: string): Promise<void> {
    if (this.state !== "idle") return;
    try {
      await nativeCall.start(this.iceServers);
    } catch {
      this.cb.onError?.("Не удалось получить доступ к микрофону");
      return;
    }
    this.callId = this.newCallId();
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
      await nativeCall.start(this.iceServers);
    } catch {
      this.cb.onError?.("Не удалось получить доступ к микрофону");
      this.leave();
      return;
    }
    this.setState("active");
    this.send("call_accept", {});
  }

  reject(): void {
    if (!this.callId) return;
    this.send("call_reject", {});
    this.finish();
  }

  leave(): void {
    if (this.callId) this.send("call_end", {});
    this.finish();
  }

  async handleSignal(signalType: string, data: SignalData): Promise<void> {
    if (!data) return;
    if (this.callId && data.call_id && data.call_id !== this.callId) return;
    const from = data.from_user_id as string | undefined;

    if (signalType === "call_peers") {
      const ids: string[] = (data.peers || []).filter((id: string) => id !== this.userId);
      this.cb.onPeers?.(ids);
      for (const id of [...this.peers]) {
        if (!ids.includes(id)) await this.dropPeer(id);
      }
      if (this.state === "outgoing" && ids.length) this.setState("active");
      for (const id of ids) {
        // Offer инициирует участник с меньшим идентификатором — иначе оба
        // бросятся навстречу и соединение не сойдётся.
        if (!this.peers.has(id) && this.userId < id) await this.addPeer(id, true);
      }
      return;
    }

    if (!from || from === this.userId) return;
    if (signalType === "call_end" || signalType === "call_reject") {
      await this.dropPeer(from);
      return;
    }
    await this.handleMedia(signalType, from, data);
  }

  protected onPeerState(peerId: string, state: string): void {
    if (state === "connected" && this.state !== "active") this.setState("active");
    if (state === "failed" || state === "closed") void this.dropPeer(peerId);
  }

  dispose(): void {
    this.leave();
    this.removeListeners();
  }

  private finish(): void {
    void this.cleanupMedia();
    this.callId = null;
    this.chatId = null;
    this.setState("idle");
  }

  private setState(next: GroupCallState): void {
    this.state = next;
    this.cb.onStateChange?.(next);
  }
}
