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

/** Прямоугольник в CSS-пикселях относительно WebView; r — скругление углов. */
export interface VideoRect { x: number; y: number; w: number; h: number; r?: number }

/** Где рисовать видео участника (по одному окну на каждого). */
export interface PeerRect extends VideoRect { peerId: string }

/** Громкость речи 0…1: участники по id и свой микрофон. */
export interface AudioLevels { peers: Record<string, number>; local: number }

export interface NativeVideoState { on: boolean; front: boolean; canFlip: boolean }

interface NativeCallPlugin {
  /** Захватить микрофон и запомнить ICE-серверы. */
  start(o: { iceServers: RTCIceServer[] }): Promise<void>;
  /** video — личный звонок: в соединении сразу пустой видеоканал. */
  createPeer(o: { peerId: string; video?: boolean }): Promise<void>;
  createOffer(o: { peerId: string }): Promise<void>;
  setRemoteDescription(o: { peerId: string; type: string; sdp: string; video?: boolean }): Promise<void>;
  /** Камера: reject("denied") — нет разрешения, reject("no_camera") — нет камеры. */
  setVideo(o: { on: boolean }): Promise<NativeVideoState>;
  flipCamera(): Promise<{ front: boolean }>;
  /** Где рисовать видео под прозрачной страницей; пусто и null — видео нет. */
  setVideoLayout(o: { remotes: PeerRect[]; local: VideoRect | null }): Promise<void>;
  /** Кто сейчас говорит — по статистике соединений. */
  getAudioLevels(): Promise<AudioLevels>;
  /** Настройки приложения в системе (дать доступ к камере после отказа). */
  openSettings(): Promise<void>;
  addCandidate(o: {
    peerId: string;
    candidate: string;
    sdpMid?: string;
    sdpMLineIndex?: number;
  }): Promise<void>;
  closePeer(o: { peerId: string }): Promise<void>;
  end(): Promise<void>;
  setMuted(o: { muted: boolean }): Promise<void>;
  /** Громкость входящего звука участника: 1 — как есть, 0 — тишина, до 2 — громче. */
  setPeerVolume(o: { peerId: string; volume: number }): Promise<void>;
  addListener(event: "sdp", cb: (d: NativeSdp) => void): Promise<PluginListenerHandle>;
  addListener(event: "iceCandidate", cb: (d: NativeIce) => void): Promise<PluginListenerHandle>;
  addListener(event: "peerState", cb: (d: NativePeerState) => void): Promise<PluginListenerHandle>;
}

const plugin = registerPlugin<NativeCallPlugin>("NativeCall");

/** Нативный движок есть только в приложении; в вебе звонки ведёт браузер. */
export const hasNativeCalls = () => Capacitor.isNativePlatform();

export const nativeCall = {
  start: (iceServers: RTCIceServer[]) => plugin.start({ iceServers }),
  createPeer: (peerId: string, video = false) => plugin.createPeer({ peerId, video }),
  createOffer: (peerId: string) => plugin.createOffer({ peerId }),
  setRemote: (peerId: string, type: "offer" | "answer", sdp: string, video = false) =>
    plugin.setRemoteDescription({ peerId, type, sdp, video }),
  setVideo: (on: boolean) => plugin.setVideo({ on }),
  flipCamera: () => plugin.flipCamera(),
  setVideoLayout: (remotes: PeerRect[], local: VideoRect | null) => plugin.setVideoLayout({ remotes, local }),
  audioLevels: () => plugin.getAudioLevels(),
  openSettings: () => plugin.openSettings(),
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
  setPeerVolume: (peerId: string, volume: number) => plugin.setPeerVolume({ peerId, volume }),
  onSdp: (cb: (d: NativeSdp) => void) => plugin.addListener("sdp", cb),
  onIce: (cb: (d: NativeIce) => void) => plugin.addListener("iceCandidate", cb),
  onPeerState: (cb: (d: NativePeerState) => void) => plugin.addListener("peerState", cb),
};
