/**
 * Поделиться профилем. Ник уникален, по нему собеседника находят через поиск —
 * поэтому шарим "@username": получатель ищет его и открывает чат.
 *
 * Через системное меню «Поделиться» (Web Share API — работает в WKWebView и
 * Android WebView), с откатом в буфер обмена.
 */
export type ShareResult = "shared" | "copied" | "error";

export async function shareProfile(username: string): Promise<ShareResult> {
  const text = `Напиши мне в ХУЯКС: @${username}`;
  const nav = navigator as Navigator & { share?: (d: any) => Promise<void> };
  if (typeof nav.share === "function") {
    try {
      await nav.share({ title: "ХУЯКС", text });
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
