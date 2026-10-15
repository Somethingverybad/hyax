import { mediaUrl } from "@/api/client";
import { NOTO_CODES } from "@/lib/notoEmojiList";

/**
 * Анимированные эмодзи Google Noto (Noto Emoji Animation, CC BY 4.0).
 *
 * Файлы лежат у нас (/media/noto/<код>/…): клиент к Google не ходит, и
 * реакции не ломаются, когда Google недоступен. Статичная картинка
 * (emoji.svg) — обычный вид, анимация (lottie.json) — один проигрыш по
 * поводу: реакцию поставили, нажали, сообщение из эмодзи появилось на экране.
 *
 * Анимации кэшируем сами (память + IndexedDB): CDN отдаёт медиа с
 * max-age=0, и без этого каждая реакция заново качалась бы с сервера.
 */
const CODES = new Set(NOTO_CODES.split(" ").filter(Boolean));

/** Последовательность эмодзи: флаг из двух букв-регионов или пиктограмма с
 *  вариантом/оттенком кожи и цепочкой через ZWJ (❤️‍🔥, 🤷‍♀️, 👍🏽). */
export const EMOJI_SEQ = /\p{Regional_Indicator}{2}|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*/gu;
const HAS_EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

export const hasEmoji = (s: string) => HAS_EMOJI.test(s);

/** Код Noto для эмодзи или null, если такого у нас нет. Пробуем как есть,
 *  без U+FE0F и с ним после первого знака: «❤» и «❤️» — одно и то же. */
export function notoCode(emoji: string): string | null {
  const cps = Array.from(emoji, (c) => c.codePointAt(0)!.toString(16));
  const full = cps.join("_");
  if (CODES.has(full)) return full;
  const bare = cps.filter((c) => c !== "fe0f");
  const b = bare.join("_");
  if (CODES.has(b)) return b;
  const vs = [bare[0], "fe0f", ...bare.slice(1)].join("_");
  return CODES.has(vs) ? vs : null;
}

/** Ревизия анимаций зеркала — поднять вместе с REV в scripts/noto-emoji-mirror.py,
 *  когда файлы на сервере поправили (--fix). Ревизия в имени файла, а не в
 *  ?query: CDN кэширует медиа по пути, и с ?r= отдавал старый 🎉. */
const REV = "2";
export const notoSvgUrl = (code: string) => mediaUrl(`/media/noto/${code}/emoji.svg`);
const notoLottieUrl = (code: string) => mediaUrl(`/media/noto/${code}/lottie.r${REV}.json`);

/** Сообщение только из эмодзи (1–max штук, пробелы не в счёт) — список, иначе null. */
export function emojiOnly(text: string, max = 3): string[] | null {
  const t = text.trim();
  if (!t || t.length > 80 || !HAS_EMOJI.test(t)) return null;
  const list = t.match(EMOJI_SEQ) || [];
  if (!list.length || list.length > max) return null;
  // «©», «™», «↔» без U+FE0F — это скорее текст, крупно не рисуем.
  if (list.some((e) => !notoCode(e) && e.length === 1)) return null;
  return t.replace(EMOJI_SEQ, "").replace(/[\s\uFE0F]/g, "") ? null : list;
}

// ── Кэш анимаций ───────────────────────────────────────────────────────────

const DB = "hyax-noto", STORE = "lottie";
let dbp: Promise<IDBDatabase | null> | null = null;
function db(): Promise<IDBDatabase | null> {
  if (dbp) return dbp;
  dbp = new Promise((res) => {
    try {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    } catch { res(null); }
  });
  return dbp;
}
async function idbGet(k: string): Promise<string | null> {
  const d = await db(); if (!d) return null;
  return new Promise((res) => {
    try { const q = d.transaction(STORE).objectStore(STORE).get(k); q.onsuccess = () => res(typeof q.result === "string" ? q.result : null); q.onerror = () => res(null); }
    catch { res(null); }
  });
}
async function idbPut(k: string, v: string) {
  const d = await db(); if (!d) return;
  try { d.transaction(STORE, "readwrite").objectStore(STORE).put(v, k); } catch { /* место кончилось — не страшно */ }
}

// Храним текст, а не объект: lottie-web дописывает в данные анимации своё,
// поэтому каждому проигрышу — свежий JSON.parse.
const textMem = new Map<string, Promise<string | null>>();
function lottieText(code: string): Promise<string | null> {
  let p = textMem.get(code);
  if (!p) {
    p = (async () => {
      const hit = await idbGet(`${REV}:${code}`);
      if (hit) return hit;
      const r = await fetch(notoLottieUrl(code), { mode: "cors", credentials: "omit" });
      if (!r.ok) return null;
      const txt = await r.text();
      void idbPut(`${REV}:${code}`, txt);
      return txt;
    })().catch(() => null);
    void p.then((v) => { if (v == null) textMem.delete(code); });
    textMem.set(code, p);
  }
  return p;
}

export async function loadNotoAnimation(code: string): Promise<object | null> {
  const txt = await lottieText(code);
  if (!txt) return null;
  try { return JSON.parse(txt); } catch { return null; }
}

/** Заранее подтянуть анимации (реакции из меню), чтобы первый тап не ждал сеть. */
export function preloadNoto(emojis: string[]) {
  for (const e of emojis) { const c = notoCode(e); if (c) void lottieText(c); }
}

export const loadLottie = () => import("lottie-web").then((m) => m.default);
