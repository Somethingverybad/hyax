import { useEffect, useState } from "react";

/**
 * Кэш картинок (аватары, обложки групп, стикеры), потому что HTTP-кэш нам не
 * помощник: CDN отдаёт медиа с `cache-control: max-age=0`, и WebView на
 * каждом показе заново спрашивал сервер — картинка на миг пропадала.
 *
 * Память — мгновенно при повторном показе; IndexedDB — между запусками.
 * Ключ — путь без домена: CDN и прямой адрес — один и тот же файл.
 * Подписанные ссылки (s3, с подписью в query) не кэшируем — у них свой срок.
 */
const mem = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();
const MAX_BYTES = 2 * 1024 * 1024;
const DB = "hyax-img", STORE = "img";

const keyOf = (url: string) => {
  try { const u = new URL(url, location.href); return u.search ? null : u.pathname; } catch { return null; }
};

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
async function idbGet(k: string): Promise<Blob | null> {
  const d = await db(); if (!d) return null;
  return new Promise((res) => {
    try { const q = d.transaction(STORE).objectStore(STORE).get(k); q.onsuccess = () => res((q.result as Blob) || null); q.onerror = () => res(null); }
    catch { res(null); }
  });
}
async function idbPut(k: string, b: Blob) {
  const d = await db(); if (!d) return;
  try { d.transaction(STORE, "readwrite").objectStore(STORE).put(b, k); } catch { /* место кончилось — не страшно */ }
}

function load(url: string, k: string): Promise<string | null> {
  const p = inflight.get(k);
  if (p) return p;
  const job = (async () => {
    const hit = await idbGet(k);
    if (hit) { const o = URL.createObjectURL(hit); mem.set(k, o); return o; }
    try {
      const r = await fetch(url, { mode: "cors", credentials: "omit" });
      if (!r.ok) return null;
      const b = await r.blob();
      if (!b.type.startsWith("image/") || b.size > MAX_BYTES) return null;
      void idbPut(k, b);
      const o = URL.createObjectURL(b); mem.set(k, o); return o;
    } catch { return null; }
  })();
  inflight.set(k, job);
  void job.finally(() => inflight.delete(k));
  return job;
}

/** Достать картинку в память заранее (свой аватар и обложка — при старте),
 *  чтобы экран, где она нужна, показал её сразу, без скелетона. */
export function preloadImage(url?: string | null) {
  const k = url ? keyOf(url) : null;
  if (url && k && !mem.has(k)) void load(url, k);
}

/** Адрес картинки из кэша: из памяти — сразу, иначе — после загрузки.
 *  Пока грузится, отдаёт пустую строку (рисуем подложку), не получилось —
 *  исходный адрес. */
export function useCachedImage(url?: string | null): string {
  const k = url ? keyOf(url) : null;
  const [src, setSrc] = useState(() => (!url ? "" : !k ? url : mem.get(k) || ""));
  useEffect(() => {
    if (!url) { setSrc(""); return; }
    if (!k) { setSrc(url); return; }
    const m = mem.get(k);
    if (m) { setSrc(m); return; }
    let alive = true;
    setSrc("");
    void load(url, k).then((o) => { if (alive) setSrc(o || url); });
    return () => { alive = false; };
  }, [url, k]);
  return src;
}
