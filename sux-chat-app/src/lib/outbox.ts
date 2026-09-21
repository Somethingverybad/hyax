/**
 * Очередь отправки вложений — живёт вне экрана чата.
 *
 * Загрузка видео идёт минутами. Раньше её состояние (пузырь с прогрессом,
 * «Не отправлено / Повторить») хранилось только в экране переписки: вышел из
 * чата — пузырь пропадал, и казалось, что отправка сбросилась, хотя файл ещё
 * грузился. Теперь временные сообщения лежат здесь, по чатам: экран при
 * открытии подмешивает их к ленте и подписывается на изменения, а сама
 * загрузка обновляет их, даже когда экрана уже нет.
 */
type Pending = { id: string; chat: string; [key: string]: any };

const byChat = new Map<string, Map<string, Pending>>();
const listeners = new Set<(chatId: string) => void>();
const emit = (chatId: string) => listeners.forEach((l) => l(chatId));

export const outbox = {
  put(chatId: string, msg: Pending) {
    if (!byChat.has(chatId)) byChat.set(chatId, new Map());
    byChat.get(chatId)!.set(msg.id, msg);
    emit(chatId);
  },
  patch(chatId: string, tempId: string, patch: Record<string, unknown>) {
    const m = byChat.get(chatId)?.get(tempId);
    if (!m) return;
    byChat.get(chatId)!.set(tempId, { ...m, ...patch });
    emit(chatId);
  },
  drop(chatId: string, tempId: string) {
    if (byChat.get(chatId)?.delete(tempId)) emit(chatId);
  },
  forChat(chatId: string): Pending[] {
    return [...(byChat.get(chatId)?.values() || [])];
  },
  /** Что сейчас грузится где-то, кроме этого чата — чтобы не терять из виду. */
  subscribe(fn: (chatId: string) => void) {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },
};

/** Подмешать временные сообщения очереди к ленте: обновить уже показанные,
 *  добавить недостающие в конец. Порядок и ключи рендера сохраняются. */
export function mergePending<T extends { id: string }>(list: T[], pending: Pending[]): T[] {
  if (!pending.length) return list;
  const byId = new Map(pending.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const merged = list.map((m) => {
    const p = byId.get(m.id);
    if (!p) return m;
    seen.add(m.id);
    return { ...m, ...p } as T;
  });
  for (const p of pending) if (!seen.has(p.id)) merged.push(p as unknown as T);
  return merged;
}
