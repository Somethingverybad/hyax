import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { getMicSettings } from "@/lib/micSettings";

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

/** Прямоугольник в CSS-пикселях относительно WebView; r — скругление углов,
 *  fit — кадр целиком (демонстрация экрана), иначе с обрезкой по окну;
 *  over — окно поверх соседних (угловое над демонстрацией; нужно Android). */
export interface VideoRect { x: number; y: number; w: number; h: number; r?: number; fit?: boolean; over?: boolean }

/** Где рисовать видео участника (по одному окну на каждого). Демонстрация
 *  экрана участника — окно `${peerId}#screen`. */
export interface PeerRect extends VideoRect { peerId: string }

/** Громкость речи 0…1: участники по id и свой микрофон. */
export interface AudioLevels { peers: Record<string, number>; local: number }

export interface NativeVideoState { on: boolean; front: boolean; canFlip: boolean }

/** Что умеет нативная часть этой сборки. screen — смотреть демонстрацию экрана
 *  (второй видеоканал). Старые сборки метода не знают — тогда ничего. */
export interface NativeFeatures { screen?: boolean }

interface NativeCallPlugin {
  /** Захватить микрофон (с настройками из «Настройки → Микрофон») и запомнить ICE-серверы. */
  start(o: { iceServers: RTCIceServer[]; mic?: { noiseSuppression: boolean; echoCancellation: boolean; autoGainControl: boolean } }): Promise<void>;
  /** video — в соединении сразу пустой видеоканал; screen — и второй, только
   *  на приём, под демонстрацию экрана собеседника (личный звонок, звоню я). */
  createPeer(o: { peerId: string; video?: boolean; screen?: boolean }): Promise<void>;
  getFeatures(): Promise<NativeFeatures>;
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

let features: Promise<NativeFeatures> | null = null;

export const nativeCall = {
  start: (iceServers: RTCIceServer[]) => {
    const { noiseSuppression, echoCancellation, autoGainControl } = getMicSettings();
    return plugin.start({ iceServers, mic: { noiseSuppression, echoCancellation, autoGainControl } });
  },
  createPeer: (peerId: string, video = false, screen = false) => plugin.createPeer({ peerId, video, screen }),
  /** Правка страницы приходит и в старые сборки по воздуху: новое — только если нативная часть его знает. */
  features: (): Promise<NativeFeatures> => (features ??= Promise.resolve().then(() => plugin.getFeatures()).catch(() => ({}))),
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
