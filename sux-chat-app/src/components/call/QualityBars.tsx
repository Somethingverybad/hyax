import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { getLang, t } from "@/lib/i18n";
import type { CallQuality } from "@/lib/callQuality";

/** Подпись к шкале: от «лучше, чем на парковке» до Фиксиков. */
const PHRASE: Record<CallQuality["level"], string> = {
  4: "Соединение лучше, чем на парковке",
  3: "Связь хорошая — говорите смело",
  2: "Связь так себе — голос может подзаикаться",
  1: "Фиксики скоро починят",
  0: "Связь пропала — Фиксики уже чинят",
};

const COLOR = (level: number) => (level >= 3 ? "bg-[#34c759]" : level === 2 ? "bg-[#ff9f0a]" : "bg-[#ff3b30]");

/**
 * Шкала качества связи в звонке: четыре палочки. Наведение (компьютер) или
 * нажатие (телефон) — подпись и цифры: задержка, потери.
 */
const QualityBars = ({ quality, onDark, align = "center", className }: {
  quality: CallQuality;
  /** Поверх видео — светлые пустые палочки. */
  onDark?: boolean;
  /** Подсказка под шкалой: по центру или от левого края (у края экрана). */
  align?: "center" | "start";
  className?: string;
}) => {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  // Открыта нажатием — закрыть нажатием мимо.
  useEffect(() => {
    if (!pinned) return;
    const off = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setPinned(false); };
    document.addEventListener("pointerdown", off);
    return () => document.removeEventListener("pointerdown", off);
  }, [pinned]);

  const { level } = quality;
  const phrase = t(PHRASE[level]);
  const details = level === 0 ? null : quality.approx
    ? quality.rtt !== undefined ? t("Задержка до сервера {ms} мс · оценка приблизительная", { ms: quality.rtt }) : null
    : [
        quality.rtt !== undefined ? t("задержка {ms} мс", { ms: quality.rtt }) : null,
        quality.loss !== undefined ? t("потери {p}%", { p: quality.loss.toLocaleString(getLang()) }) : null,
      ].filter(Boolean).join(" · ");
  const open = hover || pinned;

  return (
    <span ref={ref} className={cn("relative inline-flex", className)}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button type="button" onClick={() => setPinned((v) => !v)} aria-label={phrase} aria-expanded={open}
        className="h-6 px-1 -mx-1 flex items-end gap-[2px] pb-[5px] rounded">
        {[4, 7, 10, 13].map((h, i) => (
          <span key={h} aria-hidden style={{ height: h }}
            className={cn("w-[3px] rounded-[1px]", i < level ? COLOR(level) : onDark ? "bg-white/35" : "bg-foreground/20")} />
        ))}
      </button>
      {open && (
        <span role="tooltip"
          className={cn("absolute top-full mt-1.5 z-30 w-max max-w-[min(18rem,calc(100vw-2rem))] rounded-lg px-3 py-2 text-left shadow-xl",
            "bg-surface-1 text-foreground border border-border pointer-events-none",
            align === "center" ? "left-1/2 -translate-x-1/2" : "left-0")}>
          <span className="block text-small font-medium leading-snug">{phrase}</span>
          {details && <span className="block text-caption text-subtle tabular-nums mt-0.5">{details}</span>}
        </span>
      )}
    </span>
  );
};

export default QualityBars;
