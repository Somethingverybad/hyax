import { accountKey, activeAccountId, clearAccountLocalStorage, syncAccountProfile } from "@/lib/accounts";

// Кеш сессии: профиль и список чатов переживают перемонтирование экранов и
// перезапуск приложения. Без него каждое переключение вкладок «Чаты/Профиль»
// начиналось с чёрного экрана: Chat рендерит null, пока профиль не придёт из
// сети, а список чатов на мгновение пропадал и перезагружался.
// Ключи изолированы по активному аккаунту (lib/accounts.ts).
const KEYS = {
  user: "cache_user",
  chats: "cache_chats",
  // Чат «Избранное»: его id сервер отдаёт отдельным запросом, и без кеша
  // вкладка каждый раз открывалась с «Загрузка…», хотя сами сообщения лежат
  // в кеше и показались бы сразу.
  saved: "cache_saved_chat",
  // Музыка: список плейлистов и треки по каждому — по той же причине.
  playlists: "cache_playlists",
  playlistTracks: "cache_playlist_tracks",
  // Открытые плейлисты собеседников и эфиры — разделы той же вкладки.
  publicPlaylists: "cache_public_playlists",
  stations: "cache_stations",
  wall: "cache_wall",
} as const;

export function readCache<T>(key: keyof typeof KEYS): T | null {
  try {
    return JSON.parse(localStorage.getItem(accountKey(KEYS[key])) || "null");
  } catch {
    return null;
  }
}

export function writeCache(key: keyof typeof KEYS, value: unknown) {
  // Профиль обновился — сначала синхронизируем запись аккаунта (если это был
  // первый запуск после миграции, activeAccountId() станет известен прямо здесь).
  if (key === "user" && value && typeof value === "object") {
    syncAccountProfile(value as { id?: string; username?: string; avatar_url?: string | null; aura_color?: string | null });
  }
  try {
    localStorage.setItem(accountKey(KEYS[key]), JSON.stringify(value));
  } catch {
    // Хранилище переполнено или недоступно — не критично, просто без кеша.
  }
  // Профиль поменялся — разделы (Стена, «Долгий ящик») перечитают видимость.
  if (key === "user") {
    try { window.dispatchEvent(new Event("hyax:sections")); } catch { /* не браузер */ }
  }
}

export function clearSessionCache(accountId?: string | null) {
  const uid = accountId === undefined ? activeAccountId() : accountId;
  if (uid) {
    clearAccountLocalStorage(uid);
  } else {
    Object.values(KEYS).forEach((k) => localStorage.removeItem(k));
    // Черновики сообщений (lib/drafts) — тоже данные аккаунта.
    try { localStorage.removeItem("hyax:drafts"); } catch { /* приватный режим */ }
  }
  // Выход из активного аккаунта: общий сокет (lib/userSocket) и звонок закрываются.
  if (!uid || uid === activeAccountId()) {
    try { window.dispatchEvent(new Event("hyax:session-cleared")); } catch { /* не браузер */ }
  }
}
