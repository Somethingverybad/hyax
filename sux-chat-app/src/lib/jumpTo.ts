/**
 * «Открыть чат на сообщении» из поиска (ChatSidebar → ChatWindow): чат
 * открывается своим путём, а сюда кладётся id сообщения; ChatWindow, загрузив
 * ленту, забирает его и подкручивает (jumpToMessage). Не дошёл до чата —
 * запись протухает через минуту.
 */
let pending: { chatId: string; messageId: string; at: number } | null = null;

export function setPendingJump(chatId: string, messageId: string) {
  pending = { chatId, messageId, at: Date.now() };
}

export function takePendingJump(chatId: string): string | null {
  if (!pending || pending.chatId !== chatId) return null;
  if (Date.now() - pending.at > 60_000) { pending = null; return null; }
  const id = pending.messageId;
  pending = null;
  return id;
}
