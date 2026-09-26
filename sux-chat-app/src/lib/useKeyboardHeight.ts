import { useEffect, useState } from "react";

/**
 * Текущая высота экранной клавиатуры (px), 0 — закрыта. Источник — событие
 * hyax:keyboard из main.tsx (iOS: свой плагин KeyboardSync, Android: штатный
 * плагин). Нужна модалкам: viewport под клавиатуру не ужимается (resize:
 * none), и центрированный диалог наполовину уезжал под неё — поле ввода
 * оказывалось недоступным.
 */
let current = 0;
if (typeof window !== "undefined") {
  window.addEventListener("hyax:keyboard", (e) => {
    current = Math.max(0, Math.round((e as CustomEvent<{ height: number }>).detail?.height || 0));
  });
}

export function useKeyboardHeight(): number {
  const [h, setH] = useState(current);
  useEffect(() => {
    const on = () => setH(current);
    window.addEventListener("hyax:keyboard", on);
    on();
    return () => window.removeEventListener("hyax:keyboard", on);
  }, []);
  return h;
}
