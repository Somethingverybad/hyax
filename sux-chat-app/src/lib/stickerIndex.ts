import { api } from "@/api/client";

/**
 * Подсказки стикеров по макросу. Набрал в поле «привет» — над полем
 * всплывают стикеры, у которых макрос начинается с «привет» (или наоборот),
 * с одной опечаткой и в другом склонении. Индекс — все стикеры из наборов
 * человека, грузится один раз и обновляется, когда наборы меняются.
 */
export interface IndexedSticker { id: string; file_url: string; emoji?: string; keyword: string; pack: string }

let cache: IndexedSticker[] | null = null;
let loading: Promise<IndexedSticker[]> | null = null;

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}\p{Extended_Pictographic}]+/gu, "");

export function invalidateStickerIndex() { cache = null; loading = null; }

export async function loadStickerIndex(): Promise<IndexedSticker[]> {
  if (cache) return cache;
  if (loading) return loading;
  loading = (async () => {
    try {
      const packs: any[] = await api.getMyStickerPacks();
      const lists = await Promise.all(packs.map((p) => api.getStickers(p.pack?.id || p.id).catch(() => [])));
      cache = lists.flat().filter((s: any) => s.keyword || s.emoji).map((s: any) => ({
        id: s.id, file_url: s.file_url, emoji: s.emoji || undefined, keyword: norm(s.keyword || ""), pack: s.pack,
      }));
    } catch { cache = []; }
    return cache!;
  })();
  return loading;
}

/** Расстояние Левенштейна для коротких строк — опечатка в одну букву. */
const lev = (a: string, b: string) => {
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
};

/** Подходит ли макрос под набранное слово. */
export function keywordMatches(keyword: string, typed: string): boolean {
  const k = keyword, w = norm(typed);
  if (!k || !w) return false;
  if (k === w) return true;
  // Эмодзи — только точное совпадение.
  if (/\p{Extended_Pictographic}/u.test(k) || /\p{Extended_Pictographic}/u.test(w)) return false;
  // Начало слова в обе стороны: «кот» → «котик», «котика» → «котик» (склонение).
  const min = Math.min(k.length, w.length);
  if (min >= 3 && (k.startsWith(w) || w.startsWith(k))) return true;
  if (k.length <= 2 || w.length <= 2) return false;
  // Опечатка в одну букву — в слове целиком или в его начале длиной с макрос.
  if (min >= 4 && (lev(k, w) <= 1 || lev(k.slice(0, w.length), w) <= 1 || lev(k, w.slice(0, k.length)) <= 1)) return true;
  return false;
}

/** Последнее «слово» в поле — то, по чему ищем. */
export function lastToken(text: string): string {
  const m = /(\S+)$/.exec(text);
  return m ? m[1] : "";
}

export function matchStickers(index: IndexedSticker[], typed: string, limit = 8): IndexedSticker[] {
  const w = norm(typed);
  if (!w) return [];
  const out: IndexedSticker[] = [];
  for (const s of index) {
    if ((s.keyword && keywordMatches(s.keyword, w)) || (s.emoji && norm(s.emoji) === w)) {
      out.push(s);
      if (out.length >= limit) break;
    }
  }
  return out;
}
