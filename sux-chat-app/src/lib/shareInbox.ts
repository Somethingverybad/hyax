import { Capacitor, registerPlugin } from "@capacitor/core";

/**
 * «Поделиться → WYX» из других приложений (iOS Share Extension).
 *
 * Расширение складывает файлы в общий контейнер и открывает приложение по
 * `whoyax://share`. Здесь забираем их у нативного плагина ShareInbox, читаем
 * как File (через capacitor://localhost/_capacitor_file_/…) и держим в
 * очереди, пока человек выбирает чат; ChatWindow при открытии чата забирает
 * очередь и подставляет файлы в поле ввода как обычные вложения.
 */
interface ShareInboxPlugin {
  take(): Promise<{ items: { path: string; name: string; type: string }[]; text: string }>;
  clear(): Promise<void>;
}
const plugin = registerPlugin<ShareInboxPlugin>("ShareInbox");

export interface SharedPayload { files: File[]; text: string }

/** Забрать то, что положило расширение; пусто — если ничего нет. */
export async function takeSharedItems(): Promise<SharedPayload | null> {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const r = await plugin.take();
    if (!r.items.length && !r.text) return null;
    const files: File[] = [];
    for (const it of r.items) {
      try {
        const res = await fetch(Capacitor.convertFileSrc(it.path));
        const blob = await res.blob();
        files.push(new File([blob], it.name, { type: it.type || blob.type || "application/octet-stream" }));
      } catch { /* файл не прочитался — пропускаем, остальное отправим */ }
    }
    // Файлы уже в памяти — контейнер можно чистить.
    plugin.clear().catch(() => {});
    if (!files.length && !r.text) return null;
    return { files, text: r.text };
  } catch {
    // Старая нативная сборка без плагина.
    return null;
  }
}

/** Присланное отложено — уже открытый чат забирает его сразу (ниже). */
export const SHARE_PENDING_EVENT = "hyax:share-pending";
let pending: { payload: SharedPayload; target: string | null } | null = null;
/** Отложить до открытия выбранного чата (target — его id, «wall» — Стена).
 *  Событие — для чата, который уже открыт: эффект открытия у него не
 *  повторится, и присланное лежало бы невостребованным — поле ввода
 *  оставалось пустым, если делились в ту же переписку, где был человек
 *  (баг-репорт 75189134; с холодного старта чат открывался заново). */
export const setPendingShare = (p: SharedPayload | null, target: string | null = null) => {
  pending = p ? { payload: p, target } : null;
  if (p) window.dispatchEvent(new Event(SHARE_PENDING_EVENT));
};
/** Забрать отложенное (один раз), если оно для этого чата. */
export const takePendingShare = (chatId: string): SharedPayload | null => {
  if (!pending || (pending.target && pending.target !== chatId)) return null;
  const p = pending.payload;
  pending = null;
  return p;
};
