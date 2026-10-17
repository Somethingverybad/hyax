import { Capacitor } from "@capacitor/core";
import { APP_VERSION } from "@/lib/appVersion";
import { deviceId } from "@/lib/secret";

/**
 * Паспорт этого устройства для списка «Устройства» в конфиденциальности:
 * id (тот же, что у секретных чатов), платформа, понятное имя и версия.
 * Уходит при входе вместе с логином (api.login) и попадает в токен как did.
 */
export type DevicePlatform = "ios" | "android" | "desktop" | "web";

export function devicePlatform(): DevicePlatform {
  const p = Capacitor.getPlatform();
  if (p === "ios" || p === "android") return p;
  return /Electron/i.test(navigator.userAgent) ? "desktop" : "web";
}

export function deviceName(): string {
  const ua = navigator.userAgent;
  const p = devicePlatform();
  if (p === "ios") return /iPad/.test(ua) ? "iPad" : "iPhone";
  if (p === "android") {
    const m = ua.match(/;\s*([^;)]+?)\s+Build\//) || ua.match(/Android [^;]+;\s*([^;)]+)\)/);
    return m ? `Android · ${m[1].trim()}` : "Android";
  }
  const os = /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "Компьютер";
  if (p === "desktop") return `${os} · приложение`;
  const br = /Firefox\//.test(ua) ? "Firefox" : /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "браузер";
  return `${os} · ${br}`;
}

export function deviceInfo() {
  return { device_id: deviceId(), device_name: deviceName(), platform: devicePlatform(), app_version: APP_VERSION };
}

/**
 * Включить «Показывать 18+» можно везде, кроме приложения для iPhone: там
 * переключателя нет и по умолчанию виден только контент 4+. Включённую на
 * сайте или в десктопе настройку на iPhone можно только выключить.
 */
export const canEnableAdult = () => Capacitor.getPlatform() !== "ios";
