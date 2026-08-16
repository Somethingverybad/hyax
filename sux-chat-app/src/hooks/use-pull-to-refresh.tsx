import { useEffect, useState } from "react";

const THRESHOLD = 70;
const MAX_PULL = 110;
// Сопротивление: палец проходит больше, чем смещается индикатор — жест
// ощущается упругим, а не липнущим.
const RESISTANCE = 2.2;

/**
 * Потянуть вниз для обновления.
 *
 * Список чатов лежит внутри Radix ScrollArea, а прокручивается не сам
 * контейнер, а вложенный viewport — поэтому слушатели вешаются именно на него,
 * иначе scrollTop всегда 0 и жест срабатывал бы посреди списка.
 *
 * Возвращает { pull, refreshing } для отрисовки индикатора.
 */
export function usePullToRefresh(
  containerRef: React.RefObject<HTMLElement>,
  onRefresh?: () => Promise<unknown> | void,
  enabled = true,
) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const root = containerRef.current;
    if (!root || !enabled) return undefined;

    const el = (root.querySelector("[data-radix-scroll-area-viewport]") as HTMLElement) || root;

    let startY = 0;
    let active = false;

    const onStart = (e: TouchEvent) => {
      active = el.scrollTop <= 0 && e.touches.length === 1;
      startY = e.touches[0]?.clientY ?? 0;
    };

    const onMove = (e: TouchEvent) => {
      if (!active || refreshing) return;
      const dy = (e.touches[0]?.clientY ?? 0) - startY;
      if (dy <= 0) {
        setPull(0);
        return;
      }
      setPull(Math.min(dy / RESISTANCE, MAX_PULL));
    };

    const onEnd = async () => {
      if (!active) return;
      active = false;
      if (pull >= THRESHOLD && !refreshing) {
        setRefreshing(true);
        setPull(THRESHOLD);
        try {
          await onRefresh?.();
        } finally {
          setRefreshing(false);
          setPull(0);
        }
      } else {
        setPull(0);
      }
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: true });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [containerRef, onRefresh, enabled, pull, refreshing]);

  return { pull, refreshing };
}
