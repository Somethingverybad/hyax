import type { CSSProperties, ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Аура — свечение вокруг аватара, пока человек в сети (как статусы ICQ).
 * Заменяет зелёную точку «в сети»: нет свечения — человек не в сети.
 *
 * Цвет и значение задаёт сам человек (Профиль → Аура). Без своей ауры
 * светится цветом по умолчанию и без подписи. Значение видно при наведении
 * на аватар (десктоп) и в карточке профиля (телефон — по тапу на аватар).
 *
 * Пламя — чистый CSS (index.css, .aura-*): слои крутятся и «дышат» через
 * transform/opacity, размытие считается один раз — списки с десятками
 * аватаров не тормозят. При «уменьшить движение» в системе пламя стоит.
 */
export const DEFAULT_AURA = "#35d07f";

export const AURA_SWATCHES = [
  "#ff6a00", "#ff2d2d", "#ff3fa4", "#b44dff", "#5b6cff", "#1fb6ff",
  "#00e0c6", "#35d07f", "#b8f000", "#ffd400", "#ffffff", "#ffb37a",
];

export interface AuraOwner {
  aura_color?: string | null;
  aura_text?: string | null;
}

const isTouch = () =>
  typeof window !== "undefined" && window.matchMedia?.("(hover: none)").matches;

export function Aura({
  active,
  owner,
  size = 46,
  children,
  className = "",
}: {
  /** Показывать ли свечение — обычно «в сети». */
  active: boolean;
  owner?: AuraOwner | null;
  /** Примерный размер аватара в px — от него зависит размытие и размах пламени. */
  size?: number;
  children: ReactNode;
  className?: string;
}) {
  const color = (owner?.aura_color || "").trim() || DEFAULT_AURA;
  const text = (owner?.aura_text || "").trim();
  const style = {
    "--aura": color,
    "--aura-blur": `${Math.max(1.5, Math.round(size * 0.045 * 10) / 10)}px`,
  } as CSSProperties;

  const body = (
    <span className={`aura-wrap ${className}`} style={style}>
      {active && (
        <span className="aura-flame" aria-hidden>
          <span className="aura-tongues" />
          <span className="aura-tongues aura-tongues-2" />
          <span className="aura-rise" />
          <span className="aura-core" />
        </span>
      )}
      {children}
    </span>
  );

  // Значение ауры — подсказкой при наведении. На тач-экранах наведения нет:
  // там значение показывает карточка профиля.
  if (!active || !text || isTouch()) return body;
  return (
    <Tooltip delayDuration={250}>
      <TooltipTrigger asChild>{body}</TooltipTrigger>
      <TooltipContent side="top" className="max-w-[240px]">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
          {text}
        </span>
      </TooltipContent>
    </Tooltip>
  );
}
