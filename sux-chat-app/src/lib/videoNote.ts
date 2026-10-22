import { useLayoutEffect, useRef, useSyncExternalStore } from "react";

/**
 * Видео-сообщение («треугольник»), которое сейчас играет: одно на всё
 * приложение, как плеер музыки (lib/player). Один-единственный <video>
 * живёт вне React и переезжает между тремя местами: треугольник в ленте
 * (inline), экран целиком (full) и плавающий виджет (float) — когда
 * треугольник уехал за край ленты или из чата вышли. Так ролик не
 * прерывается и не грузится заново при каждом переезде.
 *
 * Переезд — appendChild в новую коробку. Браузер ставит видео на паузу,
 * если элемент остался вне документа до конца текущей задачи, поэтому
 * коробка, теряя элемент (useLayoutEffect-cleanup — DOM ещё на месте),
 * сразу отдаёт его в «парковку» — скрытый div в body; оттуда его забирает
 * следующая коробка. Коробки описаны хуком useNoteHost.
 */
export interface NoteInfo {
  /** id сообщения или поста. */
  id: string;
  /** Чат, где лежит сообщение: плашка управления (VideoNoteBar) показывается в нём. */
  chatId?: string;
  sender?: { id: string; username: string; avatar_url?: string | null } | null;
  /** Когда отправлено — подпись в плашке. */
  at?: string;
  /** Готовая (подписанная) ссылка на файл. */
  src: string;
  poster?: string | null;
  /** Съёмка фронтальной камерой — отражаем, как в ленте. */
  mirror?: boolean;
  /** Треугольник вершиной вниз. */
  flip?: boolean;
  seconds: number;
}

/** inline — обычный треугольник в ленте; big — он же, увеличенный на месте (как в
 *  Telegram); float — виджет, когда уехал из виду или вышли из чата. */
export type NoteMode = "inline" | "big" | "float";

interface State {
  note: NoteInfo | null;
  mode: NoteMode;
  playing: boolean;
  time: number;
  duration: number;
  /** Скорость 0.5…2, общая для всех треугольников. */
  rate: number;
}

let state: State = { note: null, mode: "inline", playing: false, time: 0, duration: 0, rate: 1 };
let video: HTMLVideoElement | null = null;
let parking: HTMLDivElement | null = null;
/** Треугольник в ленте сейчас на экране и может принять видео. */
let inlineAvailable = false;
/** Человек хочет, чтобы играло (не нажимал паузу): после переезда, если
 *  браузер всё же остановил, запускаем снова. */
let wantPlaying = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const set = (patch: Partial<State>) => { state = { ...state, ...patch }; emit(); };

const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const useVideoNote = () => useSyncExternalStore(subscribe, () => state, () => state);
/** Срез состояния примитивом — подписчик перерисовывается только когда он меняется. */
export const useVideoNoteSlice = <T extends string | number | boolean | null>(pick: (s: State) => T) =>
  useSyncExternalStore(subscribe, () => pick(state), () => pick(state));
export const videoNoteState = () => state;

const ensureParking = () => {
  if (parking) return parking;
  parking = document.createElement("div");
  parking.setAttribute("aria-hidden", "true");
  parking.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;pointer-events:none;";
  document.body.appendChild(parking);
  return parking;
};

const ensureVideo = () => {
  if (video) return video;
  const v = document.createElement("video");
  v.playsInline = true;
  v.setAttribute("playsinline", "");
  v.setAttribute("webkit-playsinline", "");
  v.preload = "auto";
  v.className = "absolute inset-0 w-full h-full";
  v.ontimeupdate = () => set({ time: v.currentTime });
  v.onloadedmetadata = () => set({ duration: Number.isFinite(v.duration) && v.duration > 0 ? v.duration : state.note?.seconds || 0 });
  v.ondurationchange = () => { if (Number.isFinite(v.duration) && v.duration > 0) set({ duration: v.duration }); };
  v.onplay = () => set({ playing: true });
  v.onpause = () => set({ playing: false });
  v.onended = () => stopNote();
  v.onerror = () => stopNote();
  ensureParking().appendChild(v);
  video = v;
  return v;
};

