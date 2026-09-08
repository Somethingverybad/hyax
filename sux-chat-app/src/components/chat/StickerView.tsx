import { useEffect, useRef, useState } from "react";
import lottie, { type AnimationItem } from "lottie-web";
import { inflate } from "pako";
import { mediaUrl } from "@/api/client";

/**
 * Стикер любого формата: .webp/.png/.gif — картинка; .webm — видео
 * (телеграмовские видеостикеры); .tgs — анимация Lottie в gzip (телеграмовские
 * анимированные), распаковываем pako и крутим lottie-web на canvas.
 * Анимация играет только пока стикер на экране — в пикере их десятки.
 */
const tgsCache = new Map<string, Promise<object>>();
const loadTgs = (url: string) => {
  let p = tgsCache.get(url);
  if (!p) {
    p = fetch(url).then((r) => r.arrayBuffer()).then((buf) => JSON.parse(new TextDecoder().decode(inflate(new Uint8Array(buf)))));
    tgsCache.set(url, p);
  }
  return p;
};

export const isTgs = (u?: string | null) => !!u && /\.tgs(\?|$)/i.test(u);
export const isWebm = (u?: string | null) => !!u && /\.webm(\?|$)/i.test(u);

const StickerView = ({ url, alt, className, loop = true }: { url: string; alt?: string; className?: string; loop?: boolean }) => {
  const src = mediaUrl(url);
  const box = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!isTgs(src) || !box.current) return;
    let anim: AnimationItem | null = null;
    let alive = true;
    const el = box.current;
    loadTgs(src).then((data) => {
      if (!alive) return;
      anim = lottie.loadAnimation({ container: el, renderer: "canvas", loop, autoplay: false, animationData: data });
      const io = new IntersectionObserver(([e]) => { if (!anim) return; e.isIntersecting ? anim.play() : anim.pause(); }, { threshold: 0.1 });
      io.observe(el);
      (el as any).__io = io;
    }).catch(() => alive && setError(true));
    return () => {
      alive = false;
      (el as any).__io?.disconnect();
      anim?.destroy();
    };
  }, [src, loop]);

  if (isTgs(src)) {
    return error
      ? <div className={className} title={alt}>🎞</div>
      : <div ref={box} className={className} aria-label={alt} />;
  }
  if (isWebm(src)) {
    return <video src={src} className={className} autoPlay loop={loop} muted playsInline aria-label={alt} />;
  }
  return <img src={src} alt={alt || ""} className={className} loading="lazy" draggable={false} />;
};

export default StickerView;
