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
