import { useEffect, useRef } from "react";

/**
 * Закрыть шторку свайпом вниз — как в системных шитах iOS.
 *
 * Вешается на прокручиваемый корень шторки: тянуть можно, только когда
 * содержимое у самого верха (иначе жест — обычная прокрутка). Шторка едет за
 * пальцем; отпустили дальше порога или резко — уезжает вниз и закрывается,
 * иначе возвращается на место.
 *
 * Слушаем touch-события нативно и не пассивно: если содержимое длиннее шторки,
 * iOS на первом же движении запускает свою прокрутку и обрывает жест
 * (pointercancel) — с Pointer Events шторка «тянулась и возвращалась».
 * preventDefault на touchmove у верхней кромки прокрутку не пускает.
 * Широкие экраны (боковая панель) не трогаем.
 */
export function useSwipeDismiss<T extends HTMLElement = HTMLDivElement>(onClose: () => void, threshold = 120) {
  const ref = useRef<T>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let drag: { y: number; t: number; active: boolean } | null = null;

    const start = (e: TouchEvent) => {
      if (window.innerWidth >= 768 || e.touches.length !== 1 || el.scrollTop > 0) { drag = null; return; }
      drag = { y: e.touches[0].clientY, t: performance.now(), active: false };
    };
    const move = (e: TouchEvent) => {
      if (!drag || e.touches.length !== 1) return;
      const dy = e.touches[0].clientY - drag.y;
      if (!drag.active) {
        if (dy < -4 || el.scrollTop > 0) { drag = null; return; } // прокрутка вверх — не наше
        if (dy < 6) return;
        drag.active = true;
        el.style.transition = "none";
      }
      e.preventDefault(); // иначе iOS начнёт прокрутку и оборвёт жест
      el.style.transform = `translateY(${Math.max(0, dy)}px)`;
    };
    const finish = (e: TouchEvent) => {
      const d = drag;
      drag = null;
      if (!d || !d.active) return;
      const y = e.changedTouches[0]?.clientY ?? d.y;
      const dy = y - d.y;
      const speed = dy / Math.max(1, performance.now() - d.t); // px/мс
      el.style.transition = "transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1)";
      if (dy > threshold || speed > 0.7) {
        el.style.transform = "translateY(110%)";
        setTimeout(() => closeRef.current(), 170);
      } else {
        el.style.transform = "";
      }
    };

    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", finish);
    el.addEventListener("touchcancel", finish);
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", finish);
      el.removeEventListener("touchcancel", finish);
    };
  }, [threshold]);

  return { ref };
}
