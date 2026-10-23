import { useCallback, useRef } from "react";

/**
 * Стабильная ссылка на колбэк: сама функция одна на всё время жизни
 * компонента, но вызывает всегда последнюю версию. Нужна, чтобы дочерние
 * компоненты под React.memo (окна переписок, список чатов) не перерисовывались
 * из-за того, что родитель создал колбэк заново (PERF_PLAN.md, п. 3).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useStable<T extends (...args: any[]) => any>(fn: T): T {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback(((...args: Parameters<T>) => ref.current(...args)) as T, []);
}
