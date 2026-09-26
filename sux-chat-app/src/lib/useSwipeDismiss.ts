import { useRef } from "react";

/**
 * Закрыть шторку свайпом вниз — как в системных шитах iOS.
 *
 * Вешается на прокручиваемый корень шторки: тянуть можно, только когда
 * содержимое у самого верха (иначе жест — обычная прокрутка). Шторка едет за
 * пальцем; отпустили дальше порога или резко — уезжает вниз и закрывается,
 * иначе возвращается на место. Мышь и широкие экраны (боковая панель) не
 * трогаем.
 */
export function useSwipeDismiss<T extends HTMLElement = HTMLDivElement>(onClose: () => void, threshold = 120) {
  const ref = useRef<T>(null);
  const drag = useRef<{ y: number; t: number; active: boolean; id: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el || e.pointerType === "mouse" || window.innerWidth >= 768) return;
    if (el.scrollTop > 0) return;
    drag.current = { y: e.clientY, t: performance.now(), active: false, id: e.pointerId };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current, el = ref.current;
    if (!d || !el || e.pointerId !== d.id) return;
    const dy = e.clientY - d.y;
    if (!d.active) {
      if (dy < -6 || el.scrollTop > 0) { drag.current = null; return; } // это прокрутка вверх
      if (dy < 8) return;
      d.active = true;
      el.style.transition = "none";
    }
    el.style.transform = `translateY(${Math.max(0, dy)}px)`;
  };
  const finish = (e: React.PointerEvent) => {
    const d = drag.current, el = ref.current;
    if (!d || e.pointerId !== d.id) return;
    drag.current = null;
    if (!el || !d.active) return;
    const dy = e.clientY - d.y;
    const speed = dy / Math.max(1, performance.now() - d.t); // px/мс
    el.style.transition = "transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1)";
    if (dy > threshold || speed > 0.7) {
      el.style.transform = "translateY(110%)";
      setTimeout(onClose, 170);
    } else {
      el.style.transform = "";
    }
  };

  return { ref, handlers: { onPointerDown, onPointerMove, onPointerUp: finish, onPointerCancel: finish } };
}
