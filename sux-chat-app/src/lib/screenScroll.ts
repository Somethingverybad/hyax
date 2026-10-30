/**
 * Прокрутка экранов при возврате «Назад» (идея из «Долгого ящика»: открыл
 * настройки, пролистал, зашёл в пункт, вернулся — и снова в самом начале).
 *
 * Каждый экран при переходе монтируется заново (AnimatedRoutes в App.tsx),
 * поэтому позицию держим здесь: по ходу прокрутки запоминаем scrollTop
 * прокручиваемых блоков экрана — по записи истории (location.key) и по пути.
 * Вернулись назад (POP или переход вверх по пути) — ставим обратно, пока
 * экран догружается, но не дольше секунды и не споря с пальцем.
 */
import { useEffect, useLayoutEffect, type RefObject } from "react";

type Spot = { idx: number; top: number };
const byKey = new Map<string, Spot[]>();
const byPath = new Map<string, Spot[]>();
const LIMIT = 60;
// Пока ставим позицию на место, промежуточные scrollTop не запоминаем.
let restoringUntil = 0;
// Прокручиваемые блоки экрана — по классам Tailwind (overflow-y-auto и т. п.)
// или явной пометке data-scroll-memory.
const SCROLLERS = ".overflow-y-auto, .overflow-auto, .overflow-y-scroll, [data-scroll-memory]";

function remember(map: Map<string, Spot[]>, k: string, spots: Spot[]) {
  map.delete(k);
  map.set(k, spots);
  if (map.size > LIMIT) map.delete(map.keys().next().value as string);
}

/** box — обёртка экрана; skip — экраны со своей прокруткой (лента чата). */
export function useScreenScroll(box: RefObject<HTMLElement | null>, key: string, path: string, back: boolean, skip: boolean) {
  // Запоминаем по ходу: после ухода с экрана его DOM уже не прочитать.
  useEffect(() => {
    if (skip) return;
    let raf = 0;
    const save = () => {
      raf = 0;
      if (performance.now() < restoringUntil) return;
      const root = box.current;
      if (!root) return;
      const spots: Spot[] = [];
      root.querySelectorAll<HTMLElement>(SCROLLERS).forEach((el, idx) => { if (el.scrollTop > 0) spots.push({ idx, top: el.scrollTop }); });
      remember(byKey, key, spots);
      remember(byPath, path, spots);
    };
    const onScroll = (e: Event) => {
      const t = e.target;
      if (!(t instanceof HTMLElement) || !box.current?.contains(t)) return;
      if (!raf) raf = requestAnimationFrame(save);
    };
    document.addEventListener("scroll", onScroll, true);
    return () => { document.removeEventListener("scroll", onScroll, true); if (raf) cancelAnimationFrame(raf); };
  }, [box, key, path, skip]);

  // Вернулись — ставим на место. Содержимое может догружаться (список с
  // сервера), поэтому пробуем по кадрам до секунды; палец или колесо — стоп.
  useLayoutEffect(() => {
    if (skip || !back) return;
    const spots = byKey.get(key) || byPath.get(path);
    if (!spots?.length) return;
    const started = performance.now();
    restoringUntil = started + 1000;
    let raf = 0, stop = false;
    const quit = () => { stop = true; restoringUntil = 0; };
    window.addEventListener("touchstart", quit, { passive: true, once: true });
    window.addEventListener("wheel", quit, { passive: true, once: true });
    const tick = () => {
      if (stop) return;
      const els = box.current?.querySelectorAll<HTMLElement>(SCROLLERS);
      let left = 0;
      for (const s of spots) {
        const el = els?.[s.idx];
        if (!el) { left++; continue; }
        const max = el.scrollHeight - el.clientHeight;
        el.scrollTop = Math.min(s.top, max);
        if (max + 1 < s.top) left++;
      }
      if (left && performance.now() - started < 1000) raf = requestAnimationFrame(tick);
      else restoringUntil = 0;
    };
    tick();
    return () => { stop = true; restoringUntil = 0; if (raf) cancelAnimationFrame(raf); window.removeEventListener("touchstart", quit); window.removeEventListener("wheel", quit); };
  }, [box, key, path, back, skip]);
}
