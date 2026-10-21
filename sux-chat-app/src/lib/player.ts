import { useSyncExternalStore } from "react";
import { api, mediaUrl } from "@/api/client";

/**
 * Проигрыватель музыки: один на всё приложение, с очередью — как в Telegram.
 *
 * Треки берём из переписки (аудиофайлы в сообщениях и постах). Плеер живёт
 * выше экранов, поэтому музыка не обрывается при переходе в другой чат или в
 * профиль; вкладка в фоне и заблокированный экран её тоже не глушат (на iOS
 * для этого уже включён фоновый режим audio).
 *
 * Ссылки на приватные вложения (маркер s3://) подписываем в момент
 * воспроизведения: подпись живёт около часа, заранее готовить всю очередь
 * бессмысленно.
 */
export interface Track {
  id: string;
  /** Как лежит на сервере: /media/... или s3://key. */
  raw: string;
  title: string;
  artist?: string;
  /** Откуда трек — для «Добавить себе» в плеере (RailPlayer): message — файл из
   *  сообщения или поста (id — сообщения), track — трек чужого плейлиста или
   *  эфира (id — трека; token — плейлист по ссылке), mine — уже в моей музыке. */
  source?: "message" | "track" | "mine";
  token?: string;
}

/** Эфир, который сейчас слушаем (@/lib/radio): трек и место в нём задаёт
 *  расписание станции, поэтому перемотка и переключение в этом режиме закрыты. */
export interface LiveInfo {
  stationId: string;
  name: string;
}

/** Что делать, когда трек кончился: ничего, по кругу, повторять один. */
export type RepeatMode = "off" | "all" | "one";

interface State {
  queue: Track[];
  index: number;
  playing: boolean;
  time: number;
  duration: number;
  /** Перемешивание: следующий трек выбирается случайно. */
  shuffle: boolean;
  repeat: RepeatMode;
  /** Громкость 0…1 — нужна на десктопе (на телефоне есть кнопки); помним между запусками. */
  volume: number;
  /** Слушаем эфир — null, когда играет своя очередь. */
  live: LiveInfo | null;
  /** Эфир без звука на этом устройстве: «пауза» слушателя. Эфир не стоит —
   *  трек идёт дальше по расписанию (беззвучно), и следующий не включит звук
   *  сам; playing при этом false — кнопки показывают «играть». */
  liveMuted: boolean;
}

const VOLUME_KEY = "hyax:volume";
const readVolume = () => {
  try { const v = Number(localStorage.getItem(VOLUME_KEY)); return isFinite(v) && v >= 0 && v <= 1 && localStorage.getItem(VOLUME_KEY) !== null ? v : 1; }
  catch { return 1; }
};

let state: State = { queue: [], index: -1, playing: false, time: 0, duration: 0,
                     shuffle: false, repeat: "off", volume: readVolume(), live: null, liveMuted: false };
// Что уже играли в перемешанном порядке: чтобы не повторять одно и то же,
// пока не кончится очередь.
let heard = new Set<number>();
let audio: HTMLAudioElement | null = null;
const subs = new Set<() => void>();

/** Связь с эфиром (@/lib/radio): трек кончился, слушатель снова нажал
 *  «играть» после своей паузы, эфир бросили (включили своё или закрыли). */
let liveHooks: { ended?: () => void; resumed?: () => void; left?: () => void } = {};
export const setLiveHooks = (h: typeof liveHooks) => { liveHooks = h; };

/** Эфир кончился для плеера: своё включили или плеер закрыли. */
const dropLive = () => {
  if (!state.live) return;
  state.live = null;
  state.liveMuted = false;
  if (audio) audio.muted = false;
  liveHooks.left?.();
};

const emit = () => {
  state = { ...state };
  subs.forEach((f) => f());
};

const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const snapshot = () => state;
export const subscribePlayer = subscribe;

/** Откуда очередь — плейлист (свой или чужой по ссылке): по нему lib/playlistResume
 *  запоминает на сервере, где человек остановился. null — музыка из чата, эфир. */
export interface QueueSource { playlistId: string; token?: string }
let source: QueueSource | null = null;
export const queueSource = () => source;

export const usePlayer = () => useSyncExternalStore(subscribe, snapshot, snapshot);
export const playerState = () => state;

export const currentTrack = (): Track | null =>
  state.index >= 0 && state.index < state.queue.length ? state.queue[state.index] : null;

/** Играет ли прямо сейчас именно этот трек (по id сообщения). */
export const isCurrent = (id: string) => currentTrack()?.id === id;

