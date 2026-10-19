import { Capacitor, registerPlugin } from "@capacitor/core";

/**
 * Не гасить экран, пока это нужно (запись голосового или треугольника):
 * на телефоне экран гаснет сам через полминуты-минуту без касаний, а с
 * блокировкой WebView теряет микрофон — запись обрывается.
 *
 * Нативно — плагин ScreenAwake (iOS: isIdleTimerDisabled, Android:
 * FLAG_KEEP_SCREEN_ON; сборки iOS 194+ и APK с ним). Где его нет — старая
 * сборка с интерфейсом по воздуху, веб, компьютер — Screen Wake Lock API,
 * если движок его умеет. Держателей может быть несколько: экран отпускаем,
 * когда отпустили все.
 */

const Native = registerPlugin<{ keep(o: { on: boolean }): Promise<void> }>("ScreenAwake");
const hasNative = Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("ScreenAwake");

const holders = new Set<string>();
let sentinel: WakeLockSentinel | null = null;

async function webLock(on: boolean) {
  const wl = typeof navigator !== "undefined" ? navigator.wakeLock : undefined;
  if (!wl) return;
  try {
    if (on && !sentinel) {
      const s = await wl.request("screen");
      // Пока ждали, держатели могли уйти.
      if (!holders.size) { void s.release().catch(() => {}); return; }
      sentinel = s;
      s.addEventListener("release", () => { if (sentinel === s) sentinel = null; });
    } else if (!on && sentinel) {
      const s = sentinel;
      sentinel = null;
      await s.release();
    }
  } catch { /* не дали (энергосбережение, не на экране) — не страшно */ }
}

function apply(on: boolean) {
  if (hasNative) void Native.keep({ on }).catch(() => {});
  else void webLock(on);
}

/** Держать экран включённым по причине `reason` (или отпустить). */
export function keepScreenAwake(reason: string, on: boolean) {
  const before = holders.size > 0;
  if (on) holders.add(reason); else holders.delete(reason);
  if (before !== holders.size > 0) apply(holders.size > 0);
}

// Браузер снимает блокировку, когда страница уходит с экрана, — вернуть.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (!hasNative && document.visibilityState === "visible" && holders.size) void webLock(true);
  });
}
