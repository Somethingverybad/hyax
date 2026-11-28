/**
 * Мультиаккаунт: хранение списка вошедших аккаунтов, переключение между ними,
 * добавление нового и выход из отдельного аккаунта.
 *
 * Все аккаунты на устройстве лежат в localStorage под ключом `hyax:accounts`,
 * активный id (Profile.id) — в `hyax:active-account`. Токены активного аккаунта
 * всегда зеркалируются в `access_token` и `refresh_token`, чтобы весь
 * существующий код (signedIn, client.ts, App.tsx) работал без изменений.
 *
 * Персональные кэши каждого аккаунта (профиль, чаты, черновики, позиция ленты,
 * IndexedDB сообщений и ключи секретных чатов) изолированы по его id:
 * переключение не теряет ни секретные чаты, ни черновики, а выход из одного
 * аккаунта стирает только его данные и (если есть другие) переключает на
 * следующий.
 */

export interface StoredAccount {
  /** Profile.id (UUID). */
  id: string;
  username: string;
  avatar_url?: string | null;
  aura_color?: string | null;
  /** Премиум-статус аккаунта (с сервера `is_premium` или временный фолбэк). */
  is_premium?: boolean;
  accessToken: string;
  refreshToken: string;
  /** Когда последний раз пользовались — для сортировки при автопереключении. */
  lastUsedAt: number;
}

/** Есть ли Premium у конкретного профиля/аккаунта.
 *  Если сервер уже прислал `is_premium` — доверяем ему; иначе (OTA до выкладки
 *  бэкенда) временный доступ открыт только для `knopech`. */
export function hasPremiumProfile(p?: { is_premium?: boolean; username?: string | null } | null): boolean {
  if (!p) return false;
  if (typeof p.is_premium === "boolean") return p.is_premium;
  return (p.username || "").trim().toLowerCase() === "knopech";
}

export const MAX_ACCOUNTS = 5;

const ACCOUNTS_KEY = "hyax:accounts";
const ACTIVE_KEY = "hyax:active-account";
/** Владелец старой единой базы IndexedDB `hyax-secret` до появления мультиаккаунта.
 *  Его ключи секретных чатов остаются на месте без переноса (неизвлекаемые ECDH
 *  ключи не трогаем); остальные аккаунты получают свою базу `hyax-secret-<id>`. */
const LEGACY_SECRET_OWNER_KEY = "hyax:secret-legacy-owner";

export const ACCOUNTS_EVENT = "hyax:accounts";
export const ACCOUNT_CHANGED_EVENT = "hyax:account-changed";
export const ACCOUNT_SWITCHER_EVENT = "hyax:account-switcher";

/** Legacy-ключи localStorage, которые раньше были общими и переезжают в namespace аккаунта. */
const LEGACY_SESSION_KEYS = [
  "cache_user",
  "cache_chats",
  "cache_saved_chat",
  "cache_playlists",
  "cache_playlist_tracks",
  "cache_public_playlists",
  "cache_stations",
  "cache_wall",
] as const;

let cachedAccounts: StoredAccount[] | null = null;
let cachedActiveId: string | null | undefined;
/** Старая одноаккаунтная сессия, у которой при старте ещё не было cache_user:
 *  как только придёт профиль, привяжем к нему `hyax-secret` и мигрируем ключи. */
let pendingLegacyMigration = false;

function readStorage(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeStorage(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* приватный режим или квота */ }
}
function removeStorage(key: string): void {
  try { localStorage.removeItem(key); } catch { /* приватный режим */ }
}

