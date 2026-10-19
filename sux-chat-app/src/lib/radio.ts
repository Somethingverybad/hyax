import { useSyncExternalStore } from "react";
import { api, type PlaylistTrack, type StationState } from "@/api/client";
import { t as tr } from "@/lib/i18n";
import { currentTrack, livePause, livePlay, liveSeek, playerState, playLive, setLiveHooks, stop as stopPlayer, type Track } from "@/lib/player";

/**
 * Эфир: слушаем станцию вместе со всеми.
 *
 * Звук никто не транслирует — играем тот же файл, что у остальных, с той же
 * секунды. Сервер говорит, какой трек идёт и когда он начался по его часам
 * (backend/chat/radio.py); часы сверяем по каждому ответу и берём замер с
 * самой короткой задержкой — он точнее. Расхождение до полутора секунд
 * терпим: подтягивание дёргает звук, а на слух полсекунды не слышно.
 *
 * Сокет приложения живёт только на экране чатов, поэтому изменения эфира
 * (пропуск, пауза) узнаём из отметки «я слушаю» раз в 15 секунд и на каждой
 * смене трека — этого хватает, а работает на любом экране и в фоне.
 */

const HEARTBEAT_MS = 15_000;
/** Больше — догоняем перемоткой. */
const DRIFT_S = 1.5;

interface RadioState {
  stationId: string | null;
  data: StationState | null;
  /** Подключаемся: первый ответ ещё не пришёл. */
  joining: boolean;
}

let state: RadioState = { stationId: null, data: null, joining: false };
const subs = new Set<() => void>();
const emit = () => { state = { ...state }; subs.forEach((f) => f()); };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const useRadio = () => useSyncExternalStore(subscribe, () => state, () => state);
export const radioState = () => state;

// Сверка часов: несколько последних замеров, верим самому быстрому.
let samples: { rtt: number; offset: number }[] = [];
const serverNow = () => {
  if (!samples.length) return Date.now();
  const best = samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
  return Date.now() + best.offset;
};

let beat: ReturnType<typeof setInterval> | null = null;
let boundary: ReturnType<typeof setTimeout> | null = null;

const toQueue = (t: PlaylistTrack): Track => ({ id: t.id, raw: t.file_url, title: t.title, artist: t.artist || undefined, source: "track" });

/** Где должен быть эфир сейчас, в секундах от начала текущего трека. */
const expected = (d: StationState) =>
  d.now ? (d.station.paused ? d.now.position || 0 : (serverNow() - d.now.started_at) / 1000) : 0;

/** Состояние эфира; "gone" — эфира больше нет, null — нет связи (повторим). */
async function fetchState(id: string): Promise<StationState | "gone" | null> {
  const t0 = Date.now();
  try {
    const d = await api.listenStation(id);
    const t1 = Date.now();
    samples = [...samples.slice(-4), { rtt: t1 - t0, offset: d.server_now - (t0 + t1) / 2 }];
    return d;
  } catch (e) {
    return (e as { gone?: boolean })?.gone ? "gone" : null;
  }
}

/** Привести плеер к расписанию. */
function apply(d: StationState) {
  if (state.stationId !== d.station.id) return;
  const wasPaused = !!state.data?.station.paused;
  state.data = d;
  state.joining = false;
  emit();
  if (boundary) { clearTimeout(boundary); boundary = null; }
  if (!d.now) { livePause(); return; }
  const live = { stationId: d.station.id, name: d.station.is_default ? tr(d.station.name) : d.station.name };
  const playing = currentTrack();
  const p = playerState();
  if (!p.live || p.live.stationId !== d.station.id || playing?.id !== d.now.track.id) {
    const startedAt = d.now.started_at;
    const position = d.now.position || 0;
    void playLive(toQueue(d.now.track), () => (d.station.paused ? position : (serverNow() - startedAt) / 1000), live)
      .then(() => { if (state.data?.station.paused) livePause(); });
  } else if (d.station.paused) {
    // Узнали о паузе с опозданием (до 15 с) — встаём туда, где встал эфир.
    livePause();
    if (Math.abs(p.time - (d.now.position || 0)) > DRIFT_S) liveSeek(d.now.position || 0);
  } else if (wasPaused) {
    // Ведущий снял паузу: своя пауза слушателя тут ни при чём — играем.
    liveSeek(expected(d));
    void livePlay();
  } else if ((p.playing || p.liveMuted) && Math.abs(p.time - expected(d)) > DRIFT_S) {
    // И без звука держим место по расписанию: включат — звук сразу где надо.
    liveSeek(expected(d));
  }
  // Смена трека — по расписанию, а не по концу файла: длительность в
  // расписании и у файла могут чуть разойтись, а эфир у всех должен
  // переключиться разом.
  if (!d.station.paused) {
    const end = d.next[0]?.started_at ?? (d.now.started_at + (d.now.track.duration || 0) * 1000);
    const wait = Math.max(200, end - serverNow() + 150);
    boundary = setTimeout(() => void refresh(), wait);
  }
}

