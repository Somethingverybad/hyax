import { useEffect, useState } from "react";
import { api, mediaUrl } from "@/api/client";

/**
 * Разрешение ссылки на медиа. Локальные пути (/media/...) и абсолютные URL
 * отдаём как есть; приватные вложения в S3 (маркер s3://key) меняем на
 * временную подписанную ссылку, которую выдаёт сервер после проверки прав.
 * Подписанные ссылки кэшируем по маркеру (живут ~час).
 */
const cache = new Map<string, { url: string; exp: number }>();
const inflight = new Map<string, Promise<string>>();

// Подписи, пришедшие вместе с сообщениями (поле signed, chat/s3.py: срок сутки,
// одна и та же ссылка весь день). Кладём в тот же кэш — картинка берётся сразу,
// без запроса подписи; кэш переживает перезапуск (localStorage), и при
// следующем старте тот же адрес попадает в HTTP-кэш WebView (PERF_PLAN.md, п. 5).
const SEEDED_TTL = 20 * 60 * 60 * 1000;
const STORE_KEY = "hyax:signed";
let storeTimer = 0;
try {
  const raw = localStorage.getItem(STORE_KEY);
  if (raw) { const now = Date.now(); for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, { url: string; exp: number }>)) if (v && v.exp > now) cache.set(k, v); }
} catch { /* приватный режим */ }
function persist() {
  window.clearTimeout(storeTimer);
  storeTimer = window.setTimeout(() => {
    try {
      const now = Date.now();
      const rows = [...cache.entries()].filter(([, v]) => v.exp > now).slice(-600);
      localStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(rows)));
    } catch { /* ок */ }
  }, 1500);
}
export function primeSigned(map?: Record<string, string> | null) {
  if (!map) return;
  const exp = Date.now() + SEEDED_TTL;
  let changed = false;
  for (const [raw, url] of Object.entries(map)) {
    if (!raw.startsWith("s3://") || !url) continue;
    const cur = cache.get(raw);
    if (cur && cur.url === url) continue;
    cache.set(raw, { url, exp }); changed = true;
  }
  if (changed) persist();
}

/** Готовая ссылка без запроса к серверу или "" (подпись S3 ещё не получена).
 *  Просмотр картинок берёт ту же ссылку, что и пузырь сообщения: картинка с
 *  тем же адресом уже в памяти страницы и показывается сразу, без сети. */
export function cachedMediaUrl(fileUrl?: string | null): string {
  if (!fileUrl) return "";
  if (!fileUrl.startsWith("s3://")) return mediaUrl(fileUrl);
  const c = cache.get(fileUrl);
  return c && c.exp > Date.now() ? c.url : "";
}

/** Ссылка для показа: из кэша или подписью — одной на маркер, даже если
 *  просят сразу пузырь и просмотр. */
export function resolveMediaUrl(fileUrl: string): Promise<string> {
  const hit = cachedMediaUrl(fileUrl);
  if (hit) return Promise.resolve(hit);
  let p = inflight.get(fileUrl);
  if (!p) {
    p = api.signMedia(fileUrl)
      .then((u) => { cache.set(fileUrl, { url: u, exp: Date.now() + 50 * 60 * 1000 }); return u; })
      .finally(() => { inflight.delete(fileUrl); });
    inflight.set(fileUrl, p);
  }
  return p;
}

export function useMediaUrl(fileUrl?: string | null): string {
  const isS3 = !!fileUrl && fileUrl.startsWith("s3://");
  const [url, setUrl] = useState<string>(() => cachedMediaUrl(fileUrl));

  useEffect(() => {
    if (!fileUrl) { setUrl(""); return; }
    const hit = cachedMediaUrl(fileUrl);
    if (hit) { setUrl(hit); return; }
    let alive = true;
    resolveMediaUrl(fileUrl).then((u) => { if (alive) setUrl(u); }).catch(() => {});
    return () => { alive = false; };
  }, [fileUrl, isS3]);

  return url;
}

/** То же, что useMediaUrl, плюс признак отказа: сервер не подписал ссылку
 *  (вложение удалено, доступа нет) — показывать «грузится» дальше незачем. */
export function useMediaUrlState(fileUrl?: string | null): { url: string; failed: boolean } {
  const isS3 = !!fileUrl && fileUrl.startsWith("s3://");
  const [st, setSt] = useState<{ url: string; failed: boolean }>(() => ({ url: cachedMediaUrl(fileUrl), failed: false }));

  useEffect(() => {
    if (!fileUrl) { setSt({ url: "", failed: false }); return; }
    const hit = cachedMediaUrl(fileUrl);
    if (hit) { setSt({ url: hit, failed: false }); return; }
    let alive = true;
    resolveMediaUrl(fileUrl)
      .then((u) => { if (alive) setSt({ url: u, failed: false }); })
      .catch(() => { if (alive) setSt({ url: "", failed: true }); });
    return () => { alive = false; };
  }, [fileUrl, isS3]);

  return st;
}
