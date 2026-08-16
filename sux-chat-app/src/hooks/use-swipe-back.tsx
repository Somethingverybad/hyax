import { useEffect } from "react";

// Жест засчитывается только от самого края экрана — иначе срабатывал бы на
// любом горизонтальном движении и мешал прокрутке лент и каруселям.
const EDGE_PX = 28;
// Сколько нужно протащить, чтобы это считалось намерением, а не дрожанием.
const MIN_DISTANCE = 70;
// Горизонталь должна заметно преобладать над вертикалью, иначе это скролл.
const HORIZONTAL_RATIO = 1.8;

/**
 * Свайп от левого края — «назад», как в нативных приложениях iOS.
 *
 * Здесь возврат не по истории браузера: список чатов и переписка живут на
 * одном роуте и переключаются состоянием, поэтому жест вызывает переданный
 * колбэк, а не navigate(-1).
 *
 * Слушатели пассивные — прокрутку не тормозим, жест только распознаём.
 */
export function useSwipeBack(onBack?: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled || !onBack) return undefined;

    let startX = 0;
    let startY = 0;
    let tracking = false;

    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t || t.clientX > EDGE_PX) {
        tracking = false;
        return;
      }
      startX = t.clientX;
      startY = t.clientY;
      tracking = true;
    };

    const onEnd = (e: TouchEvent) => {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = Math.abs(t.clientY - startY);
      if (dx > MIN_DISTANCE && dx > dy * HORIZONTAL_RATIO) {
        onBack();
      }
    };

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchend", onEnd);
    };
  }, [onBack, enabled]);
}
