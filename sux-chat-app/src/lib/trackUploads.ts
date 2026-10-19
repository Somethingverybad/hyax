import { useSyncExternalStore } from "react";
import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { api, getFreshAccessToken, uploadTargets } from "@/api/client";
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
 * Компьютер и веб: файлы держим в памяти, приложение закрыли — очередь
 * пропала (выбрать заново).
 *
 * Телефон (сборки с плагином MusicUpload — iOS 193+, APK с ним): выбор файлов
 * и папок — системный, а отправляет сама система (iOS — фоновая сессия,
 * Android — служба с уведомлением), так что загрузка идёт и при
 * заблокированном экране. Очередь переживает перезапуск: при старте спрашиваем
 * у плагина, что ещё грузится и чем кончилось без нас. На старых сборках
 * (новый интерфейс приехал по воздуху) плагина нет — работает как в вебе.
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

interface QueueState { items: UploadItem[]; preparing: boolean }

const AUDIO = /\.(mp3|m4a|aac|flac|wav|ogg|oga|opus|aif|aiff|alac|wma)$/i;
/** Отказ сервера повторять бессмысленно (кроме таймаута и лимита частоты). */
const permanent = (status?: number) => !!status && status >= 400 && status < 500 && status !== 408 && status !== 429;
const MAX_ATTEMPTS = 8;

let state: QueueState = { items: [], preparing: false };
const files = new Map<string, File>();
const subs = new Set<() => void>();
const emit = () => { state = { ...state, items: [...state.items] }; subs.forEach((f) => f()); };
const patch = (id: string, p: Partial<UploadItem>) => {
  state.items = state.items.map((x) => (x.id === id ? { ...x, ...p } : x));
  emit();
};
const newId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
const uploadPath = (playlistId: string) => (playlistId ? `/playlists/${playlistId}/tracks/upload/` : "/playlists/tracks/upload/");

export const useTrackUploads = () =>
  useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => state, () => state);

/** Музыка ли это (по типу или расширению) — из папки берём только её. */
export const isAudioFile = (f: File) => f.type.startsWith("audio/") || AUDIO.test(f.name);

/** Добавить файлы в очередь; не музыку пропускаем. Возвращает, сколько взяли. */
export function enqueueTracks(list: File[], playlistId: string): number {
  const audio = list.filter(isAudioFile);
  for (const f of audio) {
    const id = newId();
    files.set(id, f);
    state.items.push({ id, name: f.name, playlistId, status: "queued", progress: 0, attempts: 0 });
  }
  if (audio.length) { emit(); kick(); }
  return audio.length;
}

/** Снова поставить в очередь то, что не загрузилось. */
export function retryFailed() {
  const again = state.items.filter((x) => x.status === "error" && (files.has(x.id) || nativePaths.has(x.id)));
  state.items = state.items.map((x) => (again.includes(x) ? { ...x, status: "queued", attempts: 0, error: undefined } : x));
  emit();
  for (const x of again) if (nativePaths.has(x.id)) void sendNative(x.id);
  kick();
}

/** Убрать из списка загруженное и не загрузившееся (кнопка «Готово»). */
export function clearFinished() {
  const gone = state.items.filter((x) => x.status === "done" || x.status === "error");
  for (const x of gone) files.delete(x.id);
  const nativeGone = gone.filter((x) => nativePaths.has(x.id)).map((x) => x.id);
  nativeGone.forEach((id) => nativePaths.delete(id));
  if (nativeGone.length) void MusicUpload.forget({ ids: nativeGone }).catch(() => {});
  state.items = state.items.filter((x) => x.status === "queued" || x.status === "uploading");
  emit();
}

let running = false;
let wake: ReturnType<typeof setTimeout> | null = null;

/** Разбудить очередь (после паузы между попытками — сразу). */
function kick() {
  if (wake) { clearTimeout(wake); wake = null; }
  if (!running) void run();
  retryNativeNow();
}

