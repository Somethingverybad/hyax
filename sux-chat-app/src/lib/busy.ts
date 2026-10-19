/**
 * «Занято» — сейчас нельзя незаметно перезагрузить интерфейс (обновление по
 * воздуху применяется на лету, lib/ota.ts): идёт звонок, запись голосового
 * или кружка, загрузка файла. Музыку и эфир lib/ota.ts смотрит сам — по плееру.
 *
 * Счётчик по ключу: одна и та же причина может быть занята несколько раз
 * (две загрузки разом).
 */
const counts = new Map<string, number>();

export function setBusy(key: string, on: boolean) {
  const n = (counts.get(key) || 0) + (on ? 1 : -1);
  if (n > 0) counts.set(key, n);
  else counts.delete(key);
}

/** Выполнить и всё это время считаться занятым (загрузка файла). */
export async function withBusy<T>(key: string, run: () => Promise<T>): Promise<T> {
  setBusy(key, true);
  try { return await run(); } finally { setBusy(key, false); }
}

export const isBusy = () => counts.size > 0;
