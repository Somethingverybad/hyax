/**
 * Время и дата сообщений без Intl на каждую строку: toLocaleTimeString
 * создаёт форматтер заново при каждом вызове и в профиле открытия чата был
 * самой дорогой функцией приложения (PERF_PLAN.md, п. 3). Форматтеры — по
 * одному на язык и набор опций, готовые строки — в кэше по метке времени.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();
const cache = new Map<string, string>();

function fmt(locale: string, opts: Intl.DateTimeFormatOptions, key: string, iso: string): string {
  const k = `${key}|${locale}|${iso}`;
  const hit = cache.get(k);
  if (hit !== undefined) return hit;
  const fk = `${key}|${locale}`;
  let f = formatters.get(fk);
  if (!f) {
    try { f = new Intl.DateTimeFormat(locale, opts); } catch { f = new Intl.DateTimeFormat(undefined, opts); }
    formatters.set(fk, f);
  }
  const d = new Date(iso);
  const out = Number.isNaN(d.getTime()) ? "" : f.format(d);
  if (cache.size > 5000) cache.clear();
  cache.set(k, out);
  return out;
}

/** «14:05» — время сообщения. */
export const timeOf = (iso: string, locale: string) => fmt(locale, { hour: "2-digit", minute: "2-digit" }, "t", iso);
/** Дата для разделителя между днями. */
export const dateOf = (iso: string, locale: string, opts: Intl.DateTimeFormatOptions) => fmt(locale, opts, "d" + JSON.stringify(opts), iso);
/** Ключ дня (локальное время) — сравнивать дни двух сообщений без двух toDateString. */
export function dayKey(iso: string): number {
  const d = new Date(iso);
  return d.getFullYear() * 10000 + d.getMonth() * 100 + d.getDate();
}