async function run() {
  running = true;
  try {
    for (;;) {
      const next = state.items.find((x) => x.status === "queued" && files.has(x.id));
      if (!next) break;
      const file = files.get(next.id)!;
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

// ===== телефон: плагин MusicUpload =====

interface PickedFile { path: string; name: string; size: number }
interface NativeItem {
  id: string;
  name?: string;
  meta?: string;
  status: "uploading" | "done" | "failed";
  progress: number;
  http: number;
  error?: string;
}
interface MusicUploadPlugin {
  pick(o: { folder?: boolean }): Promise<{ files: PickedFile[] }>;
  upload(o: { id: string; path: string; name: string; urls: string[]; token: string; fields: Record<string, string>; meta: string }): Promise<void>;
  list(): Promise<{ items: NativeItem[] }>;
  forget(o: { ids: string[] }): Promise<void>;
  addListener(ev: "progress" | "done" | "failed", cb: (d: NativeItem) => void): Promise<PluginListenerHandle>;
  addListener(ev: "picking", cb: (d: { count: number }) => void): Promise<PluginListenerHandle>;
}
const MusicUpload = registerPlugin<MusicUploadPlugin>("MusicUpload");

/** Есть ли нативная загрузка (телефон со сборкой, где плагин уже есть). */
export const nativeTrackUploads = Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("MusicUpload");

/** Копия трека у плагина (для повтора) — по метке загрузки. */
const nativePaths = new Map<string, string>();
/** Ждут повтора после неудачи — с паузой или до возврата на экран. */
const nativeRetry = new Map<string, ReturnType<typeof setTimeout>>();
let picked = false;

/** Выбрать треки системным окном (файлы или папку с вложенными) и поставить в
 *  очередь. Возвращает, сколько взяли, или null — если выбор отменили. */
export async function pickNativeTracks(playlistId: string, folder: boolean): Promise<number | null> {
  picked = false;
  let list: PickedFile[] = [];
  try {
    list = (await MusicUpload.pick({ folder })).files || [];
  } finally {
    state.preparing = false;
    emit();
  }
  if (!list.length) return picked ? 0 : null;
  for (const f of list) {
    const id = newId();
    nativePaths.set(id, f.path);
    state.items.push({ id, name: f.name, playlistId, status: "queued", progress: 0, attempts: 0 });
  }
  emit();
  // По порядку: плагин сам шлёт по одному, но очередь ставим как выбрали.
  for (const f of list) {
    const it = state.items.find((x) => nativePaths.get(x.id) === f.path);
    if (it) await sendNative(it.id);
  }
  return list.length;
}

/** Отдать трек плагину (первый раз или повтор — с новым токеном). */
async function sendNative(id: string) {
  const it = state.items.find((x) => x.id === id);
  const path = nativePaths.get(id);
  if (!it || !path) return;
  const t = nativeRetry.get(id);
  if (t) { clearTimeout(t); nativeRetry.delete(id); }
  patch(id, { status: "queued", progress: 0, attempts: it.attempts + 1, error: undefined });
  try {
    await MusicUpload.upload({
      id, path, name: it.name,
      urls: uploadTargets(uploadPath(it.playlistId)),
      token: (await getFreshAccessToken()) || "",
      fields: { client_id: id },
      meta: JSON.stringify({ playlistId: it.playlistId, path }),
    });
  } catch (e) {
    const msg = (e as Error).message;
    patch(id, { status: "error", error: msg ? tr(msg) : tr("Не удалось загрузить") });
  }
}

function onNativeDone(d: NativeItem) {
  const it = state.items.find((x) => x.id === d.id);
  nativePaths.delete(d.id);
  void MusicUpload.forget({ ids: [d.id] }).catch(() => {});
  if (!it || it.status === "done") return;
  patch(d.id, { status: "done", progress: 100 });
  window.dispatchEvent(new CustomEvent("hyax:track-uploaded", { detail: { playlistId: it.playlistId } }));
}

/** Не дошло: отказ сервера — показать; сеть или токен — повторить с паузой. */
function onNativeFailed(d: NativeItem) {
  const it = state.items.find((x) => x.id === d.id);
  if (!it) return;
  const retryable = !permanent(d.http) || d.http === 401;
  if (!retryable || it.attempts >= MAX_ATTEMPTS) {
    const msg = d.error ? tr(d.error) : (d.http === 413 ? tr("Файл слишком большой для сервера")
      : d.http ? tr("Загрузка не удалась ({code})", { code: d.http }) : tr("Сеть оборвала загрузку"));
    patch(d.id, { status: "error", progress: 0, error: msg });
    return;
  }
  applog.warn(`music upload (native): ${it.name} — повторю (${d.http || "сеть"})`);
  patch(d.id, { status: "queued", progress: 0 });
  const delay = Math.min(60_000, 2000 * 2 ** Math.max(0, it.attempts - 1));
  nativeRetry.set(d.id, setTimeout(() => { nativeRetry.delete(d.id); void sendNative(d.id); }, delay));
}

/** Вернулись на экран или появилась сеть — повторить ждущие сразу. */
function retryNativeNow() {
  for (const id of [...nativeRetry.keys()]) void sendNative(id);
}

function onNativeProgress(d: NativeItem) {
  const it = state.items.find((x) => x.id === d.id);
  if (!it || it.status === "done" || it.status === "error") return;
  patch(d.id, { status: d.progress > 0 ? "uploading" : "queued", progress: d.progress });
}

/** При запуске: что плагин грузит или догрузил, пока интерфейса не было. */
async function restoreNative() {
  const { items } = await MusicUpload.list().catch(() => ({ items: [] as NativeItem[] }));
  const sorted = [...items].sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const d of sorted) {
    if (state.items.some((x) => x.id === d.id)) continue;
    let meta: { playlistId?: string; path?: string } = {};
    try { meta = JSON.parse(d.meta || "{}"); } catch { /* пусто */ }
    if (meta.path) nativePaths.set(d.id, meta.path);
    state.items.push({ id: d.id, name: d.name || "track", playlistId: meta.playlistId || "", status: "queued", progress: 0, attempts: 1 });
  }
  emit();
  for (const d of sorted) {
    if (d.status === "done") onNativeDone(d);
    else if (d.status === "failed") onNativeFailed(d);
    else onNativeProgress(d);
  }
}

if (nativeTrackUploads) {
  void MusicUpload.addListener("progress", onNativeProgress);
  void MusicUpload.addListener("done", onNativeDone);
  void MusicUpload.addListener("failed", onNativeFailed);
  void MusicUpload.addListener("picking", () => { picked = true; state.preparing = true; emit(); });
  void restoreNative();
}

if (typeof window !== "undefined") {
  window.addEventListener("online", kick);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") kick(); });
}
