import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Вложение рядом с видимой частью ленты — тогда и только тогда оно просит
 * подпись ссылки и начинает грузиться. Лента открывается внизу, поэтому
 * первыми грузятся нижние (видимые) вложения, остальные — по мере прокрутки
 * вверх. Раньше подпись и загрузку просили сразу все вложения в порядке
 * разметки, сверху вниз: видимые снизу ждали, пока догрузится вся лента.
 *
 * Зона — сама лента (ближайший прокручиваемый предок) плюс экран сверху и
 * снизу. Попадание перепроверяем через долю секунды: первый кадр лента
 * рисует с прокруткой наверху и только потом встаёт вниз — без проверки
 * верхние вложения успевали «показаться» и уйти в загрузку. Раз попало —
 * дальше всегда true: загруженное не выгружаем.
 */
const CONFIRM_MS = 120;

type Entry = { el: HTMLElement; done: () => void; inside: boolean; timer: number };
const observers = new Map<Element | null, { io: IntersectionObserver; entries: Map<Element, Entry> }>();

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if (oy === "auto" || oy === "scroll" || oy === "overlay") return p;
  }
  return null;
}

function watch(el: HTMLElement, done: () => void): () => void {
  if (typeof IntersectionObserver === "undefined") { done(); return () => {}; }
  const root = scrollParent(el);
  let group = observers.get(root);
  if (!group) {
    const entries = new Map<Element, Entry>();
    const io = new IntersectionObserver((list) => {
      for (const it of list) {
        const e = entries.get(it.target);
        if (!e) continue;
        // Скрытое (display: none) пересечения не даёт — такое и не грузим.
        e.inside = it.isIntersecting && (it.boundingClientRect.width > 0 || it.boundingClientRect.height > 0);
        if (!e.inside || e.timer) continue;
        // Последнее слово — за наблюдателем: если лента за это время ушла
        // (встала вниз), он успеет сообщить «вне зоны», и грузить не будем.
        e.timer = window.setTimeout(() => {
          e.timer = 0;
          if (entries.get(e.el) !== e || !e.inside) return;
          entries.delete(e.el);
          io.unobserve(e.el);
          e.done();
        }, CONFIRM_MS);
      }
    }, { root, rootMargin: "100% 0px" });
    group = { io, entries };
    observers.set(root, group);
  }
  const g = group;
  g.entries.set(el, { el, done, inside: false, timer: 0 });
  g.io.observe(el);
  return () => {
    const e = g.entries.get(el);
    if (e?.timer) window.clearTimeout(e.timer);
    g.entries.delete(el);
    g.io.unobserve(el);
    if (!g.entries.size) { g.io.disconnect(); observers.delete(root); }
  };
}

/** [ref, near]: ref — на коробку вложения (у неё должен быть размер до загрузки). */
export function useNearView<T extends HTMLElement = HTMLDivElement>(): [(el: T | null) => void, boolean] {
  const [near, setNear] = useState(false);
  const stop = useRef<(() => void) | null>(null);
  const ref = useCallback((el: T | null) => {
    stop.current?.();
    stop.current = null;
    if (el) stop.current = watch(el, () => setNear(true));
  }, []);
  useEffect(() => () => stop.current?.(), []);
  return [ref, near];
}
