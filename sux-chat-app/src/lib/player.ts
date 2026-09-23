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
}

let state: State = { queue: [], index: -1, playing: false, time: 0, duration: 0,
                     shuffle: false, repeat: "off" };
// Что уже играли в перемешанном порядке: чтобы не повторять одно и то же,
// пока не кончится очередь.
let heard = new Set<number>();
let audio: HTMLAudioElement | null = null;
const subs = new Set<() => void>();

const emit = () => {
  state = { ...state };
  subs.forEach((f) => f());
};

const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const snapshot = () => state;

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
    if (MM) nav.mediaSession.metadata = new MM({ title: t.title, artist: t.artist || "WhoYaX" });
    nav.mediaSession.playbackState = state.playing ? "playing" : "paused";
    nav.mediaSession.setActionHandler("play", () => void toggle());
    nav.mediaSession.setActionHandler("pause", () => void toggle());
    nav.mediaSession.setActionHandler("nexttrack", () => void next());
    nav.mediaSession.setActionHandler("previoustrack", () => void prev());
  } catch { /* не поддерживается — не беда */ }
};

const attach = (el: HTMLAudioElement) => {
  el.ontimeupdate = () => { state.time = el.currentTime; emit(); };
  el.onloadedmetadata = () => { state.duration = el.duration || 0; emit(); };
  el.onplay = () => { state.playing = true; emit(); updateSession(); };
  el.onpause = () => { state.playing = false; emit(); updateSession(); };
  el.onended = () => { void next(true); };
  el.onerror = () => { state.playing = false; emit(); };
};

async function start(index: number) {
  const t = state.queue[index];
  if (!t) return;
  state.index = index;
  state.time = 0;
  state.duration = 0;
  emit();
  const src = await resolve(t);
  if (state.index !== index) return; // успели переключить
  if (!audio) { audio = new Audio(); attach(audio); }
  audio.src = src;
  try {
    await audio.play();
  } catch {
    state.playing = false;
    emit();
  }
  updateSession();
}

/** Поставить очередь и начать с нужного трека. Повторный тап по играющему — пауза. */
export async function playQueue(queue: Track[], index: number) {
  const same = currentTrack()?.id === queue[index]?.id;
  state.queue = queue;
  if (same && audio) { await toggle(); return; }
  await start(index);
}

export async function toggle() {
  if (!audio || state.index < 0) return;
  if (audio.paused) { try { await audio.play(); } catch { /* автоплей */ } }
  else audio.pause();
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
  // Повтор одного действует только когда трек кончился сам: кнопку «дальше»
  // человек нажимает, чтобы сменить трек, а не услышать тот же.
  if (auto && state.repeat === "one") { await start(state.index); return; }
  const i = nextIndex();
  if (i === null) stop();
  else await start(i);
}

export function toggleShuffle() {
  state.shuffle = !state.shuffle;
  heard = new Set([state.index]);
  emit();
}

export function cycleRepeat() {
  state.repeat = state.repeat === "off" ? "all" : state.repeat === "all" ? "one" : "off";
  emit();
}

export async function prev() {
  // Как в плеерах: первые секунды — в начало трека, дальше — предыдущий.
  if (audio && audio.currentTime > 3) { audio.currentTime = 0; return; }
  if (state.index > 0) await start(state.index - 1);
}

export function seek(sec: number) {
  if (audio && isFinite(sec)) audio.currentTime = Math.max(0, Math.min(sec, state.duration || sec));
}

export function stop() {
  audio?.pause();
  if (audio) audio.src = "";
  // Перемешивание и повтор — настройки человека, они переживают остановку.
  state = { queue: [], index: -1, playing: false, time: 0, duration: 0,
            shuffle: state.shuffle, repeat: state.repeat };
  heard = new Set();
  emit();
}

export const fmtTime = (sec: number) => {
  const s = Math.max(0, Math.floor(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
