import { useSyncExternalStore } from "react";
import { confirmDialog } from "@/lib/confirm";
import { t as tr } from "@/lib/i18n";

/**
 * Мини-приложения ботов: какое сейчас открыто (окно — MiniAppHost, он один на
 * всё приложение, как плеер и звонок). Открывают кнопка в чате с ботом,
 * карточка бота и кнопки web_app под его сообщениями.
 */
export interface MiniAppRequest {
  botId: string;
  botName: string;
  /** Адрес из кнопки сообщения; без него — мини-приложение бота. */
  url?: string;
  chatId?: string;
  startParam?: string;
}

let current: (MiniAppRequest & { key: number }) | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
export const useMiniApp = () => useSyncExternalStore(
  (f) => { subs.add(f); return () => { subs.delete(f); }; }, () => current, () => current);

const OK_KEY = (botId: string) => `hyax:webapp-ok:${botId}`;

/** Открыть мини-приложение. В первый раз для бота — спросить: страница
 *  узнает ник и аватар (требование 4.7.3 — данные только с согласия). */
export async function openMiniApp(r: MiniAppRequest) {
  let agreed = false;
  try { agreed = localStorage.getItem(OK_KEY(r.botId)) === "1"; } catch { /* приватный режим */ }
  if (!agreed) {
    const yes = await confirmDialog(
      tr("Мини-приложение @{bot} откроется внутри WYX и узнает ваш ник и аватар. Открыть?", { bot: r.botName }),
      { ok: tr("Открыть"), danger: false },
    );
    if (!yes) return;
    try { localStorage.setItem(OK_KEY(r.botId), "1"); } catch { /* без памяти — спросим снова */ }
  }
  current = { ...r, key: Date.now() };
  emit();
}

/** Открыто ли окно: «назад» на Android тогда относится к нему, а не к экрану под ним. */
export const isMiniAppOpen = () => !!current;

export function closeMiniApp() {
  current = null;
  emit();
}
