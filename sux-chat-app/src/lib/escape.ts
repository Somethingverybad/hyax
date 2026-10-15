import { useEffect, useRef } from "react";

/**
 * Клавиша Esc (components/EscapeKey): по порядку —
 *   1. диалог, просмотрщик, подсказки упоминаний закрываются сами и помечают
 *      событие (preventDefault) — тогда больше ничего не делаем;
 *   2. фокус в поле ввода — снимаем его;
 *   3. открыта своя панель или меню (useEscape) — закрываем верхнее;
 *   4. экран сам решает, что такое «назад» (ESC_BACK: открытый чат закрывается);
 *   5. иначе шаг назад по истории, но не дальше списка чатов.
 */
type Handler = () => void;
const stack: Handler[] = [];

/** Пока active — Esc вызывает handler (последний открытый — первым). */
export function useEscape(active: boolean, handler: Handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!active) return;
    const h = () => ref.current();
    stack.push(h);
    return () => {
      const i = stack.lastIndexOf(h);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [active]);
}

/** Закрыть верхнюю панель из стека; false — закрывать нечего. */
export function runEscapeStack(): boolean {
  const h = stack[stack.length - 1];
  if (!h) return false;
  h();
  return true;
}

/** Событие на window: экран, который обработал «назад», зовёт preventDefault. */
export const ESC_BACK = "hyax:escape-back";