function loadAccounts(): StoredAccount[] {
  if (cachedAccounts) return cachedAccounts;
  try {
    const raw = readStorage(ACCOUNTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    cachedAccounts = Array.isArray(parsed)
      ? parsed.filter((a): a is StoredAccount => !!a && typeof a.id === "string" && typeof a.accessToken === "string")
      : [];
  } catch {
    cachedAccounts = [];
  }
  return cachedAccounts;
}

function saveAccounts(list: StoredAccount[]): void {
  cachedAccounts = list;
  writeStorage(ACCOUNTS_KEY, JSON.stringify(list));
  try { window.dispatchEvent(new CustomEvent(ACCOUNTS_EVENT)); } catch { /* не браузер */ }
}

export function listAccounts(): StoredAccount[] {
  return [...loadAccounts()];
}

export function activeAccountId(): string | null {
  if (cachedActiveId === undefined) {
    cachedActiveId = readStorage(ACTIVE_KEY) || null;
  }
  return cachedActiveId;
}

function setActiveId(id: string | null): void {
  cachedActiveId = id;
  if (id) writeStorage(ACTIVE_KEY, id);
  else removeStorage(ACTIVE_KEY);
}

export function getActiveAccount(): StoredAccount | null {
  const id = activeAccountId();
  if (!id) return null;
  return loadAccounts().find((a) => a.id === id) || null;
}

export function legacySecretOwner(): string | null {
  return readStorage(LEGACY_SECRET_OWNER_KEY) || null;
}

export function clearLegacySecretOwnerIfMatches(accountId: string): void {
  if (legacySecretOwner() === accountId) removeStorage(LEGACY_SECRET_OWNER_KEY);
}

/** Ключ localStorage в пространстве указанного (или активного) аккаунта. */
export function accountKey(name: string, accountId?: string | null): string {
  const uid = accountId === undefined ? activeAccountId() : accountId;
  return uid ? `hyax:acct:${uid}:${name}` : name;
}

/** Перенести старые неразделённые ключи в пространство первого аккаунта. */
function migrateLegacyKeysToAccount(uid: string): void {
  if (!readStorage(LEGACY_SECRET_OWNER_KEY)) {
    writeStorage(LEGACY_SECRET_OWNER_KEY, uid);
  }
  for (const k of LEGACY_SESSION_KEYS) {
    const v = readStorage(k);
    if (v !== null) {
      const dst = accountKey(k, uid);
      if (readStorage(dst) === null) writeStorage(dst, v);
      removeStorage(k);
    }
  }
  const simpleMap: Array<[string, string]> = [
    ["hyax:drafts", "drafts"],
    ["chat_participants_cache", "participants"],
    ["hyax:email-prompt-shown", "email-prompt-shown"],
  ];
  for (const [oldK, name] of simpleMap) {
    const v = readStorage(oldK);
    if (v !== null) {
      const dst = accountKey(name, uid);
      if (readStorage(dst) === null) writeStorage(dst, v);
      removeStorage(oldK);
    }
  }
  // Позиции лент `hyax:feedpos:<id>` → `hyax:acct:<uid>:feedpos:<id>`
  try {
    const toMove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("hyax:feedpos:")) toMove.push(k);
    }
    for (const k of toMove) {
      const v = readStorage(k);
      if (v !== null) {
        const dst = accountKey(`feedpos:${k.slice("hyax:feedpos:".length)}`, uid);
        if (readStorage(dst) === null) writeStorage(dst, v);
      }
      removeStorage(k);
    }
  } catch { /* приватный режим */ }
}

/** Вызывается при старте приложения (main.tsx): подхватывает существующую
 *  одноаккаунтную сессию и гарантирует согласованность active-account / токенов. */
