import { Capacitor } from "@capacitor/core";

/**
 * Заставка при запуске (логотип в index.html): можно выключить — тогда до
 * первого кадра приложения показывается только фон темы. Настройка этого
 * устройства, не аккаунта. Есть только в приложениях: в браузере заставки нет.
 */
const KEY = "hyax:boot-anim";

export const hasBootAnim = () =>
  Capacitor.isNativePlatform() || (typeof navigator !== "undefined" && /Electron/.test(navigator.userAgent));

export function isBootAnimOn(): boolean {
  try { return localStorage.getItem(KEY) !== "0"; } catch { return true; }
}

export function setBootAnimOn(on: boolean) {
  try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* приватный режим */ }
}
