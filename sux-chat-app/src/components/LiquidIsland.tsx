import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * «Островок» в шапке чата (ник и статус) — перетекает, как жидкость.
 *
 * LiquidIsland — капсула, ширина которой подстраивается под содержимое
 * пружиной с перехлёстом, а при заметной смене ещё и «желейно» колеблется.
 * LiquidText — смена текста («в сети» → «печатает…» → «записывает подкаст…»):
 * старое слово растворяется в размытии, новое проступает из него, а порог
 * прозрачности (SVG-фильтр) склеивает буквы, как капли. Фильтр — только на
 * время перехода: в покое текст остаётся чётким.
 *
 * Кто выключил анимации в системе (prefers-reduced-motion) — без эффектов.
 */

const MORPH_MS = 700;
const reducedMotion = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function LiquidText({ text, className }: { text: string; className?: string }) {
  const [shown, setShown] = useState(text);
  const [prev, setPrev] = useState<string | null>(null);
  const [n, setN] = useState(0);
  const fid = `liquid${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  useEffect(() => {
    if (text === shown) return;
    if (reducedMotion()) { setShown(text); setPrev(null); return; }
    setPrev(shown);
    setShown(text);
    setN((x) => x + 1);
    const t = setTimeout(() => setPrev(null), MORPH_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  return (
    <span className={cn("liquid-text", className)} style={prev !== null ? { filter: `url(#${fid})` } : undefined}>
      <svg aria-hidden width="0" height="0" className="liquid-defs">
        <defs>
          {/* Порог прозрачности: размытые буквы сливаются в «капли». */}
          <filter id={fid}>
            <feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 16 -6" />
          </filter>
        </defs>
      </svg>
      {prev !== null && <span key={`out${n}`} className="liquid-out" aria-hidden>{prev}</span>}
      <span key={`in${n}`} className={prev !== null ? "liquid-in" : undefined}>{shown}</span>
    </span>
  );
}

export function LiquidIsland({ children, className, onClick, minWidth = 120, padX = 20, title }: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  minWidth?: number;
  /** Отступ слева и справа — входит в ширину капсулы. */
  padX?: number;
  title?: string;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  const last = useRef<number | null>(null);
  const [animated, setAnimated] = useState(false);

  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const measure = () => {
      const next = Math.max(minWidth, Math.ceil(el.getBoundingClientRect().width) + padX * 2);
      const prev = last.current;
      if (prev === next) return;
      last.current = next;
      setWidth(next);
      // Заметно поменялась — капсула «желейно» качнётся, пока тянется к новой ширине.
      if (prev !== null && Math.abs(prev - next) > 6 && !reducedMotion() && btn.current?.animate) {
        const grow = next > prev;
        btn.current.animate([
          { transform: "scale(1, 1)" },
          { transform: grow ? "scale(1.035, 0.93)" : "scale(0.97, 1.06)", offset: 0.3 },
          { transform: grow ? "scale(0.99, 1.03)" : "scale(1.015, 0.98)", offset: 0.6 },
          { transform: "scale(1, 1)" },
        ], { duration: 620, easing: "ease-out" });
      }
    };
    measure();
    // Первая ширина — без анимации, дальше — пружиной.
    requestAnimationFrame(() => setAnimated(true));
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [minWidth, padX]);

  return (
    <button ref={btn} type="button" onClick={onClick} title={title}
      className={cn("liquid-island", animated && "liquid-island-anim", className)}
      style={{ width: width ?? undefined, paddingLeft: padX, paddingRight: padX }}>
      <span ref={inner} className="liquid-island-inner">{children}</span>
    </button>
  );
}