export function initAccounts(): void {
  const list = loadAccounts();
  const active = activeAccountId();
  const access = readStorage("access_token");
  const refresh = readStorage("refresh_token");

  if (list.length === 0) {
    if (access && refresh) {
      let legacyUser: { id?: string; username?: string; avatar_url?: string | null; aura_color?: string | null; is_premium?: boolean } | null = null;
      try { legacyUser = JSON.parse(readStorage("cache_user") || "null"); } catch { legacyUser = null; }
      if (legacyUser?.id) {
        migrateLegacyKeysToAccount(legacyUser.id);
        setActiveId(legacyUser.id);
        saveAccounts([{
          id: legacyUser.id,
          username: legacyUser.username || "",
          avatar_url: legacyUser.avatar_url ?? null,
          aura_color: legacyUser.aura_color ?? null,
          ...(typeof legacyUser.is_premium === "boolean" ? { is_premium: legacyUser.is_premium } : {}),
          accessToken: access,
          refreshToken: refresh,
          lastUsedAt: Date.now(),
        }]);
      } else {
        // Кэш профиля чистили, но токены живые — завершим миграцию при первом getProfile.
        pendingLegacyMigration = true;
      }
    }
    return;
  }

  // Список есть: убедимся, что активный id валиден, а токены в localStorage синхронизированы.
  let cur = list.find((a) => a.id === active);
  if (!cur) {
    cur = [...list].sort((a, b) => b.lastUsedAt - a.lastUsedAt)[0];
    if (cur) setActiveId(cur.id);
  }
  if (cur) {
    if (access && access !== cur.accessToken) cur.accessToken = access;
    if (refresh && refresh !== cur.refreshToken) cur.refreshToken = refresh;
    if (!access && cur.accessToken) writeStorage("access_token", cur.accessToken);
    if (!refresh && cur.refreshToken) writeStorage("refresh_token", cur.refreshToken);
  }
}

/** Обновить токены активного аккаунта (после refresh или revokeOtherDevices). */
export function syncActiveTokens(access: string, refresh?: string): void {
  writeStorage("access_token", access);
  if (refresh) writeStorage("refresh_token", refresh);
  const id = activeAccountId();
  if (!id) return;
  const list = loadAccounts();
  const idx = list.findIndex((a) => a.id === id);
  if (idx < 0) return;
  const cur = list[idx];
  if (cur.accessToken === access && (!refresh || cur.refreshToken === refresh)) return;
  const next = list.slice();
  next[idx] = { ...cur, accessToken: access, refreshToken: refresh || cur.refreshToken };
  saveAccounts(next);
}

/** Обновить отображаемые данные активного аккаунта (ник, аватар, аура) при загрузке
 *  или редактировании профиля. Если это был вход без сохранённой записи (миграция
 *  или прямой login) — заводим запись в списке. */
export function syncAccountProfile(profile: {
  id?: string;
  username?: string;
  avatar_url?: string | null;
  aura_color?: string | null;
  is_premium?: boolean;
} | null | undefined): void {
  if (!profile?.id) return;
  const list = loadAccounts();
  const existingIdx = list.findIndex((a) => a.id === profile.id);
  const access = readStorage("access_token") || "";
  const refresh = readStorage("refresh_token") || "";

  if (pendingLegacyMigration && existingIdx < 0) {
    pendingLegacyMigration = false;
    migrateLegacyKeysToAccount(profile.id);
  }

  if (existingIdx >= 0) {
    const cur = list[existingIdx];
    const username = profile.username || cur.username;
    const avatar_url = profile.avatar_url !== undefined ? profile.avatar_url : cur.avatar_url;
    const aura_color = profile.aura_color !== undefined ? profile.aura_color : cur.aura_color;
    const is_premium = typeof profile.is_premium === "boolean" ? profile.is_premium : cur.is_premium;
    const changed = cur.username !== username || cur.avatar_url !== avatar_url || cur.aura_color !== aura_color
      || cur.is_premium !== is_premium
      || (activeAccountId() === cur.id && access && cur.accessToken !== access);
    if (changed) {
      const next = list.slice();
      next[existingIdx] = {
        ...cur,
        username,
        avatar_url,
        aura_color,
        ...(typeof is_premium === "boolean" ? { is_premium } : {}),
        accessToken: activeAccountId() === cur.id && access ? access : cur.accessToken,
        refreshToken: activeAccountId() === cur.id && refresh ? refresh : cur.refreshToken,
      };
      saveAccounts(next);
    }
    if (!activeAccountId()) setActiveId(profile.id);
    return;
  }

  // Новый аккаунт появился через прямой login (без upsertAccount) — регистрируем.
  if (access && refresh) {
    if (!activeAccountId()) {
      migrateLegacyKeysToAccount(profile.id);
    }
    setActiveId(profile.id);
    saveAccounts([
      ...list,
      {
        id: profile.id,
        username: profile.username || "",
        avatar_url: profile.avatar_url ?? null,
        aura_color: profile.aura_color ?? null,
        ...(typeof profile.is_premium === "boolean" ? { is_premium: profile.is_premium } : {}),
        accessToken: access,
        refreshToken: refresh,
        lastUsedAt: Date.now(),
      },
    ]);
  }
}

