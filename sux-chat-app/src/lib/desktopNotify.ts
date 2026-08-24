import { Capacitor } from "@capacitor/core";

/**
 * Системные уведомления для веб- и десктоп-версии (Electron). На мобильных
 * этим занимается нативный Firebase, поэтому там модуль ничего не делает.
 *
 * В Electron разрешение на уведомления выдаётся из основного процесса
 * (see electron/main.cjs), в браузере — спрашивается один раз.
 */

let permissionAsked = false;

// Логотип в баннере. Без него Linux (libnotify) рисует уведомления с пустой
// иконкой, а не с приложением: иконку окна оболочка сюда не подставляет.
const NOTIFY_ICON = "/notification-icon.png";

function available(): boolean {
  return (
    !Capacitor.isNativePlatform() &&
    typeof window !== "undefined" &&
    "Notification" in window
  );
}

export async function ensureNotifyPermission(): Promise<void> {
  if (!available() || permissionAsked) return;
  permissionAsked = true;
  try {
    if (Notification.permission === "default") {
      await Notification.requestPermission();
    }
  } catch {
    /* пользователь мог запретить — молча живём без баннеров */
  }
}

export function showDesktopNotification(opts: {
  title: string;
  body: string;
  tag?: string;
  onClick?: () => void;
}): void {
  if (!available() || Notification.permission !== "granted") return;
  try {
    const n = new Notification(opts.title, {
      body: opts.body,
      tag: opts.tag,
      icon: NOTIFY_ICON,
    });
    n.onclick = () => {
      try {
        window.focus();
      } catch {
        /* no-op */
      }
      opts.onClick?.();
      n.close();
    };
  } catch {
    /* Notification может бросить, если движок не готов — не критично */
  }
}
