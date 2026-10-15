/**
 * Черновики сообщений по чатам — только на этом устройстве (localStorage).
 * Ушли из чата — текст поля остаётся здесь, вернулись — снова в поле.
 * Секретных чатов здесь нет: их текст на диск не пишем (решает ChatWindow).
 * Список чатов показывает «Черновик: …» — узнаёт об изменениях событием
 * hyax:drafts.
 */
const KEY = "hyax:drafts";
const MAX = 200;
type Store = Record<string, { t: string; at: number }>;

const read = (): Store => {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch { return {}; }
};

export const getDraftText = (chatId: string): string => read()[chatId]?.t || "";

export const allDrafts = (): Record<string, string> =>
  Object.fromEntries(Object.entries(read()).map(([id, d]) => [id, d.t]));

/** Пустой (или из одних пробелов) текст удаляет черновик. */
export function saveDraftText(chatId: string, text: string): void {
  const s = read();
  const t = text.trim() ? text.slice(0, 10000) : "";
  if ((s[chatId]?.t || "") === t) return;
  if (t) s[chatId] = { t, at: Date.now() };
  else delete s[chatId];
  // Самые старые черновики уходят, чтобы хранилище не росло без конца.
  const ids = Object.keys(s);
  if (ids.length > MAX) ids.sort((a, b) => s[a].at - s[b].at).slice(0, ids.length - MAX).forEach((id) => delete s[id]);
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* нет места — без черновика */ }
  try { window.dispatchEvent(new CustomEvent("hyax:drafts", { detail: { chatId } })); } catch { /* не браузер */ }
}

export function clearAllDrafts(): void {
  try { localStorage.removeItem(KEY); } catch { /* приватный режим */ }
}
