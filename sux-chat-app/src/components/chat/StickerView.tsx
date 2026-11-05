import { useEffect, useRef, useState } from "react";
import { mediaUrl } from "@/api/client";
import { mountTgs } from "@/lib/tgsPlayer";
import { useCachedImage } from "@/lib/imageCache";
import { animVideo } from "@/lib/animMedia";
import LoopVideo from "@/components/LoopVideo";

/**
 * Стикер любого формата: .webp/.png/.gif — картинка; .webm — видео
 * (телеграмовские видеостикеры); .tgs — анимация Lottie в gzip (телеграмовские
 * анимированные), распаковываем pako и крутим lottie-web на canvas — под
 * присмотром lib/tgsPlayer: живая анимация только на экране и в пределах
 * бюджета памяти, остальные — застывшим кадром.
 *
 * lottie-web и pako подгружаются при первом .tgs, а не при старте: вместе они
 * тянули на треть главного бандла, а нужны только тем, у кого есть
 * анимированные стикеры.
 */
export { loadLottie, loadTgs } from "@/lib/tgsPlayer";

export const isTgs = (u?: string | null) => !!u && /\.tgs(\?|$)/i.test(u);
export const isWebm = (u?: string | null) => !!u && /\.webm(\?|$)/i.test(u);
export const isMp4 = (u?: string | null) => !!u && /\.mp4(\?|$)/i.test(u);

const StickerView = ({ url, alt, className, loop = true }: { url: string; alt?: string; className?: string; loop?: boolean }) => {
  const src = mediaUrl(url);
  const box = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!isTgs(src) || !box.current) return;
    return mountTgs(box.current, src, { loop, onError: () => setError(true) });
  }, [src, loop]);

  if (isTgs(src)) {
    return error
      ? <div className={className} title={alt}>🎞</div>
      : <div ref={box} className={className} aria-label={alt} />;
  }
  if (isWebm(src)) {
    return <video src={src} className={className} autoPlay loop={loop} muted playsInline aria-label={alt} />;
  }
  // GIF или видео, переведённые сервером в mp4: в адресе кадр, видео рядом.
  const vid = animVideo(src) || (isMp4(src) ? src : null);
  if (vid) return <LoopVideo src={vid} poster={vid === src ? undefined : src} className={className} alt={alt} loop={loop} />;
  return <CachedImg src={src} alt={alt || ""} className={className} />;
};

/** Статичный стикер — через кэш картинок (иначе при каждом открытии окна
 *  стикеров они на миг пропадали: CDN не даёт браузеру их кэшировать). */
const CachedImg = ({ src, alt, className }: { src: string; alt: string; className?: string }) => {
  const s = useCachedImage(src);
  return s ? <img src={s} alt={alt} className={className} draggable={false} /> : <span className={className} aria-hidden />;
};

export default StickerView;
