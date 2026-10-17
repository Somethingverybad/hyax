import { useCallback, useLayoutEffect, useMemo, useRef } from "react";

/**
 * Помнит прокрутку списков панели выбора (эмодзи, стикеры, звуки, действия):
 * открыли панель снова — тот же набор на том же месте. Пока приложение
 * открыто — в памяти, между запусками — в localStorage.
 *
 * key — что за список (вкладка и набор); null — не помнить (например, поиск).
 * Содержимое часто приезжает позже (наборы с сервера) — восстанавливаем, как
 * только высоты хватает; прокрутил сам раньше — его выбор и запоминаем.
 */
const PREFIX = "hyax:scroll:";
const memory = new Map<string, number>();
const dirty = new Map<string, number>();
let timer = 0;

const read = (key: string): number => {
  if (memory.has(key)) return memory.get(key)!;
  try {
    const v = Number(localStorage.getItem(PREFIX + key));
    return Number.isFinite(v) ? v : 0;
  } catch { return 0; }
};
const save = (key: string, pos: number) => {
  memory.set(key, pos);
  dirty.set(key, pos);
  if (timer) return;
  timer = window.setTimeout(() => {
    timer = 0;
    try { dirty.forEach((v, k) => localStorage.setItem(PREFIX + k, String(Math.round(v)))); } catch { /* приватный режим */ }
    dirty.clear();
  }, 400);
};

export type ScrollMemoryRef<T extends HTMLElement> = ((el: T | null) => void) & { readonly current: T | null };

/** Ref-функция для прокручиваемого списка: переподключается к каждому новому
 *  элементу (вкладки панели создают свои списки заново); .current — сам элемент. */
export function useScrollMemory<T extends HTMLElement = HTMLDivElement>(key: string | null, axis: "y" | "x" = "y"): ScrollMemoryRef<T> {
  const el = useRef<T | null>(null);
  const done = useRef<string | null>(null);
  const keyRef = useRef(key);
  keyRef.current = key;
  const unbind = useRef<(() => void) | null>(null);
  const pos = (e: T) => (axis === "y" ? e.scrollTop : e.scrollLeft);
  const restore = () => {
    const e = el.current, k = keyRef.current;
    if (!e || !k || done.current === k) return;
    const want = read(k);
    if (!want) { done.current = k; return; }
    const max = axis === "y" ? e.scrollHeight - e.clientHeight : e.scrollWidth - e.clientWidth;
    if (max >= want - 1) {
      if (axis === "y") e.scrollTop = want; else e.scrollLeft = want;
      done.current = k;
    }
  };
  const bind = useCallback((node: T | null) => {
    unbind.current?.();
    unbind.current = null;
    el.current = node;
    done.current = null; // новый список — восстановить заново
    if (!node) return;
    const on = () => {
      const k = keyRef.current;
      if (!k) return;
      done.current = k; // прокрутил сам — дальше не вмешиваемся
      save(k, pos(node));
    };
    node.addEventListener("scroll", on, { passive: true });
    unbind.current = () => node.removeEventListener("scroll", on);
    restore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [axis]);
  // Каждую отрисовку, пока не восстановили: так ловим момент, когда приехало содержимое.
  useLayoutEffect(restore);
  return useMemo(() => Object.defineProperty((node: T | null) => bind(node), "current", { get: () => el.current }) as ScrollMemoryRef<T>, [bind]);
}
