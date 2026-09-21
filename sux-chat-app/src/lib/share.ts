/**
 * Поделиться профилем. Поиска по людям в приложении нет — единственный
 * способ начать чат с человеком, это получить от него ссылку. Ссылка
 * https://huyax.e-tree.su/u/<ник>: на телефоне с установленным WhoYaXом она
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
/** Ссылка на тему оформления — /t/<id>, как у паков. */
export const themeLink = (id: string) => `${PUBLIC_ORIGIN}/t/${id}`;

export const soundPackLink = (id: string) => `${PUBLIC_ORIGIN}/sp/${id}`;
/** Ссылка на стикерпак: по ней пак добавляют себе (см. pages/StickerPackPage). */
export const stickerPackLink = (id: string) => `${PUBLIC_ORIGIN}/stp/${id}`;

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

/** Поделиться паком звуков: системное окно «Поделиться», иначе — буфер. */
export const shareSoundPack = (name: string, id: string) =>
  shareUrl("WhoYaX", `Пак звуков «${name}» в WhoYaX`, soundPackLink(id));

export const shareChannel = (ch: { id: string; name: string; username?: string | null }) =>
  shareUrl("WhoYaX", `Канал «${ch.name}» в WhoYaX`, channelLink(ch));

export async function shareProfile(username: string): Promise<ShareResult> {
  const url = profileLink(username);
  const text = `Напиши мне в WhoYaX: ${url}`;
  const nav = navigator as Navigator & { share?: (d: any) => Promise<void> };
  if (typeof nav.share === "function") {
    try {
      await nav.share({ title: "WhoYaX", text: `Напиши мне в WhoYaX`, url });
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