const resolve = async (t: Track) =>
  t.raw.startsWith("s3://") ? await api.signMedia(t.raw) : mediaUrl(t.raw);

/** Метаданные для экрана блокировки и наушников (где поддерживается). */
const updateSession = () => {
  const nav = navigator as Navigator & { mediaSession?: any };
  const t = currentTrack();
  if (!nav.mediaSession || !t) return;
  try {
    const MM = (window as any).MediaMetadata;
    if (MM) nav.mediaSession.metadata = new MM({ title: t.title, artist: t.artist || "WYX" });
    nav.mediaSession.playbackState = state.playing ? "playing" : "paused";
    if (MM && state.live) nav.mediaSession.metadata = new MM({ title: t.title, artist: `${t.artist ? `${t.artist} · ` : ""}📻 ${state.live.name}` });
    nav.mediaSession.setActionHandler("play", () => void toggle());
    nav.mediaSession.setActionHandler("pause", () => void toggle());
    // В эфире треки переключает расписание — кнопки наушников не трогают его.
    nav.mediaSession.setActionHandler("nexttrack", state.live ? null : () => void next());
    nav.mediaSession.setActionHandler("previoustrack", state.live ? null : () => void prev());
  } catch { /* не поддерживается — не беда */ }
};

const attach = (el: HTMLAudioElement) => {
  el.ontimeupdate = () => { state.time = el.currentTime; emit(); };
  el.onloadedmetadata = () => { state.duration = el.duration || 0; emit(); };
  // Эфир без звука: файл идёт (следующий трек тоже стартует), но для
  // человека это пауза — кнопки «играть», экран блокировки «на паузе».
  el.onplay = () => { state.playing = !(state.live && state.liveMuted); emit(); updateSession(); };
  el.onpause = () => { state.playing = false; emit(); updateSession(); };
  el.onended = () => { if (state.live) liveHooks.ended?.(); else void next(true); };
  el.onerror = () => { state.playing = false; emit(); };
};

// Номер запуска: подпись ссылки идёт по сети, и пока она идёт, могли
// включить другой трек. В эфире индекс всегда 0 — сверяем по номеру.
let startSeq = 0;

async function start(index: number, at?: () => number) {
  const t = state.queue[index];
  if (!t) return;
  const seq = ++startSeq;
  state.index = index;
  state.time = 0;
  state.duration = 0;
  emit();
  const src = await resolve(t);
  if (state.index !== index || seq !== startSeq) return; // успели переключить
  if (!audio) { audio = new Audio(); attach(audio); audio.volume = state.volume; }
  audio.muted = !!(state.live && state.liveMuted);
  audio.src = src;
  // Эфир: встаём на место по расписанию, когда файл открылся, — позицию
  // считаем в этот момент, с учётом того, сколько он грузился.
  if (at) {
    const el = audio;
    el.addEventListener("loadedmetadata", () => {
      const pos = at();
      if (pos > 0.3 && isFinite(pos)) el.currentTime = Math.min(pos, (el.duration || pos + 1) - 0.2);
    }, { once: true });
  }
  try {
    await audio.play();
  } catch {
    state.playing = false;
    emit();
  }
  updateSession();
}

/** Поставить очередь и начать с нужного трека. Повторный тап по играющему — пауза.
 *  source — из какого плейлиста очередь; at — с какой секунды (продолжить, где остановился). */
export async function playQueue(queue: Track[], index: number, opts?: { source?: QueueSource; at?: number }) {
  dropLive();
  const same = currentTrack()?.id === queue[index]?.id;
  state.queue = queue;
  source = opts?.source ?? null;
  if (same && audio) { await toggle(); return; }
  const at = opts?.at;
  await start(index, at && at > 1 ? () => at : undefined);
}

export async function toggle() {
  if (!audio || state.index < 0) return;
  // Эфир: «пауза» — тишина на этом устройстве, а не остановка. У остальных
  // эфир идёт как шёл, а у нас при смене трека звук не вернётся сам — только
  // когда человек снова нажмёт «играть», и сразу с того места, где эфир сейчас.
  if (state.live) {
    if (!audio.paused && !state.liveMuted) {
      state.liveMuted = true;
      audio.muted = true;
      state.playing = false;
      emit();
      updateSession();
      return;
    }
    if (state.liveMuted) {
      state.liveMuted = false;
      audio.muted = false;
      state.playing = !audio.paused;
      emit();
    }
    if (audio.paused) { try { await audio.play(); } catch { /* автоплей */ } }
    // Сверка с эфиром: догнать, если звук стоял (или ведущий на паузе — снова встанем).
    liveHooks.resumed?.();
    updateSession();
    return;
  }
  if (audio.paused) {
    try { await audio.play(); } catch { /* автоплей */ }
    // Эфир за паузу ушёл вперёд — догоняем.
    if (state.live) liveHooks.resumed?.();
  }
  else audio.pause();
}

