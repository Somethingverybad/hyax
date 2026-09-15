// Кэш ленты сообщений по чатам (IndexedDB): открытый чат рисуется сразу из
// кэша, а сеть докачивает только то, что изменилось после последней
// синхронизации (GET /messages/sync/?since=…) — новые, отредактированные и
// удалённые. Хранится хвост ленты (последние KEEP сообщений) — старое
// подгружается страницами при прокрутке вверх.
//
// localStorage для этого не годится: 5 МБ на всё приложение, а лента одного
// чата с вложениями легко весит сотни килобайт. Без IndexedDB (старый WebView,
// приватный режим) работаем как раньше — просто без кэша.

const DB_NAME = "hyax-cache";
const STORE = "messages";
const POSTS_STORE = "posts";   // ленты каналов — тот же приём, отдельное хранилище
const KEEP = 150;       // сообщений на чат
const MAX_CHATS = 25;   // чатов в кэше; старые по времени записи вытесняются

export interface CachedChat {
  chatId: string;
  messages: any[];
  /** Серверное время последней синхронизации — следующий since. */
  syncedAt: string;
  /** Есть ли на сервере сообщения старее первого в кэше. */
  hasMore: boolean;
  savedAt: number;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") { resolve(null); return; }
      const req = indexedDB.open(DB_NAME, 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "chatId" }).createIndex("savedAt", "savedAt");
        }
        // Версия 2: лента каналов. Ключ тот же — id чата-канала.
        if (!db.objectStoreNames.contains(POSTS_STORE)) {
          db.createObjectStore(POSTS_STORE, { keyPath: "chatId" }).createIndex("savedAt", "savedAt");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

const tx = (db: IDBDatabase, mode: IDBTransactionMode, store: string = STORE) => db.transaction(store, mode).objectStore(store);
const done = <T,>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export async function readMessages(chatId: string): Promise<CachedChat | null> {
  const db = await open();
  if (!db) return null;
  try { return ((await done(tx(db, "readonly").get(chatId))) as CachedChat) || null; } catch { return null; }
}

/** Клиентские поля (pending, ключ рендера, размеры) в кэш не пишем. */
const strip = (m: any) => {
  const { pending, _key, _dims, ...rest } = m;
  return rest;
};

export async function writeMessages(chatId: string, messages: any[], syncedAt: string, hasMore: boolean): Promise<void> {
  const db = await open();
  if (!db) return;
  try {
    const confirmed = messages.filter((m) => !m.pending);
    const tail = confirmed.slice(-KEEP).map(strip);
    const rec: CachedChat = {
      chatId, messages: tail, syncedAt,
      // Обрезали хвост — значит, старое есть, даже если сервер сказал «всё».
      hasMore: hasMore || confirmed.length > KEEP,
      savedAt: Date.now(),
    };
    await done(tx(db, "readwrite").put(rec));
    // Вытесняем самые давние чаты, чтобы кэш не рос бесконечно.
    const store = tx(db, "readonly");
    const count = await done(store.count());
    if (count > MAX_CHATS) {
      const keys = (await done(store.index("savedAt").getAllKeys())) as IDBValidKey[];
      const rw = tx(db, "readwrite");
      keys.slice(0, count - MAX_CHATS).forEach((k) => rw.delete(k));
    }
  } catch {
    /* кэш — не источник истины, ошибки не критичны */
  }
}

export async function clearMessageCache(): Promise<void> {
  const db = await open();
  if (!db) return;
  for (const s of [STORE, POSTS_STORE]) {
    try { await done(tx(db, "readwrite", s).clear()); } catch { /* ignore */ }
  }
}

// ── Лента канала ─────────────────────────────────────────────────────────────
// Один в один с чатами: при входе рисуем из кэша, сеть догоняет приращением
// (GET /channels/<id>/posts/?since=…). Клиентские поля постов (_pending и
// прогресс публикации) в кэш не попадают.

export async function readPosts(channelId: string): Promise<CachedChat | null> {
  const db = await open();
  if (!db) return null;
  try { return ((await done(tx(db, "readonly", POSTS_STORE).get(channelId))) as CachedChat) || null; } catch { return null; }
}

const stripPost = (p: any) => {
  const { _pending, _progress, _failed, _retry, ...rest } = p;
  return rest;
};

export async function writePosts(channelId: string, posts: any[], syncedAt: string, hasMore: boolean): Promise<void> {
  const db = await open();
  if (!db) return;
  try {
    const confirmed = posts.filter((p) => !p._pending);
    const tail = confirmed.slice(-KEEP).map(stripPost);
    const rec: CachedChat = {
      chatId: channelId, messages: tail, syncedAt,
      hasMore: hasMore || confirmed.length > KEEP,
      savedAt: Date.now(),
    };
    await done(tx(db, "readwrite", POSTS_STORE).put(rec));
    const store = tx(db, "readonly", POSTS_STORE);
    const count = await done(store.count());
    if (count > MAX_CHATS) {
      const keys = (await done(store.index("savedAt").getAllKeys())) as IDBValidKey[];
      const rw = tx(db, "readwrite", POSTS_STORE);
      keys.slice(0, count - MAX_CHATS).forEach((k) => rw.delete(k));
    }
  } catch {
    /* кэш — не источник истины */
  }
}
