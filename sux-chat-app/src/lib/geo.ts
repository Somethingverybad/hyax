import { Capacitor } from "@capacitor/core";

/**
 * Геопозиция для отправки в чат. В приложении на телефоне — плагин
 * @capacitor/geolocation (одно системное окно разрешения; у WKWebView своё,
 * второе), в браузере и десктопе — navigator.geolocation.
 */
export interface GeoFix { lat: number; lng: number; accuracy: number | null }

export class GeoError extends Error {
  constructor(public kind: "denied" | "unavailable" | "timeout", message: string) { super(message); }
}

const MESSAGES = {
  denied: "Нет доступа к геопозиции — разрешите его в настройках",
  unavailable: "Не удалось определить местоположение",
  timeout: "Местоположение определяется слишком долго — попробуйте ещё раз",
} as const;

/**
 * Разрешение. Спрашиваем при каждой попытке, пока не дали: системное окно
 * показывается, если система ещё позволяет (iOS — только первый раз, Android
 * — пока не выбрали «Больше не спрашивать»). Если окна не было и доступа нет,
 * GeoError("denied") — экран предлагает открыть настройки.
 */
export async function ensureGeoPermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return true; // браузер спросит сам в getCurrentPosition
  const { Geolocation } = await import("@capacitor/geolocation");
  const ok = (p: { location: string; coarseLocation: string }) => p.location === "granted" || p.coarseLocation === "granted";
  try {
    const now = await Geolocation.checkPermissions();
    if (ok(now)) return true;
    return ok(await Geolocation.requestPermissions());
  } catch {
    return false; // службы геолокации выключены целиком
  }
}

const FIRST_ASK_KEY = "hyax.geo.asked";
/** Первый запуск после установки: спрашиваем разрешение заранее, один раз. */
export async function askGeoOnFirstLaunch() {
  if (!Capacitor.isNativePlatform()) return;
  try { if (localStorage.getItem(FIRST_ASK_KEY)) return; localStorage.setItem(FIRST_ASK_KEY, "1"); } catch { return; }
  try {
    const { Geolocation } = await import("@capacitor/geolocation");
    const now = await Geolocation.checkPermissions();
    if (now.location === "prompt" || now.location === "prompt-with-rationale") await Geolocation.requestPermissions();
  } catch { /* службы выключены — спросим при отправке */ }
}

/** Настройки приложения: на iOS — прямо в раздел WhoYaX. */
export const canOpenAppSettings = () => Capacitor.getPlatform() === "ios";
export const openAppSettings = () => { window.open("app-settings:", "_system"); };

export async function getPosition(): Promise<GeoFix> {
  if (Capacitor.isNativePlatform()) {
    if (!(await ensureGeoPermission())) throw new GeoError("denied", MESSAGES.denied);
    const { Geolocation } = await import("@capacitor/geolocation");
    try {
      const p = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
      return { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy ?? null };
    } catch (e: any) {
      const msg = String(e?.message || "");
      if (/denied|permission/i.test(msg)) throw new GeoError("denied", MESSAGES.denied);
      if (/timeout/i.test(msg)) throw new GeoError("timeout", MESSAGES.timeout);
      throw new GeoError("unavailable", MESSAGES.unavailable);
    }
  }
  if (!("geolocation" in navigator)) throw new GeoError("unavailable", MESSAGES.unavailable);
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy ?? null }),
      (e) => reject(e.code === e.PERMISSION_DENIED ? new GeoError("denied", MESSAGES.denied)
        : e.code === e.TIMEOUT ? new GeoError("timeout", MESSAGES.timeout)
        : new GeoError("unavailable", MESSAGES.unavailable)),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  });
}

/** Куда открыть точку. Ссылки https: если приложение карт стоит — откроется оно. */
export function mapLinks(lat: number, lng: number): { label: string; url: string }[] {
  const platform = Capacitor.getPlatform();
  const apple = platform === "ios" || /Mac/i.test(navigator.platform || "");
  return [
    { label: "Яндекс Карты", url: `https://yandex.ru/maps/?pt=${lng},${lat}&z=16&l=map` },
    ...(apple ? [{ label: "Apple Карты", url: `https://maps.apple.com/?ll=${lat},${lng}&q=${lat},${lng}` }] : []),
    { label: "Google Карты", url: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}` },
  ];
}

export const formatCoords = (lat: number, lng: number) => `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
