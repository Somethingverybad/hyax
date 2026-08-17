// Кеш сессии: профиль и список чатов переживают перемонтирование экранов и
// перезапуск приложения. Без него каждое переключение вкладок «Чаты/Профиль»
// начиналось с чёрного экрана: Chat рендерит null, пока профиль не придёт из
// сети, а список чатов на мгновение пропадал и перезагружался.
const KEYS = {
  user: "cache_user",
  chats: "cache_chats",
} as const;

export function readCache<T>(key: keyof typeof KEYS): T | null {
  try {
    return JSON.parse(localStorage.getItem(KEYS[key]) || "null");
  } catch {
    return null;
  }
}

export function writeCache(key: keyof typeof KEYS, value: unknown) {
  try {
    localStorage.setItem(KEYS[key], JSON.stringify(value));
  } catch {
    // Хранилище переполнено или недоступно — не критично, просто без кеша.
  }
}

export function clearSessionCache() {
  Object.values(KEYS).forEach((k) => localStorage.removeItem(k));
}
