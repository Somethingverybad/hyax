import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

/**
 * Мост к нативному медиа-слою звонков (NativeCallPlugin на iOS и Android).
 *
 * Разговор ведёт нативный WebRTC, а не WebView: только так звонок уживается
 * с CallKit и переживает блокировку экрана. Здесь — сигналинговые примитивы:
 * отдать SDP и ICE, получить их обратно событиями.
 */

export interface NativeSdp {
  peerId: string;
  type: "offer" | "answer";
  sdp: string;
}

export interface NativeIce {
  peerId: string;
  candidate: string;
  sdpMid: string;
  sdpMLineIndex: number;
}

export interface NativePeerState {
  peerId: string;
  state: string;
}

interface NativeCallPlugin {
  /** Захватить микрофон и запомнить ICE-серверы. */
  start(o: { iceServers: RTCIceServer[] }): Promise<void>;
  createPeer(o: { peerId: string }): Promise<void>;
  createOffer(o: { peerId: string }): Promise<void>;
  setRemoteDescription(o: { peerId: string; type: string; sdp: string }): Promise<void>;
  addCandidate(o: {
    peerId: string;
    candidate: string;
    sdpMid?: string;
    sdpMLineIndex?: number;
  }): Promise<void>;
  closePeer(o: { peerId: string }): Promise<void>;
  end(): Promise<void>;
  setMuted(o: { muted: boolean }): Promise<void>;
  addListener(event: "sdp", cb: (d: NativeSdp) => void): Promise<PluginListenerHandle>;
  addListener(event: "iceCandidate", cb: (d: NativeIce) => void): Promise<PluginListenerHandle>;
  addListener(event: "peerState", cb: (d: NativePeerState) => void): Promise<PluginListenerHandle>;
}

const plugin = registerPlugin<NativeCallPlugin>("NativeCall");

/** Нативный движок есть только в приложении; в вебе звонки ведёт браузер. */
export const hasNativeCalls = () => Capacitor.isNativePlatform();

export const nativeCall = {
  start: (iceServers: RTCIceServer[]) => plugin.start({ iceServers }),
  createPeer: (peerId: string) => plugin.createPeer({ peerId }),
  createOffer: (peerId: string) => plugin.createOffer({ peerId }),
  setRemote: (peerId: string, type: "offer" | "answer", sdp: string) =>
    plugin.setRemoteDescription({ peerId, type, sdp }),
  addCandidate: (peerId: string, c: RTCIceCandidateInit) =>
    plugin.addCandidate({
      peerId,
      candidate: c.candidate || "",
      sdpMid: c.sdpMid ?? undefined,
      sdpMLineIndex: c.sdpMLineIndex ?? 0,
    }),
  closePeer: (peerId: string) => plugin.closePeer({ peerId }),
  end: () => plugin.end(),
  setMuted: (muted: boolean) => plugin.setMuted({ muted }),
  onSdp: (cb: (d: NativeSdp) => void) => plugin.addListener("sdp", cb),
  onIce: (cb: (d: NativeIce) => void) => plugin.addListener("iceCandidate", cb),
  onPeerState: (cb: (d: NativePeerState) => void) => plugin.addListener("peerState", cb),
};
