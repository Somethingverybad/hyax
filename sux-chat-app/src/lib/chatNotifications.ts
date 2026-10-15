import { Capacitor, registerPlugin } from "@capacitor/core";

/**
 * Уведомления о сообщениях по чатам (нативный ChatNotifications: iOS —
 * PushSecretPlugin.swift, Android — ChatNotificationsPlugin.java). Прочитал
 * чат — его уведомления пропадают с экрана, а не копятся. С другого
 * устройства то же делает тихий пуш chat_read (сервер, mark_chat_as_read).
 * В старых сборках модуля нет — тогда просто ничего не происходит.
 */
const Native = registerPlugin<{
  dismiss(o: { chatIds: string[] }): Promise<void>;
  list(): Promise<{ chatIds: string[] }>;
}>("ChatNotifications");

const native = () => Capacitor.isNativePlatform();

export function dismissChatNotifications(chatIds: string[]) {
  if (!native() || !chatIds.length) return;
  Native.dismiss({ chatIds }).catch(() => {});
}

/** Убрать уведомления чатов, в которых ничего не осталось непрочитанным.
 *  unread(id) — есть ли там непрочитанное; про незнакомый чат — да (не трогаем). */
export async function sweepReadNotifications(unread: (chatId: string) => boolean) {
  if (!native()) return;
  try {
    const { chatIds } = await Native.list();
    const read = (chatIds || []).filter((id) => !unread(id));
    if (read.length) await Native.dismiss({ chatIds: read });
  } catch { /* старая сборка без модуля */ }
}
