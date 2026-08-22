import { WebSocketService } from "@/services/websocket";

export type GroupCallState = "idle" | "outgoing" | "incoming" | "active";

export type GroupCallInvite = {
  callId: string;
  chatId: string;
  fromUserId: string;
  fromUsername: string;
  chatName: string;
};

type Options = {
  wsService: WebSocketService;
  userId: string;
  iceServers: RTCIceServer[];
  onStateChange?: (state: GroupCallState) => void;
  onIncoming?: (invite: GroupCallInvite) => void;
  onStreams?: (streams: MediaStream[]) => void;
  onPeers?: (peerIds: string[]) => void;
  onError?: (message: string) => void;
};

/**
 * Групповой звонок по схеме mesh: каждый участник держит отдельное
 * соединение с каждым. Для небольших компаний это проще и честнее сервера
 * микширования — звук идёт напрямую, без промежуточного узла.
 *
 * Кто кому шлёт offer, решает сравнение идентификаторов: инициирует тот,
 * чей id меньше. Иначе оба бросаются навстречу, и соединение не сходится.
 */
export class GroupCallService {
  private ws: WebSocketService;
  private userId: string;
  private iceServers: RTCIceServer[];
  private cb: Options;

  private peers = new Map<string, RTCPeerConnection>();
  private streams = new Map<string, MediaStream>();
  private localStream: MediaStream | null = null;
  private callId: string | null = null;
  private chatId: string | null = null;
  private state: GroupCallState = "idle";

  constructor(options: Options) {
    this.ws = options.wsService;
    this.userId = options.userId;
    this.iceServers = options.iceServers;
    this.cb = options;
  }

  getState() {
    return this.state;
  }

  getCallId() {
    return this.callId;
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
    return willMute;
  }

  async start(chatId: string): Promise<void> {
    if (this.state !== "idle") return;
    try {
      await this.ensureMic();
    } catch {
      this.cb.onError?.("Не удалось получить доступ к микрофону");
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
    this.cleanup();
  }

  leave(): void {
    if (this.callId) this.send("call_end", {});
    this.cleanup();
  }

  async handleSignal(signalType: string, data: any): Promise<void> {
    if (!data) return;
    const from = data.from_user_id as string | undefined;
    if (data.call_id && this.callId && data.call_id !== this.callId) return;

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
        const pc = await this.ensurePeer(from);
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.send("webrtc_answer", { to_user_id: from, answer });
        if (this.state !== "active") this.setState("active");
        break;
      }
      case "webrtc_answer": {
        if (!from) return;
        const pc = this.peers.get(from);
        if (pc && !pc.currentRemoteDescription) {
          await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        }
        break;
      }
      case "webrtc_ice_candidate": {
        if (!from || !data.candidate) return;
        const pc = this.peers.get(from);
        if (pc) await pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(() => {});
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

  private async ensureMic(): Promise<void> {
    if (this.localStream) return;
    this.localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
  }

  private async ensurePeer(peerId: string): Promise<RTCPeerConnection> {
    const existing = this.peers.get(peerId);
    if (existing) return existing;

    await this.ensureMic();
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    this.peers.set(peerId, pc);

    this.localStream?.getTracks().forEach((t) => pc.addTrack(t, this.localStream as MediaStream));

    pc.ontrack = (event) => {
      const tracks = event.streams?.[0]?.getTracks() ?? [event.track];
      this.streams.set(peerId, new MediaStream(tracks));
      this.emitStreams();
    };
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.send("webrtc_ice_candidate", { to_user_id: peerId, candidate: event.candidate });
      }
    };
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === "failed" || st === "closed") this.dropPeer(peerId);
    };
    return pc;
  }

  private async offerTo(peerId: string): Promise<void> {
    const pc = await this.ensurePeer(peerId);
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
      pc.close();
    }
    this.peers.delete(peerId);
    this.streams.delete(peerId);
    this.emitStreams();
  }

  private emitStreams(): void {
    this.cb.onStreams?.([...this.streams.values()]);
  }

  private cleanup(): void {
    [...this.peers.keys()].forEach((id) => this.dropPeer(id));
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    this.callId = null;
    this.chatId = null;
    this.setState("idle");
  }

  private setState(next: GroupCallState): void {
    this.state = next;
    this.cb.onStateChange?.(next);
  }
}
