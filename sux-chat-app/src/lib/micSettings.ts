/**
 * Настройки микрофона для звонков (Настройки → Микрофон). Свои у каждого
 * устройства — поэтому в localStorage, а не в профиле: шумный ноутбук и
 * телефон в наушниках настраивают по-разному.
 *
 * Браузер и компьютер применяют их сразу, даже посреди разговора (микрофон
 * переоткрывается, дорожка подменяется без пересогласования); приложения на
 * телефонах — со следующего звонка: там микрофон держит нативный движок.
 */

export type MicSettings = {
  /** Убирать фоновый шум. */
  noiseSuppression: boolean;
  /** Убирать эхо собеседника из динамика. Без него — только в наушниках. */
  echoCancellation: boolean;
  /** Выравнивать громкость голоса. */
  autoGainControl: boolean;
  /** Выбранный микрофон (браузер и компьютер); null — системный. */
  deviceId: string | null;
};

const KEY = "hyax:mic";
/** Прежний переключатель шумодава из экрана звонка — переносим его выбор. */
const OLD_NS_KEY = "hyax:call-noise-suppression";
const EVENT = "hyax:mic-settings";

const DEFAULTS: MicSettings = { noiseSuppression: true, echoCancellation: true, autoGainControl: true, deviceId: null };

export function getMicSettings(): MicSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
    if (localStorage.getItem(OLD_NS_KEY) === "0") return { ...DEFAULTS, noiseSuppression: false };
  } catch { /* приватный режим */ }
  return { ...DEFAULTS };
}

export function setMicSettings(patch: Partial<MicSettings>): MicSettings {
  const next = { ...getMicSettings(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* приватный режим */ }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: next }));
  return next;
}

/** Подписка на изменения (в том числе из экрана звонка); вернёт отписку. */
export function onMicSettings(cb: (s: MicSettings) => void): () => void {
  const h = (e: Event) => cb((e as CustomEvent<MicSettings>).detail);
  window.addEventListener(EVENT, h);
  return () => window.removeEventListener(EVENT, h);
}

/** Параметры getUserMedia. Микрофон — ideal: отключили выбранный — возьмём системный. */
export function micConstraints(s: MicSettings = getMicSettings()): MediaTrackConstraints {
  return {
    echoCancellation: s.echoCancellation,
    noiseSuppression: s.noiseSuppression,
    autoGainControl: s.autoGainControl,
    ...(s.deviceId ? { deviceId: { ideal: s.deviceId } } : {}),
  };
}

/** Ключ параметров: тот же — переоткрывать микрофон незачем. */
export const micKey = (s: MicSettings = getMicSettings()) =>
  `${+s.noiseSuppression}${+s.echoCancellation}${+s.autoGainControl}:${s.deviceId || ""}`;

/**
 * Переоткрыть микрофон с текущими настройками и подменить дорожку в потоке
 * и во всех соединениях. Выключенный микрофон остаётся выключенным.
 *
 * Старую дорожку закрываем ДО открытия новой: Chrome и Electron, пока микрофон
 * открыт, отдают новую дорожку с прежней обработкой (шумодав не выключался),
 * а applyConstraints её молча игнорирует. Пауза в звуке — доли секунды.
 */
export async function swapMicTrack(stream: MediaStream, pcs: Iterable<RTCPeerConnection>): Promise<void> {
  const old = stream.getAudioTracks()[0];
  if (!old) return;
  const senders = [...pcs].map((pc) => pc.getSenders().find((x) => x.track === old) ?? pc.getSenders().find((x) => x.track?.kind === "audio")).filter((x): x is RTCRtpSender => !!x);
  old.stop();
  let fresh: MediaStream;
  try {
    fresh = await navigator.mediaDevices.getUserMedia({ audio: micConstraints(), video: false });
  } catch (e) {
    // Не открылся с новыми настройками (выбранный микрофон занят) — хоть
    // какой-нибудь, лишь бы звонок не остался без звука.
    fresh = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    void e;
  }
  const track = fresh.getAudioTracks()[0];
  if (!track) return;
  track.enabled = old.enabled;
  for (const sender of senders) await sender.replaceTrack(track);
  stream.removeTrack(old);
  stream.addTrack(track);
  // Трансляция в OBS (lib/obsRelay.ts) шлёт мой микрофон отдельно — пусть подменит и там.
  window.dispatchEvent(new Event(MIC_TRACK_EVENT));
}

/** Микрофон в звонке переоткрыт — дорожка новая. */
export const MIC_TRACK_EVENT = "hyax:mic-track";
