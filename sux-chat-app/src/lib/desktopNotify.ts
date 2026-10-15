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

type ElectronBridge = {
  platform?: string;
  notify?: (p: { title: string; body: string; chatId?: string; avatar?: string }) => Promise<boolean>;
  onOpenChat?: (cb: (chatId: string) => void) => () => void;
};
const bridge = (): ElectronBridge | undefined => (window as unknown as { electronAPI?: ElectronBridge }).electronAPI;

// Клик по своему тосту приходит из main как open-chat с id чата — зовём
// onClick того уведомления, которое его показало.
const pendingClicks = new Map<string, () => void>();
let openChatBound = false;
function bindOpenChat() {
  if (openChatBound) return;
  openChatBound = true;
  bridge()?.onOpenChat?.((chatId) => { const cb = pendingClicks.get(chatId); pendingClicks.delete(chatId); cb?.(); });
}

export function showDesktopNotification(opts: {
  title: string;
  body: string;
  tag?: string;
  avatar?: string;
  onClick?: () => void;
  /** Без системного звука («Звук входящих» выключен). */
  silent?: boolean;
}): void {
  // Windows и Linux в Electron: свой тост в углу экрана (как у Telegram), а не
  // системный центр уведомлений — он там прячет баннеры и теряет клик.
  const b = bridge();
  if (b?.notify && b.platform && b.platform !== "darwin") {
    bindOpenChat();
    if (opts.tag && opts.onClick) pendingClicks.set(opts.tag, opts.onClick);
    void b.notify({ title: opts.title, body: opts.body, chatId: opts.tag, avatar: opts.avatar });
    return;
  }
  if (!available() || Notification.permission !== "granted") return;
  try {
    const n = new Notification(opts.title, {
      body: opts.body,
      tag: opts.tag,
      icon: NOTIFY_ICON,
      silent: opts.silent,
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
