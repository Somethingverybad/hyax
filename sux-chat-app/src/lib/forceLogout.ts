/**
 * Принудительный выход: сеанс завершили с другого устройства (сокет
 * session_revoked) или сервер отверг токен как отозванный. Стираем всё,
 * что могло бы показать чужую переписку следующему человеку за этим
 * устройством: токены, кэш сессии, кэш сообщений, ключи секретных чатов,
 * офлайн-кэш. Переход на /auth делает App по событию hyax:force-logout.
 */
let running = false;

export async function forceLogout(reason?: string): Promise<void> {
  if (running) return;
  running = true;
  try {
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    const [{ clearSessionCache }, { clearMessageCache }, { wipeSecretKeys }] = await Promise.all([
      import("@/lib/session-cache"), import("@/lib/messageCache"), import("@/lib/secret"),
    ]);
    clearSessionCache();
    await Promise.allSettled([clearMessageCache(), wipeSecretKeys()]);
    try { const { clearAppCache } = await import("@/lib/cacheReset"); await clearAppCache(); } catch { /* не критично */ }
  } finally {
    window.dispatchEvent(new CustomEvent("hyax:force-logout", { detail: { reason: reason || "" } }));
    running = false;
  }
}
