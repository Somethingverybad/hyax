import { useEffect, useState } from "react";
import { api, mediaUrl } from "@/api/client";

/**
 * Разрешение ссылки на медиа. Локальные пути (/media/...) и абсолютные URL
 * отдаём как есть; приватные вложения в S3 (маркер s3://key) меняем на
 * временную подписанную ссылку, которую выдаёт сервер после проверки прав.
 * Подписанные ссылки кэшируем по маркеру (живут ~час).
 */
const cache = new Map<string, { url: string; exp: number }>();

export function useMediaUrl(fileUrl?: string | null): string {
  const isS3 = !!fileUrl && fileUrl.startsWith("s3://");
  const [url, setUrl] = useState<string>(() => {
    if (!fileUrl) return "";
    if (!isS3) return mediaUrl(fileUrl);
    const c = cache.get(fileUrl);
    return c && c.exp > Date.now() ? c.url : "";
  });

  useEffect(() => {
    if (!fileUrl) { setUrl(""); return; }
    if (!isS3) { setUrl(mediaUrl(fileUrl)); return; }
    const c = cache.get(fileUrl);
    if (c && c.exp > Date.now()) { setUrl(c.url); return; }
    let alive = true;
    api.signMedia(fileUrl)
      .then((u) => {
        if (!alive) return;
        cache.set(fileUrl, { url: u, exp: Date.now() + 50 * 60 * 1000 });
        setUrl(u);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [fileUrl, isS3]);

  return url;
}
