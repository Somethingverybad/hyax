import { WebSocketService } from "@/services/websocket";

type CallType = "audio" | "video";
type CallState = "idle" | "outgoing" | "incoming" | "connecting" | "active";
type CallEndReason = "rejected" | "ended" | "missed" | "failed";

type IncomingCall = {
  callId: string;
  fromUserId: string;
  callType: CallType;
};

type SignalData = {
  call_id?: string;
  chat_id?: string;
  from_user_id?: string;
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

  async startOutgoingCall(targetUserId: string): Promise<void> {
    if (!targetUserId || this.state !== "idle") {
      return;
    }

    try {
      await this.ensureLocalAudioStream();
      this.currentCallId = this.generateCallId();
      this.targetUserId = targetUserId;
      this.isCaller = true;
      this.setState("outgoing");

      this.wsService.send({
        type: "call_invite",
        data: {
          chat_id: this.chatId,
          call_id: this.currentCallId,
          to_user_id: targetUserId,
          call_type: "audio",
        },
      });
    } catch {
      this.onError?.("Не удалось получить доступ к микрофону");
      this.cleanupLocalStream();
      this.resetState();
    }
  }

  async acceptIncomingCall(callId: string, fromUserId: string): Promise<void> {
    if (!callId || !fromUserId) {
      return;
    }

    try {
      await this.ensureLocalAudioStream();
      this.currentCallId = callId;
      this.targetUserId = fromUserId;
      this.isCaller = false;
      this.setState("connecting");

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
    if (!data || data.chat_id !== this.chatId) {
      return;
    }

    const callId = data.call_id || null;
    const fromUserId = data.from_user_id || null;

    if (fromUserId === this.userId) {
      return;
    }

    if (signalType === "call_invite" && callId && fromUserId) {
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
      this.onIncomingCall?.({
        callId,
        fromUserId,
        callType: data.call_type || "audio",
      });
      return;
    }

    if (!this.currentCallId || callId !== this.currentCallId) {
      return;
    }

    switch (signalType) {
      case "call_accept":
        if (this.isCaller) {
          this.setState("connecting");
          await this.ensurePeerConnection();
          await this.createAndSendOffer();
        }
        break;
      case "call_reject":
        this.finishCall("rejected");
        break;
      case "call_end":
        this.finishCall((data.status as CallEndReason) || "ended");
        break;
      case "webrtc_offer":
        await this.handleOffer(data.offer);
        break;
      case "webrtc_answer":
        await this.handleAnswer(data.answer);
        break;
      case "webrtc_ice_candidate":
        await this.handleIceCandidate(data.candidate);
        break;
      default:
        break;
    }
  }

  dispose(): void {
    this.endCall("ended", false);
  }

  private async ensureLocalAudioStream(): Promise<void> {
    if (this.localStream) {
      return;
    }

    this.localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false,
    });
  }

  private async ensurePeerConnection(): Promise<void> {
    if (this.peerConnection) {
      return;
    }

    this.peerConnection = new RTCPeerConnection({
      iceServers: this.iceServers,
    });

    this.remoteStream = new MediaStream();
    this.onRemoteStream?.(this.remoteStream);

    this.peerConnection.ontrack = (event) => {
      event.streams[0]?.getTracks().forEach((track) => {
        this.remoteStream?.addTrack(track);
      });
      if (this.remoteStream) {
        this.onRemoteStream?.(this.remoteStream);
      }
      this.setState("active");
    };

    this.peerConnection.onicecandidate = (event) => {
      if (!event.candidate || !this.currentCallId) {
        return;
      }

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
      if (state === "connected") {
        this.setState("active");
      }
      if (state === "failed" || state === "disconnected" || state === "closed") {
        this.finishCall("failed");
      }
    };

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        this.peerConnection?.addTrack(track, this.localStream as MediaStream);
      });
    }
  }

  private async createAndSendOffer(): Promise<void> {
    if (!this.peerConnection || !this.currentCallId) {
      return;
    }
    if (this.peerConnection.localDescription) {
      return;
    }

    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);

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
    if (!offer || this.isCaller) {
      return;
    }

    try {
      await this.ensureLocalAudioStream();
      await this.ensurePeerConnection();
      if (!this.peerConnection) {
        return;
      }

      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);

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
    if (!answer || !this.peerConnection || !this.isCaller) {
      return;
    }

    try {
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    } catch {
      this.onError?.("Не удалось установить ответ звонка");
      this.finishCall("failed");
    }
  }

  private async handleIceCandidate(candidate?: RTCIceCandidateInit): Promise<void> {
    if (!candidate || !this.peerConnection) {
      return;
    }

    try {
      await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch {
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