// Один запрос за раз: конец файла и таймер смены трека срабатывают почти
// одновременно — второй запрос только перебил бы первый.
let inflight = false;
let again = false;

async function refresh() {
  if (inflight) { again = true; return; }
  inflight = true;
  try { await refreshOnce(); }
  finally {
    inflight = false;
    if (again) { again = false; void refresh(); }
  }
}

async function refreshOnce() {
  const id = state.stationId;
  if (!id) return;
  const d = await fetchState(id);
  if (state.stationId !== id) return;
  // Эфир остановили (или он нам больше не виден).
  if (d === "gone") { endedByHost(); return; }
  if (!d) {
    // Нет связи — ещё раз чуть позже, не дожидаясь отметки.
    if (boundary) clearTimeout(boundary);
    boundary = setTimeout(() => void refresh(), 1500);
    return;
  }
  apply(d);
}

let onEnded: ((msg: string) => void) | null = null;
/** Кто покажет «эфир закончился» (тост ставит экран, а не модуль). */
export const setRadioNotice = (f: ((msg: string) => void) | null) => { onEnded = f; };

function endedByHost() {
  const id = state.stationId;
  cleanup();
  stopPlayer();
  if (id) onEnded?.(tr("Эфир закончился"));
}

function cleanup() {
  if (beat) { clearInterval(beat); beat = null; }
  if (boundary) { clearTimeout(boundary); boundary = null; }
  state = { stationId: null, data: null, joining: false };
  emit();
}

const onVisible = () => { if (document.visibilityState === "visible" && state.stationId) void refresh(); };

setLiveHooks({
  // Файл кончился раньше расписания — ждём переключения (таймер стоит);
  // если позже — таймер уже сработал. Подстраховка: свериться сейчас.
  ended: () => { if (!boundary) void refresh(); },
  resumed: () => void refresh(),
  // Включили своё или закрыли плеер — эфир бросили.
  left: () => {
    const id = state.stationId;
    cleanup();
    if (id) void api.leaveStation(id);
  },
});

/** Подключиться к эфиру. Повторно к тому же — просто свериться. */
export async function joinStation(id: string, initial?: StationState) {
  if (state.stationId === id) { void refresh(); return; }
  if (state.stationId) leaveStation();
  state = { stationId: id, data: initial || null, joining: true };
  emit();
  if (!beat) beat = setInterval(() => void refresh(), HEARTBEAT_MS);
  document.removeEventListener("visibilitychange", onVisible);
  document.addEventListener("visibilitychange", onVisible);
  const d = await fetchState(id);
  if (state.stationId !== id) return;
  if (d === "gone") { endedByHost(); return; }
  if (!d) { boundary = setTimeout(() => void refresh(), 1500); return; }
  apply(d);
}

/** Выйти из эфира: плеер замолкает, сервер перестаёт считать нас слушателем. */
export function leaveStation() {
  const id = state.stationId;
  cleanup();
  if (playerState().live) stopPlayer();
  if (id) void api.leaveStation(id);
}

/** Ведущий что-то поменял — сразу применяем ответ, не дожидаясь отметки. */
export function applyControl(d: StationState) {
  if (state.stationId === d.station.id) apply(d);
}
