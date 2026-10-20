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
 * Длинный статус («строчит как из пулемёта…», «Вася печатает… и ещё 2») не
 * обрезается: переносится по словам (wrap), а капсула так же пружиной
 * подрастает по высоте. С growDown место в раскладке остаётся высотой в одну
 * строку, а капсула растёт вниз поверх того, что под ней: шапка не пухнет,
 * соседние кнопки и лента не съезжают (баг-репорт 00b57f40).
 *
 * Кто выключил анимации в системе (prefers-reduced-motion) — без эффектов.
 */

const MORPH_MS = 700;
const reducedMotion = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function LiquidText({ text, className, wrap }: { text: string; className?: string; wrap?: boolean }) {
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
    <span className={cn("liquid-text", wrap && "liquid-text-wrap", className)} style={prev !== null ? { filter: `url(#${fid})` } : undefined}>
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

export function LiquidIsland({ children, className, onClick, minWidth = 120, minHeight = 0, padX = 20, padY = 5, title, growDown }: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  minWidth?: number;
  /** Высота в одну строку статуса; перенёсся на вторую — капсула выше. */
  minHeight?: number;
  /** Отступы — входят в размер капсулы. */
  padX?: number;
  padY?: number;
  title?: string;
  /** Расти вниз поверх соседей, не меняя высоту места в раскладке (minHeight). */
  growDown?: boolean;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const last = useRef<{ w: number; h: number } | null>(null);
  const [animated, setAnimated] = useState(false);

  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const next = { w: Math.max(minWidth, Math.ceil(r.width) + padX * 2), h: Math.max(minHeight, Math.ceil(r.height) + padY * 2) };
      const prev = last.current;
      if (prev && prev.w === next.w && prev.h === next.h) return;
      last.current = next;
      setSize(next);
      // Заметно поменялась — капсула «желейно» качнётся, пока тянется к новому размеру.
      const dw = prev ? next.w - prev.w : 0, dh = prev ? next.h - prev.h : 0;
      if (prev && (Math.abs(dw) > 6 || Math.abs(dh) > 4) && !reducedMotion() && btn.current?.animate) {
        const grow = Math.abs(dw) >= Math.abs(dh) ? dw > 0 : dh < 0;
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
  }, [minWidth, minHeight, padX, padY]);

  const island = (
    <button ref={btn} type="button" onClick={onClick} title={title}
      className={cn("liquid-island", animated && "liquid-island-anim", growDown && "liquid-island-float", className)}
      style={{ width: size?.w, height: size?.h, minHeight: minHeight || undefined, paddingLeft: padX, paddingRight: padX }}>
      <span ref={inner} className="liquid-island-inner">{children}</span>
    </button>
  );
  if (!growDown) return island;
  // Место в раскладке: ширина — как у капсулы (тянется той же пружиной), высота — одна строка.
  return (
    <span className={cn("liquid-island-slot", animated && "liquid-island-anim")} style={{ width: size?.w ?? minWidth, height: minHeight || undefined }}>
      {island}
    </span>
  );
}
