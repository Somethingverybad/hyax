/**
 * Поделиться профилем. Поиска по людям в приложении нет — единственный
 * способ начать чат с человеком, это получить от него ссылку. Ссылка
 * https://huyax.e-tree.su/u/<ник>: на телефоне с установленным ХУЯКСом она
 * открывается прямо в приложении (universal link / app link), у остальных —
 * в браузере той же страницей с кнопкой «Написать» и ссылкой на установку.
 *
 * Через системное меню «Поделиться» (Web Share API — работает в WKWebView и
 * Android WebView), с откатом в буфер обмена.
 */
export type ShareResult = "shared" | "copied" | "error";

/** Домен ссылок захардкожен: в нативной сборке origin — capacitor://localhost. */
export const PUBLIC_ORIGIN = "https://huyax.e-tree.su";

export const profileLink = (username: string) => `${PUBLIC_ORIGIN}/u/${encodeURIComponent(username)}`;
/** Ссылка на пак звуков: по ней пак добавляют себе (см. pages/SoundPackPage). */
export const soundPackLink = (id: string) => `${PUBLIC_ORIGIN}/sp/${id}`;

/** Ссылка на канал: по @username, а без него — по id (канал без хэндла тоже можно передать). */
export const channelLink = (ch: { id: string; username?: string | null }) =>
  `${PUBLIC_ORIGIN}/c/${encodeURIComponent(ch.username || ch.id)}`;

async function shareUrl(title: string, text: string, url: string): Promise<ShareResult> {
  const nav = navigator as Navigator & { share?: (d: any) => Promise<void> };
  if (typeof nav.share === "function") {
    try { await nav.share({ title, text, url }); return "shared"; }
    catch (e: any) { if (e?.name === "AbortError") return "shared"; }
  }
  try { await navigator.clipboard.writeText(`${text}: ${url}`); return "copied"; }
  catch { return "error"; }
}

export const shareChannel = (ch: { id: string; name: string; username?: string | null }) =>
  shareUrl("ХУЯКС", `Канал «${ch.name}» в ХУЯКС`, channelLink(ch));

export async function shareProfile(username: string): Promise<ShareResult> {
  const url = profileLink(username);
  const text = `Напиши мне в ХУЯКС: ${url}`;
  const nav = navigator as Navigator & { share?: (d: any) => Promise<void> };
  if (typeof nav.share === "function") {
    try {
      await nav.share({ title: "ХУЯКС", text: `Напиши мне в ХУЯКС`, url });
      return "shared";
    } catch (e: any) {
      // Пользователь закрыл шит — это не ошибка.
      if (e?.name === "AbortError") return "shared";
      // иначе пробуем буфер обмена
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    return "error";
  }
}
