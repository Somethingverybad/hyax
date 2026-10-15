/**
 * Звонок начинают экраны (кнопка «Позвонить» в чате), а ведёт его
 * components/call/CallHost — он живёт над всеми экранами, поэтому разговор
 * не обрывается при переходе в настройки, музыку и куда угодно.
 */
export type StartCallOptions = {
  chatId: string;
  isGroup: boolean;
  /** Название группы — заголовок экрана звонка. */
  chatName?: string;
  /** Собеседник в личном звонке. */
  peer?: { id: string; name: string; avatarUrl?: string | null };
};

let starter: ((o: StartCallOptions) => Promise<void>) | null = null;

export const setCallStarter = (f: typeof starter) => { starter = f; };

export function startCall(o: StartCallOptions): Promise<void> {
  return starter ? starter(o) : Promise.resolve();
}
