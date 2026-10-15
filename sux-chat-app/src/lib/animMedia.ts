/**
 * Анимированные аватары и стикеры (chat/views.py: _animated_media): в адресе —
 * первый кадр «….mp4.jpg», рядом лежит само видео «….mp4». Старые клиенты
 * видят обычную картинку, новые проигрывают видео.
 */
export const animVideo = (url?: string | null): string | null => {
  if (!url) return null;
  const m = url.match(/^(.*\.mp4)\.jpg(\?.*)?$/i);
  return m ? m[1] : null;
};

/** GIF или видео — такие файлы сервер сам переводит в анимацию до 5 секунд. */
export const isAnimatedFile = (f: File) =>
  f.type === "image/gif" || f.type.startsWith("video/") || /\.(gif|mp4|mov|m4v|webm|mkv)$/i.test(f.name);