/** Эфир: включить трек с места, которое к моменту загрузки посчитает at(). */
export async function playLive(track: Track, at: () => number, live: LiveInfo) {
  state.live = live;
  source = null;
  state.queue = [track];
  heard = new Set();
  await start(0, at);
}

/** Эфир: подтянуться к расписанию, если разошлись. */
export function liveSeek(sec: number) {
  if (audio && isFinite(sec)) audio.currentTime = Math.max(0, Math.min(sec, (state.duration || sec + 1) - 0.2));
}

/** Эфир на паузе у ведущего — стоим, не теряя трек. */
export function livePause() { audio?.pause(); }

/** Ведущий снял эфир с паузы — играем дальше. */
export async function livePlay() {
  if (audio && audio.paused) { try { await audio.play(); } catch { /* автоплей */ } }
}

/** Следующий по порядку или случайный — смотря как включено перемешивание. */
function nextIndex(): number | null {
  const n = state.queue.length;
  if (!n) return null;
  if (state.shuffle) {
    heard.add(state.index);
    let left = [...Array(n).keys()].filter((i) => !heard.has(i));
    if (!left.length) {
      // Круг закончился: начинаем заново, кроме текущего — иначе один и тот
      // же трек мог бы пойти дважды подряд.
      heard = new Set([state.index]);
      left = [...Array(n).keys()].filter((i) => i !== state.index);
      if (!left.length) return state.repeat === "off" ? null : state.index;
    }
    return left[Math.floor(Math.random() * left.length)];
  }
  if (state.index + 1 < n) return state.index + 1;
  return state.repeat === "all" ? 0 : null;
}

export async function next(auto = false) {
  if (state.live) return;
  // Повтор одного действует только когда трек кончился сам: кнопку «дальше»
  // человек нажимает, чтобы сменить трек, а не услышать тот же.
  if (auto && state.repeat === "one") { await start(state.index); return; }
  const i = nextIndex();
  if (i === null) stop();
  else await start(i);
}

export function toggleShuffle() {
  if (state.live) return;
  state.shuffle = !state.shuffle;
  heard = new Set([state.index]);
  emit();
}

export function cycleRepeat() {
  if (state.live) return;
  state.repeat = state.repeat === "off" ? "all" : state.repeat === "all" ? "one" : "off";
  emit();
}

export async function prev() {
  if (state.live) return;
  // Как в плеерах: первые секунды — в начало трека, дальше — предыдущий.
  if (audio && audio.currentTime > 3) { audio.currentTime = 0; return; }
  if (state.index > 0) await start(state.index - 1);
}

export function setVolume(v: number) {
  state.volume = Math.max(0, Math.min(1, v));
  if (audio) audio.volume = state.volume;
  try { localStorage.setItem(VOLUME_KEY, String(state.volume)); } catch { /* приватный режим */ }
  emit();
}

export function seek(sec: number) {
  if (state.live) return;
  if (audio && isFinite(sec)) audio.currentTime = Math.max(0, Math.min(sec, state.duration || sec));
}

export function stop() {
  dropLive();
  source = null;
  audio?.pause();
  if (audio) audio.src = "";
  // Перемешивание и повтор — настройки человека, они переживают остановку.
  state = { queue: [], index: -1, playing: false, time: 0, duration: 0,
            shuffle: state.shuffle, repeat: state.repeat, volume: state.volume, live: null, liveMuted: false };
  heard = new Set();
  emit();
}

// Запустили видео со звуком (видеофайл в чате, треугольник, пост) — музыка и
// эфир умолкают: два звука разом не нужны. Беззвучные ролики (стикеры,
// обои, превью) и видео звонка (поток камеры, srcObject) не в счёт.
if (typeof document !== "undefined") {
  document.addEventListener("play", (e) => {
    const v = e.target;
    if (!(v instanceof HTMLVideoElement) || v.muted || v.srcObject) return;
    if (state.playing) void toggle();
  }, true);
}

export const fmtTime = (sec: number) => {
  const s = Math.max(0, Math.floor(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