/** Удалить все ключи localStorage конкретного аккаунта. */
export function clearAccountLocalStorage(accountId: string): void {
  const prefix = `hyax:acct:${accountId}:`;
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch { /* приватный режим */ }
}

/** Сбросить всё in-memory состояние приложения перед переключением аккаунта. */
export async function resetInMemoryState(): Promise<void> {
  const mods = await Promise.allSettled([
    import("@/lib/userSocket").then((m) => m.stopUserSocket()),
    import("@/lib/player").then((m) => m.stop()),
    import("@/api/client").then((m) => m.resetApiMemoryCache()),
    import("@/lib/blocks").then((m) => m.resetBlocks()),
    import("@/lib/chatActivity").then((m) => m.resetChatActivity()),
    import("@/lib/pets").then((m) => m.resetPets()),
    import("@/lib/reactions").then((m) => m.resetQuickReactionCache()),
    import("@/lib/outbox").then((m) => m.resetOutbox()),
    import("@/lib/feedPosition").then((m) => m.clearFeedPosMem()),
    import("@/lib/stickerIndex").then((m) => { m.invalidateStickerIndex(); m.invalidateCustomEmojiIndex(); }),
    import("@/components/chat/StickerPicker").then((m) => m.resetStickerPickerCache()),
  ]);
  void mods;
}

/** Применить настройки профиля целевого аккаунта (тема, язык, аура/реакции) из его кэша. */
async function applyCachedAccountPrefs(): Promise<void> {
  try {
    const [{ readCache }, { syncThemeFromProfile }, { applyProfileLang }, { applyServerSettings }] = await Promise.all([
      import("@/lib/session-cache"),
      import("@/lib/theme"),
      import("@/lib/i18n"),
      import("@/lib/settings"),
    ]);
    const u = readCache<any>("user");
    if (u) {
      applyServerSettings(u);
      applyProfileLang(u);
      void syncThemeFromProfile(u.active_theme);
    }
  } catch { /* не критично — подтянется из сети */ }
}

/**
 * Активировать аккаунт после успешного входа/регистрации.
 * Не трогает данные других уже сохранённых аккаунтов.
 */
export async function activateSignedInAccount(
  profile: { id: string; username: string; avatar_url?: string | null; aura_color?: string | null; [k: string]: any },
  tokens: { access: string; refresh: string },
): Promise<{ alreadyExisted: boolean }> {
  const list = loadAccounts();
  const prevActive = activeAccountId();
  const existingIdx = list.findIndex((a) => a.id === profile.id);
  const alreadyExisted = existingIdx >= 0;

  if (prevActive && prevActive !== profile.id) {
    await resetInMemoryState();
  }

  const entry: StoredAccount = {
    id: profile.id,
    username: profile.username,
    avatar_url: profile.avatar_url ?? null,
    aura_color: profile.aura_color ?? null,
    ...(typeof profile.is_premium === "boolean" ? { is_premium: profile.is_premium } : {}),
    accessToken: tokens.access,
    refreshToken: tokens.refresh,
    lastUsedAt: Date.now(),
  };

  const next = alreadyExisted
    ? list.map((a, i) => (i === existingIdx ? entry : a))
    : [...list, entry];

  setActiveId(profile.id);
  writeStorage("access_token", tokens.access);
  writeStorage("refresh_token", tokens.refresh);
  saveAccounts(next);

  // Пишем свежий профиль сразу в namespace этого аккаунта.
  try {
    const { writeCache } = await import("@/lib/session-cache");
    writeCache("user", profile);
  } catch { /* ок */ }
  await applyCachedAccountPrefs();

  if (prevActive && prevActive !== profile.id) {
    try {
      window.dispatchEvent(new CustomEvent(ACCOUNT_CHANGED_EVENT, { detail: { accountId: profile.id, to: "/chat" } }));
    } catch { /* не браузер */ }
  }
  return { alreadyExisted };
}

