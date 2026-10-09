import { useLayoutEffect, type RefObject } from "react";

/**
 * «Стеклянная» шапка «Мяты»: список уходит под неё и размывается, а не
 * обрезается ровной линией (как в макете). Высота шапки разная (вырез,
 * строка поиска, фильтры), поэтому она мерится и кладётся в --glass-h на
 * родителя — по ней CSS (.mint-glass в mint.css) подтягивает список под шапку
 * и даёт ему отступ сверху.
 */
export function useGlassHeight(ref: RefObject<HTMLElement | null>, on = true, deps: unknown[] = []) {
  useLayoutEffect(() => {
    const el = ref.current;
    const host = el?.parentElement;
    if (!on || !el || !host) return;
    let last = -1;
    const set = () => {
      const h = el.offsetHeight;
      if (h !== last) { last = h; host.style.setProperty("--glass-h", `${h}px`); }
    };
    set();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(set) : null;
    ro?.observe(el);
    return () => { ro?.disconnect(); host.style.removeProperty("--glass-h"); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, ...deps]);
}
