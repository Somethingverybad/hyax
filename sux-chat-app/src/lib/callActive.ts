import { confirmDialog } from "@/lib/confirm";

/**
 * Идёт ли звонок. Сервис звонков живёт в экране чатов (pages/Chat.tsx):
 * уход на другую вкладку или в настройки пересоздаёт этот экран и обрывает
 * разговор. Свёрнутый звонок не мешает переписываться в любых чатах, а
 * перед уходом с экрана чатов спрашиваем, а не обрываем молча.
 */
let active = false;

export const setCallActive = (v: boolean) => { active = v; };
export const isCallActive = () => active;

/** Можно ли уходить с экрана чатов: без звонка — да, со звонком — спросить. */
export function leaveCallOk(): Promise<boolean> {
  if (!active) return Promise.resolve(true);
  return confirmDialog("Звонок прервётся. Всё равно перейти?", { ok: "Перейти", danger: true });
}