/** Переключиться на уже добавленный аккаунт. Возвращает выбранный аккаунт или null. */
export async function switchAccount(accountId: string, opts?: { to?: string }): Promise<StoredAccount | null> {
  const list = loadAccounts();
  const target = list.find((a) => a.id === accountId);
  if (!target) return null;
  if (activeAccountId() === accountId) return target;

  await resetInMemoryState();

  setActiveId(target.id);
  writeStorage("access_token", target.accessToken);
  writeStorage("refresh_token", target.refreshToken);

  const now = Date.now();
  const next = list.map((a) => (a.id === target.id ? { ...a, lastUsedAt: now } : a));
  saveAccounts(next);

  await applyCachedAccountPrefs();

  try {
    window.dispatchEvent(new CustomEvent(ACCOUNT_CHANGED_EVENT, { detail: { accountId: target.id, to: opts?.to || "/chat" } }));
  } catch { /* не браузер */ }

  return target;
}

/**
 * Выйти из конкретного аккаунта (по умолчанию — из активного).
 * Стирает только его кэш, сообщения и ключи секретных чатов.
 * Если вышли из активного и остались другие — автоматически переключает на последний использованный.
 */
export async function logoutAccount(
  accountId?: string | null,
  opts?: { revokeRemote?: boolean; to?: string },
): Promise<{ removedUsername?: string; switchedTo: StoredAccount | null }> {
  const targetId = accountId ?? activeAccountId();
  const list = loadAccounts();
  const target = targetId ? list.find((a) => a.id === targetId) || null : null;
  const isActive = !targetId || targetId === activeAccountId();
  const revokeRemote = opts?.revokeRemote !== false;

  // Сначала отзываем сеанс устройства на сервере (по токену именно этого аккаунта).
  if (revokeRemote) {
    try {
      const token = target?.accessToken || (isActive ? readStorage("access_token") : null);
      if (token) {
        const { api } = await import("@/api/client");
        await api.revokeCurrentDeviceWithToken(token);
      }
    } catch { /* офлайн или токен уже отозван — не мешаем выходу */ }
  }

  // Стираем локальные данные только этого аккаунта.
  const [{ clearMessageCache }, { wipeSecretKeys }] = await Promise.all([
    import("@/lib/messageCache"),
    import("@/lib/secret"),
  ]);

  if (targetId) {
    clearAccountLocalStorage(targetId);
    await Promise.allSettled([clearMessageCache(targetId), wipeSecretKeys(targetId)]);
    clearLegacySecretOwnerIfMatches(targetId);
  } else {
    // На всякий случай: старая немигрированная сессия без id.
    const { clearSessionCache } = await import("@/lib/session-cache");
    clearSessionCache();
    await Promise.allSettled([clearMessageCache(), wipeSecretKeys()]);
  }

  const remaining = targetId ? list.filter((a) => a.id !== targetId) : [];
  saveAccounts(remaining);

  if (!isActive) {
    return { removedUsername: target?.username, switchedTo: null };
  }

  await resetInMemoryState();

  if (remaining.length > 0) {
    const nextAcc = [...remaining].sort((a, b) => b.lastUsedAt - a.lastUsedAt)[0];
    setActiveId(nextAcc.id);
    writeStorage("access_token", nextAcc.accessToken);
    writeStorage("refresh_token", nextAcc.refreshToken);
    const updated = remaining.map((a) => (a.id === nextAcc.id ? { ...a, lastUsedAt: Date.now() } : a));
    saveAccounts(updated);
    await applyCachedAccountPrefs();
    try {
      window.dispatchEvent(new CustomEvent(ACCOUNT_CHANGED_EVENT, { detail: { accountId: nextAcc.id, to: opts?.to || "/chat" } }));
    } catch { /* не браузер */ }
    return { removedUsername: target?.username, switchedTo: nextAcc };
  }

  // Аккаунтов больше нет — полный выход на /auth.
  setActiveId(null);
  removeStorage("access_token");
  removeStorage("refresh_token");
  pendingLegacyMigration = false;
  try { window.dispatchEvent(new Event("hyax:session-cleared")); } catch { /* не браузер */ }
  return { removedUsername: target?.username, switchedTo: null };
}

