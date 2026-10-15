import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AnimationItem } from "lottie-web";
import { useCachedImage } from "@/lib/imageCache";
import { EMOJI_SEQ, hasEmoji, loadLottie, loadNotoAnimation, notoCode, notoSvgUrl } from "@/lib/notoEmoji";
import { cn } from "@/lib/utils";

/**
 * Эмодзи Google Noto (см. lib/notoEmoji): в покое — статичная картинка, по
 * поводу — один проигрыш анимации поверх неё, потом снова картинка. Lottie
 * живёт только пока играет: в ленте эмодзи десятки, держать их все
 * анимированными — дорого.
 *
 * Поводы: play сменился (реакцию поставили), autoPlay — впервые появился на
 * экране, tapToPlay — нажали. Эмодзи, которого нет в зеркале, или если
 * картинка не загрузилась, — обычный системный.
 */
export default function NotoEmoji({ emoji, size, inline, play, autoPlay, delay = 0, tapToPlay, className }: {
  emoji: string;
  /** Сторона в px; inline-эмодзи размером со строку (em). */
  size?: number;
  inline?: boolean;
  play?: number;
  autoPlay?: boolean;
  delay?: number;
  tapToPlay?: boolean;
  className?: string;
}) {
  const code = notoCode(emoji);
  const src = useCachedImage(code ? notoSvgUrl(code) : null);
  const [bad, setBad] = useState(false);
  const [run, setRun] = useState(0);
  const [drawn, setDrawn] = useState(false);
  const host = useRef<HTMLSpanElement>(null);
  const box = useRef<HTMLSpanElement>(null);
  const start = () => setRun((n) => n + 1);

  const firstPlay = useRef(play);
  useEffect(() => { if (play !== undefined && play !== firstPlay.current) start(); }, [play]);

  useEffect(() => {
    if (!autoPlay || !code || !host.current) return;
    const el = host.current;
    let timer = 0;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      timer = window.setTimeout(start, delay);
    }, { threshold: 0.6 });
    io.observe(el);
    return () => { io.disconnect(); clearTimeout(timer); };
  }, [autoPlay, code, delay]);

  useEffect(() => {
    if (!run || !code || !box.current) return;
    const el = box.current;
    let anim: AnimationItem | null = null;
    let alive = true;
    const stop = () => { if (!alive) return; setDrawn(false); setRun(0); };
    Promise.all([loadLottie(), loadNotoAnimation(code)]).then(([lottie, data]) => {
      if (!alive) return;
      if (!data) { stop(); return; }
      // SVG, а не canvas: у части анимаций Noto маски и градиенты, которые
      // canvas-рендер lottie рисует с ошибками (🎉 ломался посреди проигрыша).
      // Живёт анимация только пока играет, так что лишние узлы SVG не копятся.
      anim = lottie.loadAnimation({
        container: el, renderer: "svg", loop: false, autoplay: true, animationData: data,
        rendererSettings: { preserveAspectRatio: "xMidYMid meet", progressiveLoad: false },
      });
      // Картинку прячем, только когда анимация нарисовала первый кадр, —
      // иначе между ними мелькает пустое место.
      let first = true;
      anim.addEventListener("enterFrame", () => { if (first && alive) { first = false; setDrawn(true); } });
      anim.addEventListener("complete", stop);
    }).catch(stop);
    return () => { alive = false; anim?.destroy(); };
  }, [run, code]);

  if (!code || bad) {
    return inline ? <>{emoji}</> : <span className={cn("noto-emoji noto-text", className)} style={size ? { width: size, height: size, fontSize: size * 0.82 } : undefined}>{emoji}</span>;
  }
  return (
    <span
      ref={host}
      role="img"
      aria-label={emoji}
      className={cn(inline ? "noto-inline" : "noto-emoji", className)}
      style={size ? { width: size, height: size, fontSize: size * 0.82 } : undefined}
      onClick={tapToPlay ? start : undefined}
    >
      {src
        ? <img src={src} alt={emoji} draggable={false} onError={() => setBad(true)} style={drawn ? { visibility: "hidden" } : undefined} />
        : <span className="noto-ph" aria-hidden>{emoji}</span>}
      {run > 0 && <span ref={box} className="noto-anim" aria-hidden />}
    </span>
  );
}

/** Текст, где эмодзи из зеркала заменены на Noto (статичные, тап — анимация). */
export function emojify(text: string, keyBase = ""): ReactNode {
  if (!hasEmoji(text)) return text;
  const re = new RegExp(EMOJI_SEQ.source, "gu");
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (!notoCode(m[0])) continue;
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(<NotoEmoji key={`${keyBase}e${m.index}`} emoji={m[0]} inline tapToPlay />);
    last = m.index + m[0].length;
  }
  if (!out.length) return text;
  if (last < text.length) out.push(text.slice(last));
  return out;
}
