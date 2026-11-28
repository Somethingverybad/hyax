/**
 * Принудительный выход: сеанс завершили с другого устройства (сокет
 * session_revoked) или сервер отверг токен как отозванный. Стираем всё,
 * что принадлежит именно этому аккаунту: токены, кэш сессии, кэш сообщений,
 * ключи секретных чатов. Если на устройстве есть другие аккаунты —
 * переключаемся на следующий, не трогая его данные; иначе уходим на /auth.
 */
let running = false;

export async function forceLogout(reason?: string): Promise<void> {
  if (running) return;
  running = true;
  let removedUsername: string | undefined;
  let switchedUsername: string | undefined;
  try {
    const { logoutAccount, activeAccountId } = await import("@/lib/accounts");
    const res = await logoutAccount(activeAccountId(), { revokeRemote: false });
    removedUsername = res.removedUsername;
    switchedUsername = res.switchedTo?.username;
  } finally {
    window.dispatchEvent(new CustomEvent("hyax:force-logout", {
      detail: { reason: reason || "", removedUsername, switchedUsername },
    }));
    running = false;
  }
}
