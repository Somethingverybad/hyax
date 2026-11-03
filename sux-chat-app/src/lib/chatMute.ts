import { t } from "@/lib/i18n";

/**
 * Уведомления чата выключены у меня, как в Telegram: навсегда или на 1, 4,
 * 8 часов (сервер: ChatParticipant.muted / muted_until, POST chats/<id>/mute/).
 * Сообщения приходят и в открытом чате звучат; нет пушей, системных
 * уведомлений и звука о сообщениях в неоткрытом чате.
 */
export type MuteSpan = "1h" | "4h" | "8h" | "forever" | "off";
export type MuteState = { muted?: boolean; muted_until?: string | null };

export const MUTE_SPANS: { span: Exclude<MuteSpan, "off">; label: string }[] = [
  { span: "1h", label: "На 1 час" },
  { span: "4h", label: "На 4 часа" },
  { span: "8h", label: "На 8 часов" },
  { span: "forever", label: "Навсегда" },
];

/** Выключены сейчас: навсегда (muted без срока) или срок ещё не вышел. */
export function isMutedNow(c?: MuteState | null): boolean {
  if (!c?.muted) return false;
  if (!c.muted_until) return true;
  return Date.parse(c.muted_until) > Date.now();
}

/** «Без уведомлений до 14:30» / «Без уведомлений». */
export function muteLabel(c?: MuteState | null): string {
  if (!isMutedNow(c)) return t("Уведомления включены");
  if (!c?.muted_until) return t("Без уведомлений");
  const d = new Date(c.muted_until);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString()
    ? t("Без уведомлений до {time}", { time })
    : t("Без уведомлений до завтра, {time}", { time });
}
