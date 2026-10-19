import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/**
 * Выпадающее меню у кнопки, вынесенное в body. Внутри шторки с прокруткой
 * (overflow) обычное absolute-меню обрезается её краем: в окне нового поста
 * верхние пункты «Медиа» уходили под край. Встаёт над кнопкой, а если сверху
 * не помещается — под ней; за края экрана не выходит.
 *
 * Кнопка может уехать, пока меню открыто: касание «Медиа» прячет клавиатуру,
 * и окно поста опускается на её высоту — а размер страницы при этом не
 * меняется (клавиатуру учитываем сами, kbsync в main.tsx), событий нет. Поэтому
 * положение кнопки сверяем каждый кадр, пока меню открыто: это один замер
 * прямоугольника, а меню открыто секунды.
 *
 * Меню вне кнопки по DOM: закрытие по касанию снаружи должно проверять и его
 * (ref), иначе пункт пропадёт раньше, чем сработает нажатие.
 */
const AnchoredMenu = forwardRef<HTMLDivElement, { anchor: RefObject<HTMLElement>; className?: string; children: ReactNode }>(
  function AnchoredMenu({ anchor, className, children }, ref) {
    const box = useRef<HTMLDivElement>(null);
    useImperativeHandle(ref, () => box.current as HTMLDivElement);
    const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

    useLayoutEffect(() => {
      const place = () => {
        const a = anchor.current, el = box.current;
        if (!a || !el) return;
        const r = a.getBoundingClientRect();
        const h = el.offsetHeight, w = el.offsetWidth;
        let top = r.top - h - 8;
        if (top < 8 && r.bottom + 8 + h <= window.innerHeight - 8) top = r.bottom + 8;
        top = Math.max(8, top);
        const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
        setPos((p) => (p && p.top === top && p.left === left ? p : { top, left }));
      };
      let raf = 0;
      const follow = () => { place(); raf = requestAnimationFrame(follow); };
      follow();
      return () => cancelAnimationFrame(raf);
    }, [anchor]);

    return createPortal(
      <div ref={box}
        style={{ position: "fixed", top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? "visible" : "hidden" }}
        className={cn("z-[95] bg-surface-1 border border-border rounded-lg overflow-hidden shadow-lg", className)}>
        {children}
      </div>,
      document.body,
    );
  },
);

export default AnchoredMenu;
