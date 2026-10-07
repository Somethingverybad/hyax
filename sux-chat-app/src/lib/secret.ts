/**
 * Секретные чаты: сквозное шифрование на устройстве (backend/chat/secret.py).
 *
 * Каждая сторона делает пару ECDH P-256 на своём устройстве. Закрытый ключ
 * создаётся неизвлекаемым (extractable: false) и лежит только в IndexedDB
 * этого устройства — ни в localStorage, ни на сервер он не попадает. Общий
 * ключ: ECDH → HKDF-SHA-256 (соль — id чата) → AES-256-GCM, тоже
 * неизвлекаемый. Сообщение: base64(iv[12] ‖ шифротекст+тег), внутри JSON
 * {t: текст, e: оформление}.
 *
 * Выход из аккаунта стирает все ключи (wipeSecretKeys) — как в Telegram,
 * секретные чаты после этого на устройстве не читаются.
 */

const DB = "hyax-secret";
const STORE = "keys";
const INFO = new TextEncoder().encode("whoyax-secret-v1");

export interface SecretInfo {
  state: "pending" | "active" | "declined";
  initiator_id: string;
  initiator_device: string;
  initiator_pub: string;
  responder_device: string;
  responder_pub: string;
  accepted_at: string | null;
}

interface Entry {
  chatId: string;
  priv?: CryptoKey;     // своя закрытая половина ECDH (до вычисления ключа)
  myPub: string;        // своя открытая половина, base64
  key?: CryptoKey;      // общий AES-GCM
  fp?: string;          // отпечаток для сверки
}

export const secretSupported = () =>
  typeof window !== "undefined" && !!window.crypto?.subtle && window.isSecureContext !== false && typeof indexedDB !== "undefined";

/** Устройство — случайный id на этом устройстве; по нему сервер знает, где ключ. */
export function deviceId(): string {
  const K = "hyax:device-id";
  try {
    let id = localStorage.getItem(K);
    if (!id) {
      id = (crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("")).replace(/[^A-Za-z0-9-]/g, "");
      localStorage.setItem(K, id);
    }
    return id;
  } catch {
    return "nostorage-device";
  }
}

// ---------- IndexedDB ----------

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "chatId" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
const getEntry = (chatId: string) => tx<Entry | undefined>("readonly", (s) => s.get(chatId) as IDBRequest<Entry | undefined>);
const putEntry = (e: Entry) => tx("readwrite", (s) => s.put(e));

export async function wipeSecretKeys(): Promise<void> {
  try { await tx("readwrite", (s) => s.clear()); } catch { /* нечего стирать */ }
}

// ---------- ключи ----------

const b64 = (buf: ArrayBuffer | Uint8Array) => {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Новая пара для чата: закрытая половина остаётся здесь, открытую — на сервер. */
export async function newKeyPair(): Promise<{ priv: CryptoKey; pub: string }> {
  const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const raw = await crypto.subtle.exportKey("raw", kp.publicKey);
  return { priv: kp.privateKey, pub: b64(raw) };
}

/** Запомнить свою пару, пока собеседник не принял чат. */
export async function rememberPending(chatId: string, priv: CryptoKey, myPub: string) {
  await putEntry({ chatId, priv, myPub });
}

async function derive(chatId: string, priv: CryptoKey, peerPub: string): Promise<CryptoKey> {
  const peer = await crypto.subtle.importKey("raw", unb64(peerPub), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const bits = await crypto.subtle.deriveBits({ name: "ECDH", public: peer }, priv, 256);
  const hk = await crypto.subtle.importKey("raw", bits, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode(chatId), info: INFO },
    hk, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"],
  );
}

/** Отпечаток: SHA-256 от обоих открытых ключей и id чата. Одинаковый у обеих
 *  сторон — сверить можно голосом или при встрече. */
async function fingerprint(chatId: string, a: string, b: string): Promise<string> {
  const [x, y] = [a, b].sort();
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${chatId}|${x}|${y}`)));
  return Array.from(h.slice(0, 16), (v) => v.toString(16).padStart(2, "0")).join("").toUpperCase().match(/.{4}/g)!.join(" ");
}
const EMOJI = "🍎🍊🍋🍉🍇🍓🍒🥝🥥🥑🌶🌽🥕🍄🌰🍞🧀🍕🌮🍩🍪🎂🍫🍬🍯☕🍵🥤🐶🐱🐭🐹🐰🦊🐻🐼🐨🐯🦁🐮🐷🐸🐵🐔🐧🐦🦆🦉🐺🐗🐴🦄🐝🐛🦋🐌🐞🐢🐍🐙🦀🐠🐬🐳".match(/./gu)!;
/** Тот же отпечаток картинкой из восьми эмодзи — сравнивать удобнее. */
export function fingerprintEmoji(fp: string): string {
  const bytes = fp.replace(/\s/g, "").match(/.{2}/g)!.map((h) => parseInt(h, 16));
  return bytes.slice(0, 8).map((v) => EMOJI[v % EMOJI.length]).join(" ");
}

/** Ключ этого чата на этом устройстве, если есть. Чат активен, а ключ ещё не
 *  вычислен (инициатор узнал, что собеседник принял) — вычисляем и храним. */
export async function chatKey(chatId: string, info: SecretInfo | null | undefined, myId: string): Promise<{ key: CryptoKey; fp: string } | null> {
  if (!info || !secretSupported()) return null;
  let e: Entry | undefined;
  try { e = await getEntry(chatId); } catch { return null; }
  if (!e) return null;
  if (e.key && e.fp) return { key: e.key, fp: e.fp };
  if (info.state !== "active" || !e.priv) return null;
  const mine = info.initiator_id === myId ? info.initiator_pub : info.responder_pub;
  if (mine !== e.myPub) return null; // чат принят на другом устройстве
  const peerPub = info.initiator_id === myId ? info.responder_pub : info.initiator_pub;
  const key = await derive(chatId, e.priv, peerPub);
  const fp = await fingerprint(chatId, info.initiator_pub, info.responder_pub);
  // Закрытая половина больше не нужна — храним только общий ключ.
  await putEntry({ chatId, myPub: e.myPub, key, fp });
  return { key, fp };
}

/** Есть ли у этого устройства своя половина ключа для чата (даже до принятия). */
export async function hasLocalHalf(chatId: string): Promise<boolean> {
  try { return !!(await getEntry(chatId)); } catch { return false; }
}

// ---------- сообщения ----------

export interface SecretPayload { t: string; e?: unknown[] }

export async function encryptPayload(key: CryptoKey, p: SecretPayload): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(p))));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv); out.set(ct, iv.length);
  return b64(out);
}

export async function decryptPayload(key: CryptoKey, cipher: string): Promise<SecretPayload | null> {
  try {
    const all = unb64(cipher);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: all.slice(0, 12) }, key, all.slice(12));
    const p = JSON.parse(new TextDecoder().decode(pt));
    return typeof p?.t === "string" ? p : null;
  } catch {
    return null;
  }
}
