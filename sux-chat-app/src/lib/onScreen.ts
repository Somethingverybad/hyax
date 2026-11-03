import { Capacitor } from "@capacitor/core";

/**
 * Человек смотрит на приложение: окно видно, а на компьютере ещё и в фокусе.
 * Окно за другими окнами (или на втором мониторе без фокуса) сообщений не
 * «читает» и чат открытым не считает — как в Telegram. Иначе чат, открытый на
 * компьютере, отмечал входящие прочитанными сразу по приходе, а прочтение
 * тихим пушем chat_read стирало их уведомления с телефона. На телефоне
 * хватает видимости.
 */
export function appOnScreen(): boolean {
  if (typeof document === "undefined") return true;
  if (document.visibilityState !== "visible") return false;
  if (Capacitor.isNativePlatform()) return true;
  try { return document.hasFocus(); } catch { return true; }
}

/** Подписка на смену appOnScreen(): видимость и фокус окна. Проверять
 *  после события: внутри blur фокус ещё может числиться за окном. */
export function onScreenChange(cb: () => void): () => void {
  const fire = () => { window.setTimeout(cb, 0); };
  document.addEventListener("visibilitychange", fire);
  window.addEventListener("focus", fire);
  window.addEventListener("blur", fire);
  return () => {
    document.removeEventListener("visibilitychange", fire);
    window.removeEventListener("focus", fire);
    window.removeEventListener("blur", fire);
  };
}
