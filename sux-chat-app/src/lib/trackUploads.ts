import { useSyncExternalStore } from "react";
import { api } from "@/api/client";
import { applog } from "@/lib/applog";
import { t as tr } from "@/lib/i18n";

/**
 * Очередь загрузки своих треков (экран «Музыка»).
 *
 * Живёт выше экранов: можно уйти в чат, загрузка идёт дальше. Файлы — по
 * одному, с процентами. Оборвалось (заблокировали экран, моргнула сеть,
 * сервер не ответил) — трек встаёт обратно в очередь и пробует снова: сразу,
 * как приложение вернулось на экран или появилась сеть, иначе — с паузой.
 * Повтор не плодит дубли: у каждого файла своя метка, и если в прошлый раз
 * трек уже дошёл, а ответ потерялся, сервер вернёт тот же (client_id).
 * «Это не музыка» и прочие отказы сервера не повторяем — это не изменится.
 *
 * Файлы держим в памяти: приложение закрыли — очередь пропала (выбрать заново).
 */

export type UploadStatus = "queued" | "uploading" | "done" | "error";
export interface UploadItem {
  id: string;
  name: string;
  playlistId: string;
  status: UploadStatus;
  progress: number;
  attempts: number;
  error?: string;
}

interface QueueState { items: UploadItem[] }

const AUDIO = /\.(mp3|m4a|aac|flac|wav|ogg|oga|opus|aif|aiff|alac|wma)$/i;
/** Отказ сервера повторять бессмысленно (кроме таймаута и лимита частоты). */
const permanent = (status?: number) => !!status && status >= 400 && status < 500 && status !== 408 && status !== 429;
const MAX_ATTEMPTS = 8;

let state: QueueState = { items: [] };
const files = new Map<string, File>();
const subs = new Set<() => void>();
const emit = () => { state = { items: [...state.items] }; subs.forEach((f) => f()); };
const patch = (id: string, p: Partial<UploadItem>) => {
  state.items = state.items.map((x) => (x.id === id ? { ...x, ...p } : x));
  emit();
};

export const useTrackUploads = () =>
  useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => state, () => state);

/** Музыка ли это (по типу или расширению) — из папки берём только её. */
export const isAudioFile = (f: File) => f.type.startsWith("audio/") || AUDIO.test(f.name);

/** Добавить файлы в очередь; не музыку пропускаем. Возвращает, сколько взяли. */
export function enqueueTracks(list: File[], playlistId: string): number {
  const audio = list.filter(isAudioFile);
  for (const f of audio) {
    const id = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    files.set(id, f);
    state.items.push({ id, name: f.name, playlistId, status: "queued", progress: 0, attempts: 0 });
  }
  if (audio.length) { emit(); kick(); }
  return audio.length;
}

/** Снова поставить в очередь то, что не загрузилось. */
export function retryFailed() {
  state.items = state.items.map((x) => (x.status === "error" && files.has(x.id) ? { ...x, status: "queued", attempts: 0, error: undefined } : x));
  emit();
  kick();
}

/** Убрать из списка загруженное и не загрузившееся (кнопка «Готово»). */
export function clearFinished() {
  for (const x of state.items) if (x.status === "done" || x.status === "error") files.delete(x.id);
  state.items = state.items.filter((x) => x.status === "queued" || x.status === "uploading");
  emit();
}

let running = false;
let wake: ReturnType<typeof setTimeout> | null = null;

/** Разбудить очередь (после паузы между попытками — сразу). */
function kick() {
  if (wake) { clearTimeout(wake); wake = null; }
  if (!running) void run();
}

async function run() {
  running = true;
  try {
    for (;;) {
      const next = state.items.find((x) => x.status === "queued");
      if (!next) break;
      const file = files.get(next.id);
      if (!file) { patch(next.id, { status: "error", error: tr("Файл недоступен — выберите его снова") }); continue; }
      patch(next.id, { status: "uploading", progress: 0, attempts: next.attempts + 1 });
      try {
        await api.uploadTrack(file, next.playlistId, { clientId: next.id, onProgress: (p) => patch(next.id, { progress: p }) });
        files.delete(next.id);
        patch(next.id, { status: "done", progress: 100 });
        window.dispatchEvent(new CustomEvent("hyax:track-uploaded", { detail: { playlistId: next.playlistId } }));
      } catch (e) {
        const err = e as Error & { status?: number };
        const tries = next.attempts + 1;
        if (permanent(err.status) || tries >= MAX_ATTEMPTS) {
          patch(next.id, { status: "error", error: err.message || tr("Не удалось загрузить") });
          continue;
        }
        // Сеть оборвалась — назад в очередь, следующая попытка с паузой
        // (или сразу, когда приложение вернётся на экран / появится сеть).
        applog.warn(`music upload: ${next.name} — повторю (${err.status ?? "сеть"})`);
        patch(next.id, { status: "queued", progress: 0 });
        const delay = Math.min(60_000, 2000 * 2 ** (tries - 1));
        wake = setTimeout(() => { wake = null; void run(); }, delay);
        return;
      }
    }
  } finally {
    running = false;
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("online", kick);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") kick(); });
}
