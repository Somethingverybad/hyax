/**
 * Копирование в буфер обмена — вместо navigator.clipboard.writeText напрямую.
 *
 * В WebView Huawei без сервисов Google (Chromium 92, lib/polyfills.ts)
 * navigator.clipboard.writeText отказывает, и «Скопировать ссылку» молча не
 * работала. Тогда — старый способ: выделенное поле и execCommand("copy"),
 * его понимают все WebView. Ошибка — только если не сработало ни то, ни другое
 * (как у navigator.clipboard.writeText, поэтому замена один к одному).
 */
export async function writeClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch { /* старый WebView — ниже */ }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
  document.body.appendChild(ta);
  const prev = document.activeElement as HTMLElement | null;
  try {
    ta.select();
    ta.setSelectionRange(0, text.length);
    if (!document.execCommand("copy")) throw new Error("copy failed");
  } finally {
    ta.remove();
    prev?.focus?.({ preventScroll: true });
  }
}