export interface HostStyle {
  fit: "cover" | "contain";
  /** clip-path треугольника: на самом видео, не на обёртке — слой видео в
   *  Android WebView обёртку не слушает. */
  clip?: string;
}

/** Переставить видео в коробку host и одеть под неё. */
export function placeNote(host: HTMLElement, style: HostStyle) {
  const v = ensureVideo();
  if (v.parentElement !== host) host.appendChild(v);
  v.style.objectFit = style.fit;
  v.style.clipPath = style.clip || "";
  v.style.transform = state.note?.mirror ? "scaleX(-1)" : "";
  if (wantPlaying && v.paused && state.note) v.play().catch(() => {});
}

/** Коробка потеряла видео (уходит из DOM) — в парковку, пока не заберут. */
export function parkNote(host: HTMLElement) {
  if (video && video.parentElement === host) ensureParking().appendChild(video);
}

/** Тап по треугольнику в ленте: играть с начала, со звуком, сразу увеличенным. */
export function startNote(info: NoteInfo) {
  const v = ensureVideo();
  wantPlaying = true;
  inlineAvailable = true;
  set({ note: info, mode: "big", playing: false, time: 0, duration: info.seconds });
  if (v.src !== info.src) v.src = info.src;
  if (info.poster) v.poster = info.poster; else v.removeAttribute("poster");
  v.muted = false;
  v.defaultPlaybackRate = state.rate;
  v.playbackRate = state.rate;
  try { v.currentTime = 0; } catch { /* ещё не открыт */ }
  v.play().catch(() => {});
}

export function setNoteRate(rate: number) {
  set({ rate });
  if (video) { video.defaultPlaybackRate = rate; video.playbackRate = rate; }
}

export function stopNote() {
  wantPlaying = false;
  if (video) {
    video.pause();
    video.removeAttribute("src");
    try { video.load(); } catch { /* не страшно */ }
    ensureParking().appendChild(video);
  }
  set({ note: null, mode: "inline", playing: false, time: 0, duration: 0 });
}

export function toggleNote() {
  const v = video;
  if (!v || !state.note) return;
  if (v.paused) { wantPlaying = true; v.play().catch(() => {}); }
  else { wantPlaying = false; v.pause(); }
}

export function seekNote(sec: number) {
  const v = video;
  if (!v || !state.note) return;
  const d = state.duration || v.duration || 0;
  const t = Math.max(0, Math.min(sec, d > 0 ? d - 0.05 : sec));
  try { v.currentTime = t; } catch { /* нет метаданных */ }
  set({ time: t });
}

/** ±N секунд (тапы по краям экрана). */
export const nudgeNote = (delta: number) => seekNote((video?.currentTime || 0) + delta);

/** Треугольник сообщения id в ленте появился (visible) или скрылся/размонтирован. */
export function inlineNote(id: string, visible: boolean) {
  if (state.note?.id !== id) return;
  inlineAvailable = visible;
  if (visible && state.mode === "float") set({ mode: "inline" });
  else if (!visible && state.mode !== "float") set({ mode: "float" });
}

/** Увеличить треугольник на месте (тап по играющему) и вернуть к обычному размеру. */
export function openNoteBig() {
  if (state.note && inlineAvailable) set({ mode: "big" });
}
export function closeNoteBig() {
  if (state.note && state.mode === "big") set({ mode: "inline" });
}

export const fmtNoteTime = (sec: number) => {
  const s = Math.max(0, Math.floor(sec || 0));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

/** Коробка для видео: пока hold — забирает элемент к себе (useLayoutEffect:
 *  сразу после вставки своего DOM), теряя его — паркует (cleanup идёт до
 *  удаления узла, видео не выпадает из документа и не встаёт на паузу). */
export function useNoteHost(hold: boolean, style: HostStyle) {
  const ref = useRef<HTMLDivElement | null>(null);
  const styleRef = useRef(style);
  styleRef.current = style;
  useLayoutEffect(() => {
    const host = ref.current;
    if (!hold || !host) return;
    placeNote(host, styleRef.current);
    return () => parkNote(host);
  }, [hold, style.fit, style.clip]);
  return ref;
}
