/**
 * Место в ленте — переписка, канал, Стена: ушли (в другой чат, на другую
 * вкладку, закрыли приложение) и вернулись — лента на том же месте, а не
 * внизу. Помним верхний видимый элемент и его сдвиг от верхнего края ленты
 * (там шапка «Мяты» — край передаём явно), и нижний видимый — до него лента
 * досмотрена: всё ниже считаем пропущенным (кнопка «вниз» со счётчиком).
 * Прижатую к низу ленту помним просто как «внизу».
 *
 * Элементы ленты находим по атрибуту: у сообщений — id="msg-<id>", у постов —
 * data-post-id. В памяти — сразу, в localStorage — между запусками.
 */
export type FeedPos = { bottom: boolean; id?: string; offset?: number; seen?: string };
export type FeedItems = { selector: string; idOf: (el: HTMLElement) => string | null | undefined };

export const MESSAGE_ITEMS: FeedItems = { selector: '[id^="msg-"]', idOf: (el) => el.id.slice(4) };
export const POST_ITEMS: FeedItems = { selector: "[data-post-id]", idOf: (el) => el.dataset.postId };

const PREFIX = "hyax:feedpos:";
const mem = new Map<string, FeedPos>();

export function readFeedPos(key: string): FeedPos | null {
  if (mem.has(key)) return mem.get(key)!;
  try {
    const v = localStorage.getItem(PREFIX + key);
    const p = v ? (JSON.parse(v) as FeedPos) : null;
    if (p) mem.set(key, p);
    return p;
  } catch { return null; }
}

export function saveFeedPos(key: string, pos: FeedPos) {
  mem.set(key, pos);
  try { localStorage.setItem(PREFIX + key, JSON.stringify(pos)); } catch { /* приватный режим */ }
}

/** Снимок: где лента сейчас. topInset — сколько сверху закрыто шапкой. */
export function captureFeedPos(feed: HTMLElement, items: FeedItems, topInset = 0): FeedPos {
  if (feed.scrollHeight - feed.scrollTop - feed.clientHeight < 40) return { bottom: true };
  const box = feed.getBoundingClientRect();
  const top = box.top + topInset;
  let first: { id: string; offset: number } | null = null;
  let seen: string | undefined;
  for (const el of feed.querySelectorAll<HTMLElement>(items.selector)) {
    const id = items.idOf(el);
    if (!id) continue;
    const r = el.getBoundingClientRect();
    if (!r.height) continue;
    if (!first && r.bottom > top) first = { id, offset: r.top - top };
    if (r.top < box.bottom) seen = id;
    else break;
  }
  return first ? { bottom: false, id: first.id, offset: first.offset, seen } : { bottom: true };
}

/** Вернуть ленту к снимку; false — такого элемента в ленте нет. */
export function restoreFeedPos(feed: HTMLElement, items: FeedItems, pos: FeedPos, topInset = 0): boolean {
  if (!pos.id) return false;
  let el: HTMLElement | null = null;
  for (const e of feed.querySelectorAll<HTMLElement>(items.selector)) { if (items.idOf(e) === pos.id) { el = e; break; } }
  if (!el) return false;
  feed.scrollTop += el.getBoundingClientRect().top - (feed.getBoundingClientRect().top + topInset) - (pos.offset || 0);
  return true;
}

/** id нижнего видимого элемента ленты — до него досмотрено. */
export function lastVisibleId(feed: HTMLElement, items: FeedItems): string | null {
  const bottom = feed.getBoundingClientRect().bottom;
  let seen: string | null = null;
  for (const el of feed.querySelectorAll<HTMLElement>(items.selector)) {
    const r = el.getBoundingClientRect();
    if (!r.height) continue;
    if (r.top < bottom) seen = items.idOf(el) || seen;
    else break;
  }
  return seen;
}
