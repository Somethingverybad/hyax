import { useEffect, useRef, useState, type CSSProperties, type ImgHTMLAttributes } from "react";
import type { AnimationItem } from "lottie-web";
import { cn } from "@/lib/utils";
import { useCachedImage } from "@/lib/imageCache";
import skeletonData from "@/assets/skeleton.json";

/**
 * Скелетон загрузки «Мяты»: палочки «X» расходятся, играют в пинг-понг и
 * собираются обратно (Lottie, генератор — design/splash/make_skeleton.py).
 * Мельче 40px анимации не разглядеть — там только мягкая подложка.
 * Вне экрана анимация стоит: в списке их бывает по десятку разом.
 */
const loadLottie = () => import("lottie-web").then((m) => m.default);
const MIN_ANIM = 40;

/** Мяч в цвет темы: тёмно-мятный на тёмной подложке не виден. */
function themed(): unknown {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim();
  const m = raw.match(/^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/);
  if (!m) return skeletonData;
  const [h, s, l] = [+m[1], +m[2] / 100, +m[3] / 100];
  const f = (n: number) => { const k = (n + h / 30) % 12; return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  const data = JSON.parse(JSON.stringify(skeletonData));
  for (const layer of data.layers) {
    if (layer.nm !== "ball") continue;
    for (const g of layer.shapes) for (const it of g.it) if (it.ty === "fl") it.c.k = [f(0), f(8), f(4), 1];
  }
  return data;
}

export function LoadingSkeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<HTMLDivElement>(null);
  const [side, setSide] = useState(0);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const set = () => setSide(Math.min(el.clientWidth, el.clientHeight));
    set();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(set) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);

  const big = side >= MIN_ANIM;
  useEffect(() => {
    const host = animRef.current, box = boxRef.current;
    if (!big || !host || !box) return;
    let anim: AnimationItem | null = null, alive = true, visible = true;
    const io = typeof IntersectionObserver !== "undefined"
      ? new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (anim) { if (visible) anim.play(); else anim.pause(); } })
      : null;
    io?.observe(box);
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    void loadLottie().then((lottie) => {
      if (!alive) return;
      // canvas, а не svg: svg-рендер каждый кадр переписывает transform у
      // десятков узлов внутри прокручиваемой ленты, и на iOS это совпадало с
      // залипанием кадра ленты после клавиатуры (баг появлялся после отправки
      // фото и треугольников — как раз там, где крутится скелетон).
      anim = lottie.loadAnimation({ container: host, renderer: "canvas", loop: !still, autoplay: visible && !still, animationData: themed(), rendererSettings: { clearCanvas: true } });
    });
    return () => { alive = false; io?.disconnect(); anim?.destroy(); };
  }, [big]);

  const size = Math.min(120, Math.round(side * 0.8));
  return (
    <div ref={boxRef} aria-hidden className={cn("ui-skel ui-avatar-loading relative overflow-hidden", className)} style={style}>
      {big && <div ref={animRef} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ width: size, height: size }} />}
    </div>
  );
}

/**
 * Картинка через кэш: пока грузится — скелетон, потом картинка плавно
 * проявляется поверх. Из памяти — сразу, без скелетона и без проявления.
 * className — на обёртку (размер, скругление), картинка заполняет её.
 */
export function FadeImg({ src, className, imgClassName, onReady, ...rest }:
  Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "onLoad"> & { src: string; imgClassName?: string; onReady?: (ready: boolean) => void }) {
  const s = useCachedImage(src);
  const instant = useRef(!!s);
  const [shown, setShown] = useState(instant.current);
  useEffect(() => { if (!s) { setShown(false); instant.current = false; } }, [s]);
  useEffect(() => { onReady?.(shown); }, [shown, onReady]);
  return (
    <span className={cn("relative block overflow-hidden", className)}>
      {!shown && <LoadingSkeleton className="absolute inset-0" />}
      {s && (
        <img src={s} alt="" draggable={false} {...rest} onLoad={() => setShown(true)}
          className={cn("absolute inset-0 w-full h-full object-cover", !instant.current && "transition-opacity duration-300", shown ? "opacity-100" : "opacity-0", imgClassName)} />
      )}
    </span>
  );
}