/** Есть ли Premium среди вошедших на устройстве аккаунтов (или у кэшированного активного профиля).
 *  Проверяем все сохранённые аккаунты, чтобы после переключения с Premium-аккаунта на
 *  обычный второй аккаунт переключатель не пропадал и можно было вернуться обратно. */
export function hasPremiumAccess(): boolean {
  const list = loadAccounts();
  if (list.some((a) => hasPremiumProfile(a))) return true;
  try {
    const raw = readStorage(accountKey("cache_user"));
    if (raw && hasPremiumProfile(JSON.parse(raw))) return true;
  } catch { /* ignore */ }
  return false;
}

/** Доступен ли переключатель аккаунтов (есть Premium или уже вошли в 2+ аккаунта). */
export function canUseMultiAccount(): boolean {
  return hasPremiumAccess() || loadAccounts().length > 1;
}

/** Можно ли добавить ещё один аккаунт (только с Premium и в пределах лимита). */
export function canAddAccount(): boolean {
  return hasPremiumAccess() && loadAccounts().length < MAX_ACCOUNTS;
}

/** Открыть глобальный переключатель аккаунтов (AccountSwitcherSheet в App.tsx). */
export function openAccountSwitcher(): void {
  try { window.dispatchEvent(new CustomEvent(ACCOUNT_SWITCHER_EVENT)); } catch { /* не браузер */ }
}

/** React-хук для подписки на список аккаунтов, активный id и доступ к мультиаккаунту. */
import { useEffect, useState } from "react";
export function useAccounts(): {
  accounts: StoredAccount[];
  activeId: string | null;
  active: StoredAccount | null;
  hasPremium: boolean;
  canUseMulti: boolean;
  canAdd: boolean;
} {
  const [snap, setSnap] = useState(() => ({ accounts: listAccounts(), activeId: activeAccountId(), hasPremium: hasPremiumAccess() }));
  useEffect(() => {
    const sync = () => setSnap({ accounts: listAccounts(), activeId: activeAccountId(), hasPremium: hasPremiumAccess() });
    window.addEventListener(ACCOUNTS_EVENT, sync);
    window.addEventListener(ACCOUNT_CHANGED_EVENT, sync);
    window.addEventListener("hyax:sections", sync);
    return () => {
      window.removeEventListener(ACCOUNTS_EVENT, sync);
      window.removeEventListener(ACCOUNT_CHANGED_EVENT, sync);
      window.removeEventListener("hyax:sections", sync);
    };
  }, []);
  const active = snap.accounts.find((a) => a.id === snap.activeId) || null;
  const canUseMulti = snap.hasPremium || snap.accounts.length > 1;
  const canAdd = snap.hasPremium && snap.accounts.length < MAX_ACCOUNTS;
  return { accounts: snap.accounts, activeId: snap.activeId, active, hasPremium: snap.hasPremium, canUseMulti, canAdd };
}
