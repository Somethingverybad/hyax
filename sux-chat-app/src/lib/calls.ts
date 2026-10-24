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
const waiters: Array<() => void> = [];

export const setCallStarter = (f: typeof starter) => {
  starter = f;
  if (f) { waiters.splice(0).forEach((w) => w()); }
};

/** Хост звонков грузится после первого кадра (App.tsx DeferredCallHost):
 *  нажали «позвонить» раньше — ждём его регистрации (до 8 с), а не теряем звонок. */
export function startCall(o: StartCallOptions): Promise<void> {
  if (starter) return starter(o);
  return new Promise<void>((res) => {
    const timer = window.setTimeout(() => res(), 8000);
    waiters.push(() => { window.clearTimeout(timer); res(starter ? starter(o) : undefined); });
  });
}
