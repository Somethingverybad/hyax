import { applog, safePath } from "@/lib/applog";
import { keepScreenAwake } from "@/lib/screenAwake";
import { t as tr } from "@/lib/i18n";

/** Ошибка API на языке интерфейса: и свои подписи, и русские тексты сервера
 *  переводятся по словарю (ключ — русская строка), остальное как есть. */
class LError extends Error {
  constructor(message?: string) { super(message ? tr(String(message)) : message); }
}
// Сервер и его CDN-прокси. HTTP (API, медиа, загрузки) идёт через CDN,
// чтобы клиенты не стучались на сервер напрямую; WebSocket CDN не проксирует,
// он всегда идёт на сервер. Если CDN не отвечает (не настроен, лежит,
// заблокирован) — откатываемся по цепочке FALLBACK_CHAIN: и при старте
// (проба /health), и по сетевой ошибке любого запроса.
const DIRECT_ORIGIN = "https://huyax.e-tree.su";
const CDN_ORIGIN = "https://cdn.huyax.e-tree.su";
// Запасные адреса. DNS e-tree.su держит Beget: 2026-11-02 у Beget лёг DNS
// целиком, оба адреса выше перестали разрешаться, и приложение было мёртвым
// при живых сервере и CDN. У hyax.ru DNS в Selectel; cdn.hyax.ru — второе имя
// того же CDN-ресурса, технический домен — его имя у самого Selectel (не
// зависит ни от какого регистратора). CDN ходит к серверу по IP с
// Host: huyax.e-tree.su — сервер разницы не видит.
const CDN_RESERVE_ORIGIN = "https://cdn.hyax.ru";
const RESERVE_ORIGIN = "https://43fb9b03-c74c-45ab-b258-7872345451b3.selcdn.net";
const DIRECT_RESERVE_ORIGIN = "https://hyax.ru";
/** Адреса через CDN — у них общие ограничения (403, размер тела, таймаут шлюза). */
const CDN_ORIGINS = [CDN_ORIGIN, CDN_RESERVE_ORIGIN, RESERVE_ORIGIN];
/** Порядок отката: CDN под тремя именами → сервер напрямую под двумя. */
const FALLBACK_CHAIN = [...CDN_ORIGINS, DIRECT_ORIGIN, DIRECT_RESERVE_ORIGIN];
const ENV_ORIGIN = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/api\/?$/, "");

/** Какой из адресов цепочки у этого URL (null — чужой адрес). */
const originOf = (url: string) => FALLBACK_CHAIN.find((o) => url.startsWith(o)) ?? null;
/** Следующий адрес после подведшего; null — откатываться некуда. */
function nextOrigin(origin: string): string | null {
  const i = FALLBACK_CHAIN.indexOf(origin);
  return i >= 0 && i < FALLBACK_CHAIN.length - 1 ? FALLBACK_CHAIN[i + 1] : null;
}
/** Тот же URL на другом адресе цепочки. */
const retarget = (url: string, from: string, to: string) => to + url.slice(from.length);

let apiOrigin = ENV_ORIGIN || CDN_ORIGIN;
let API_URL = `${apiOrigin}/api`;

export const getApiOrigin = () => apiOrigin;

/**
 * Отправка файлов идёт туда же, куда и всё остальное (через CDN): он нужен,
 * чтобы обходить блокировки. Но приём больших файлов CDN обрывает по таймауту
 * шлюза примерно через минуту — видео на 53 МБ так и не уходило. Поэтому всё
 * крупнее CHUNK_MIN режем на куски: каждый запрос короткий и укладывается в
 * лимит, неудачный кусок повторяется сам, прогресс идёт ровно.
 */
const uploadBase = () => API_URL;
/** Куда слать загрузку мимо WebView (фоновая на телефоне, lib/trackUploads):
 *  текущий адрес, а если это CDN — ещё и прямой, на случай, когда CDN оборвёт
 *  или не примет большой файл. */
export function uploadTargets(path: string): string[] {
  const first = `${uploadBase()}${path}`;
  const from = originOf(first);
  if (!from) return [first];
  return FALLBACK_CHAIN.slice(FALLBACK_CHAIN.indexOf(from)).map((o) => retarget(first, from, o));
}
/** С какого размера рубим на куски и по сколько. */
const CHUNK_MIN = 6 * 1024 * 1024;
const CHUNK_SIZE = 4 * 1024 * 1024;
export const isCdnActive = () => CDN_ORIGINS.includes(apiOrigin);

/** Подвёл адрес from — дальше работаем через следующий в цепочке. Назад не
 *  переключаемся: если текущий адрес уже дальше по цепочке, ничего не делаем. */
function switchFrom(from: string, reason: string, to = nextOrigin(from)) {
  if (ENV_ORIGIN || !to || apiOrigin !== from) return;
  console.warn(`[api] ${from} недоступен (${reason}), переключаюсь на ${to}`);
  apiOrigin = to;
  API_URL = `${to}/api`;
}

/** Быстрая проба при старте: 3 секунды на ответ /health от CDN, иначе так же
 *  пробуем его запасные имена, иначе — напрямую (там уже без пробы: прямой
 *  адрес откатится на запасной по ошибке первого запроса). */
if (!ENV_ORIGIN && typeof window !== "undefined") {
  // Без AbortSignal.timeout (старые WebView, lib/polyfills.ts) — проба без
  // ограничения по времени, но не ошибка при загрузке модуля: она роняла всё приложение.
  const probe = (origin: string): Promise<unknown> => {
    const signal = typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(3000) : undefined;
    return fetch(`${origin}/health`, { cache: "no-store", signal })
      .then((r) => { if (!r.ok) throw new Error(`health ${r.status}`); })
      .catch((e) => {
        const next = nextOrigin(origin);
        switchFrom(origin, e?.message || e?.name || "network");
        if (next && CDN_ORIGINS.includes(next)) return probe(next);
      });
  };
  void probe(CDN_ORIGIN);
}

/** fetch с откатом: сетевая ошибка на CDN-адресе → повтор того же запроса напрямую. */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Антикэш для чтения через CDN. 2026-10-06 CDN начал отдавать GET /api/chats/,
 * /api/profiles/current/ и /api/messages/unread_count/ из своего кэша, не
 * глядя на Cache-Control: no-store от сервера. У этих запросов постоянный URL
 * и один и тот же токен, поэтому ключ кэша не менялся часами: список чатов
 * показывал старые превью, тема откатывалась на сохранённую в кэше, а
 * открытая переписка жила — у sync каждый раз новый since в URL. Уникальный
 * параметр делает каждый GET промахом кэша на любом CDN, который учитывает
 * строку запроса (этот учитывает: запросы с параметрами доходили до сервера).
 */
function bustCache(url: string, method: string): string {
  if (method !== "GET" && method !== "HEAD") return url;
  if (!url.includes("/api/")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}_=${Date.now().toString(36)}`;
}

/** Одинаковые GET к API в полёте — один запрос на всех: при старте профиль,
 *  список чатов и Стену просили по два-три раза с разных экранов, и на
 *  сервере с одним процессом это удваивало время первого кадра
 *  (PERF_PLAN.md, п. 2). Ключ — адрес и заголовки (If-None-Match различается);
 *  каждому ждущему — своя копия ответа, тело читается один раз. */
const inflightGets = new Map<string, Promise<Response>>();
async function fetchWithFallback(input: RequestInfo, init?: RequestInit): Promise<Response> {
  const rawUrl = typeof input === "string" ? input : (input as Request).url;
  const method = (init?.method || "GET").toUpperCase();
  if (method !== "GET" || !rawUrl.includes("/api/")) return fetchWithFallbackRaw(input, init);
  let key = rawUrl;
  try { key += "|" + JSON.stringify(init?.headers || {}); } catch { /* ключ без заголовков */ }
  let p = inflightGets.get(key);
  if (!p) {
    // Готовый ответ живёт ещё полторы секунды: экраны монтируются друг за
    // другом и просят то же самое не одновременно, а с разницей в сотни мс.
    p = fetchWithFallbackRaw(input, init);
    inflightGets.set(key, p);
    p.then(() => { window.setTimeout(() => { if (inflightGets.get(key) === p) inflightGets.delete(key); }, 1500); },
      () => { inflightGets.delete(key); });
  }
  return (await p).clone();
}

async function fetchWithFallbackRaw(input: RequestInfo, init?: RequestInit): Promise<Response> {
  const rawUrl = typeof input === "string" ? input : (input as Request).url;
  const url = bustCache(rawUrl, (init?.method || "GET").toUpperCase());
  if (url !== rawUrl) { input = url; init = { ...init, cache: "no-store" }; }
  // В лог баг-репорта: метод, путь без query, код и длительность. Ни тел, ни
  // заголовков — там токены и переписка (см. lib/applog.ts).
  const method = (init?.method || "GET").toUpperCase();
  const t0 = performance.now();
  const done = (res: Response | null, err?: unknown) => {
    const ms = Math.round(performance.now() - t0);
    const path = safePath(url);
    if (res) (res.ok ? applog.info : applog.warn)(`http ${method} ${path} → ${res.status} ${ms}ms`);
    else applog.error(`http ${method} ${path} ✗ ${err instanceof Error ? err.name : "network"} ${ms}ms`);
  };
  // Сеть до CDN и обратно подводит: часть запросов не проходит с первого раза.
  // Молча повторяем — для человека это просто чуть дольше загрузка, а не
  // сообщение об ошибке. Повторяем только чтение (GET/HEAD): повтор отправки
  // мог бы продублировать сообщение, если сервер успел его принять.
  const idempotent = method === "GET" || method === "HEAD";
  const RETRY_DELAYS = [250, 700, 1500];
  const retriable = (status: number) => status === 502 || status === 503 || status === 504 || status === 429;
  let attempt = 0;

  for (;;) {
  try {
    const res = await fetch(input, init);
    // CDN иногда отвечает 403 на обычный запрос к API: до сервера он при этом
    // не доходит (в логах Django и nginx таких отказов нет), а в приложении
    // это выглядело как «Пак не найден». Свои запреты сервер шлёт кодами 401 и
    // 404, поэтому 403 с CDN считаем отказом самого CDN: уходим напрямую и
    // повторяем. Запросы обложек и загрузок это тоже чинит. Запасной домен —
    // тот же CDN-ресурс, поэтому с 403 и с него уходим сразу на сервер.
    const cdnFrom = originOf(url);
    if (res.status === 403 && cdnFrom && CDN_ORIGINS.includes(cdnFrom)) {
      switchFrom(cdnFrom, "403 от CDN", DIRECT_ORIGIN);
      const retry = await fetch(retarget(url, cdnFrom, DIRECT_ORIGIN), init);
      done(retry);
      return retry;
    }
    if (idempotent && retriable(res.status) && attempt < RETRY_DELAYS.length) {
      applog.warn(`http ${method} ${safePath(url)} → ${res.status}, повтор ${attempt + 1}`);
      await sleep(RETRY_DELAYS[attempt++]);
      continue;
    }
    done(res);
    return res;
  } catch (e) {
    // Запрос мог быть собран со старым адресом до того, как проба переключила
    // origin — идём по цепочке дальше в любом случае, если URL был не последним.
    let from = originOf(url);
    let next = from ? nextOrigin(from) : null;
    if (!from || !next) {
      if (idempotent && attempt < RETRY_DELAYS.length) {
        applog.warn(`http ${method} ${safePath(url)} ✗ сеть, повтор ${attempt + 1}`);
        await sleep(RETRY_DELAYS[attempt++]);
        continue;
      }
      done(null, e); throw e;
    }
    let lastErr: unknown = e;
    // Адрес запроса — на исходном звене (base); раньше на третьем шаге его
    // пересчитывали от промежуточного, и запрос уходил по испорченному адресу,
    // не доходя до сервера (2026-11-04: CDN без CORS → мёртвый запасной домен →
    // сервер напрямую так и не спрашивали, вход срабатывал со второй попытки).
    const base = from;
    while (from && next) {
      switchFrom(from, (lastErr as Error)?.name || "network");
      try {
        const res = await fetch(retarget(url, base, next), init);
        done(res);
        return res;
      } catch (e2) {
        lastErr = e2;
        from = next;
        next = nextOrigin(next);
      }
    }
    if (idempotent && attempt < RETRY_DELAYS.length) {
      applog.warn(`http ${method} ${safePath(url)} ✗ сеть на всех адресах, повтор ${attempt + 1}`);
      await sleep(RETRY_DELAYS[attempt++]);
      continue;
    }
    done(null, lastErr);
    throw lastErr;
  }
  }
}

// WebSocket для сигналинга звонков и уведомлений — всегда напрямую на сервер:
// основной адрес и запасной (services/websocket переключается сам).
const wsOf = (origin: string) => `${origin.replace(/^http/, "ws")}/ws`;
export const WS_URLS = ENV_ORIGIN ? [wsOf(ENV_ORIGIN)] : [wsOf(DIRECT_ORIGIN), wsOf(DIRECT_RESERVE_ORIGIN)];
export const WS_URL = WS_URLS[0];

// Сервер отдаёт пути к медиа относительными (/media/...). В вебе они
// резолвятся от домена сайта, а в приложении WebView живёт на
// capacitor://localhost — и картинка искалась бы внутри бандла. Достраиваем
// до абсолютного URL от текущего хоста API (CDN или прямой).
export function mediaUrl(path?: string | null): string {
  if (!path) return "";
  if (/^(https?:|blob:|data:)/.test(path)) return path;
  return `${apiOrigin}${path.startsWith("/") ? "" : "/"}${path}`;
}

interface AuthResponse {
  message: string;
  error?: string;
  user_id?: string;
}

/** Сводка мониторинга (GET /api/admin/metrics/, только админам). */
export interface AdminMetrics {
  now: string;
  range: "24h" | "7d" | "30d";
  step_s: number;
  live: {
    online: number; connected: number; sockets: number;
    cpu: number | null; load: number[] | null; cores: number | null;
    mem_used: number | null; mem_total: number | null;
    disk_used: number | null; disk_total: number | null;
    rss: number | null; db_size: number | null; uptime_s: number;
    sampling_since: string | null;
    users_online: {
      id: string; username: string; avatar_url: string | null; hidden: boolean; role: string;
      active: boolean; devices: number; online_s: number | null;
    }[];
  };
  totals: {
    users: number; users_24h: number; users_7d: number;
    seen_24h: number; seen_7d: number; seen_30d: number; bots: number;
    messages: number; messages_24h: number;
    chats_direct: number; chats_group: number; channels: number; calls_24h: number;
    peak_24h: number | null; peak_24h_at: string | null; peak_all: number | null; peak_all_at: string | null;
  };
  timeline: { t: number; online_avg: number | null; online_max: number | null; cpu: number | null; mem: number | null; messages: number }[];
  daily: { t: number; registrations: number; writers: number; messages: number; peak_online: number | null }[];
  hours: { hour: number; messages: number }[];
  /** Рейтинг вайбометра: люди с баллами, сверху больше (до 100). */
  vibe_top?: { id: string; username: string; avatar_url: string | null; vibe: number; role: string }[];
}

export interface ChatTranslate { translate_in: boolean; translate_out: boolean; explicit_in?: boolean; explicit_out?: boolean; my_language: string; peer_language: string | null; available: boolean; is_group?: boolean; peer_languages?: string[] }

export interface DeviceSession {
  device_id: string; name: string; platform: string; app_version: string;
  created_at: string; last_seen: string; current: boolean;
}

export interface Profile {
  id: string;
  username: string;
  avatar_url?: string;
  bio?: string | null;
  /** Обложка профиля — баннер за аватаром. Пусто — однотонная подложка. */
  cover_url?: string | null;
  status?: string;
  created_at?: string;
  user?: any;
  /** Показывать текст сообщения в уведомлениях. */
  push_preview?: boolean;
  /** Входящие без звука: играет только звук, отправленный специально. */
  notify_silent?: boolean;
  /** Пуш, когда собеседник написал на Стене. Только в своём профиле. */
  notify_wall?: boolean;
  /** Напоминания питомца (chat/pets.py): сутки без ухода — пуш. */
  notify_pet?: boolean;
  /** «Мой звук»: с ним приходят пуши о моих сообщениях у собеседников. */
  notify_sound?: NotificationSoundInfo | null;
  /** Звук входящего звонка (lib/ringtone.ts). Только в своём профиле. */
  ringtone?: string;
  /** Принимать Р.Ё.В — вибрацию, которую шлёт собеседник. */
  rov_enabled?: boolean;
  /** Показывать паки 18+. Приходит только в своём профиле. */
  allow_adult?: boolean;
  /** «Стена» в списке чатов (выключается «удалением» строки, включается в настройках). */
  wall_enabled?: boolean;
  /** «Долгий ящик» в списке чатов (скрыть / вернуть в «Внешний вид»). */
  ideabox_enabled?: boolean;
  /** Нижнее меню по порядку (lib/navTabs); null — как в теме по умолчанию. */
  nav_tabs?: string[] | null;
  /** Бот: таким сохранёнки не открывают и в личку не пишут вручную. */
  is_bot?: boolean;
  /** Мини-приложение бота (chat/webapp.py): адрес и подпись кнопки. */
  webapp_url?: string;
  webapp_title?: string;
  /** Бот только для чтения (Обновлямбус): писать ему нельзя. */
  readonly_bot?: boolean;
  /** «В сети» — живой статус; у тех, кто выбрал «Скрыт», всегда false. */
  is_online?: boolean;
  /** Статус «Скрыт»: собеседники видят «не в сети». Только в своём профиле. */
  hide_online?: boolean;
  /** Когда был на связи; null — показывать нельзя (скрыт или выключено). */
  last_seen?: string | null;
  /** Показывать время последнего входа. Только в своём профиле. */
  show_last_seen?: boolean;
  /** «Подтверждать новые чаты»: новый собеседник сначала присылает запрос. */
  confirm_chats?: boolean;
  /** «Не показывать меня в поиске»: по нику находят только собеседники. */
  hide_from_search?: boolean;
  /** Кто видит сохранёнки: all | selected | none. Только в своём профиле. */
  saved_visibility?: "all" | "selected" | "none";
  /** Видны ли смотрящему сохранёнки этого человека. */
  saved_visible?: boolean;
  /** Выбранная тема: dark | light | neo либо uuid темы с сервера. */
  active_theme?: string;
  /** Когда приняты правила. null — ещё не приняты (экран согласия);
   *  undefined — сервер поля не знает или это чужой профиль. */
  terms_accepted_at?: string | null;
  /** Анимация ауры — настройка аккаунта, зеркалится в локальную aura_anim. */
  aura_anim?: boolean;
  /** Быстрая реакция (двойной тап) — настройка аккаунта, см. lib/reactions. */
  quick_reaction?: { key: string; emoji?: string; custom?: { url: string; repaint?: boolean } } | null;
  /** Язык интерфейса и переводов: ru | en | ko. */
  language?: string;
  /** Автоперевод по умолчанию для всех личек (в чате можно переопределить). */
  translate_in_default?: boolean;
  translate_out_default?: boolean;
  /** Почта для восстановления пароля (только свой профиль); verified — подтверждена кодом. */
  email?: string;
  email_verified?: boolean;
  /** «Больше не показывать» у предложения привязать почту (lib/emailPrompt). */
  email_prompt_off?: boolean;
  /** Когда менялись ник, аватар или аура — по нему устройства понимают, что кеш устарел. */
  identity_updated_at?: string;
  /** Только в своём профиле: видит админские разделы (мониторинг). */
  is_admin?: boolean;
}

/** Пак звуков — карточка по ссылке /sp/<id> и список добавленных. */
export interface SoundPackInfo {
  id: string;
  name: string;
  order: number;
  sounds: NotificationSoundInfo[];
  is_public: boolean;
  /** Стандартный (галочка в админке) — есть у всех без подписки. */
  is_default: boolean;
  /** Обложка пака; null — клиент рисует свою по теме (lib/packCover). */
  cover_url?: string | null;
  creator: string | null;
  /** Уже добавлен текущим пользователем. */
  added: boolean;
  /** Создан текущим пользователем. */
  mine: boolean;
  /** Пак 18+. */
  is_adult?: boolean;
  /** 18+ и настройка выключена: звуки не приходят, добавить нельзя. */
  adult_locked?: boolean;
  sounds_count?: number;
}

/** Стикерпак — карточка по ссылке /stp/<id>. author — сериализованный профиль. */
/** Событие вайбометра (chat/ideabox.py, VibeHistoryView). who нет — анонимно. */
export type PetAction = "feed" | "pet";
/** Настроение питомца (chat/pets.py mood). */
export type PetMood = "happy" | "content" | "bored" | "hungry" | "lonely" | "sad" | "sick" | "overfed";
/** Коротко — для чатов. */
export interface PetBrief {
  id: string;
  owner_id: string;
  species: string;
  name: string;
  level: number;
  mood: PetMood;
  show_in_chats: boolean;
  /** В каком чате сейчас (зовёт хозяин из меню чата); null — дома, только в профиле. */
  chat_id?: string | null;
  /** Окрас из пака вида (manifest.coats); пусто — как нарисован. */
  color?: string;
  /** Пол: меняет украшения и фразы, позже — и анимации. */
  sex?: "m" | "f";
  /** Надетые украшения (manifest.accessories); null — по умолчанию для пола. */
  accessories?: string[] | null;
}
/** Полностью — для карточки профиля. */
export interface Pet extends PetBrief {
  last_fed_at: string | null;
  last_petted_at: string | null;
  can_care: boolean;
  next_care_at: string | null;
  today: { who: { id: string; username: string; avatar_url?: string | null }; action: PetAction; at: string }[];
  cares_total: number;
  /** Только хозяину: где питомец и как чат у него называется. */
  chat?: { id: string; title: string } | null;
}

export interface VibeEvent {
  kind: "profile" | "saved" | "idea_like" | "idea_vote" | "report" | "playlist_like" | "admin" | "pet_care";
  points: number;
  at: string;
  /** admin: за что админ начислил или снял баллы. */
  reason?: string;
  who?: { id: string; username: string; avatar_url?: string | null } | null;
  image?: string;
  idea?: string;
  /** playlist_like: название плейлиста, который лайкнули. */
  playlist?: string;
  /** pet_care: кличка питомца и что сделали (who — хозяин, если питомец чужой). */
  pet?: string;
  action?: PetAction;
}
export interface VibeHistory { vibe: number; silent: boolean; items: VibeEvent[] }

/** Результат поиска по сообщениям (chat/views.py, MessageSearchView): text — кусок
 *  вокруг совпадения, transcript — нашлось в расшифровке голосового. */
export interface MessageHit {
  id: string;
  chat: { id: string; kind: string; is_group: boolean; title: string; avatar_url?: string | null; peer_id?: string | null };
  sender: { id: string; username: string; avatar_url?: string | null } | null;
  text: string;
  transcript: boolean;
  created_at: string;
}

export interface StickerPackInfo {
  id: string;
  name: string;
  description?: string | null;
  author?: { id: string; username: string; avatar_url?: string | null } | null;
  is_public: boolean;
  is_adult?: boolean;
  /** 18+ и настройка выключена: стикеры не приходят, добавить нельзя. */
  adult_locked?: boolean;
  stickers_count: number;
  /** «emoji» — набор своих эмодзи (вставляются в текст), иначе стикеры. */
  kind?: "sticker" | "emoji";
  /** Уже добавлен текущим пользователем. */
  is_saved: boolean;
  /** Совместный набор: добавлять стикеры могут все, кто его сохранил. */
  open_add?: boolean;
}

export type ReportTarget = "user" | "message" | "chat" | "sound_pack" | "sticker_pack" | "theme" | "track";
export type ReportReason = "sexual" | "violence" | "abuse" | "spam" | "illegal" | "copyright" | "other";

export interface SavedImage {
  id: string;
  file_url: string;
  file_name: string;
  created_at: string;
  /** Сколько раз за эту картинку подняли вайб владельцу. */
  vibes?: number;
  /** Я уже поднимал вайб за неё. */
  vibed?: boolean;
}

/** Закреплённое сообщение в списке чатов: id + превью, полный текст в ленте. */
import type { ReactionSummary } from "@/lib/reactions";
import { withBusy } from "@/lib/busy";

/** Опрос в посте Стены. votes — только если results (проголосовал или автор). */
export interface PollInfo {
  id: string;
  anonymous: boolean;
  total: number;
  voted: string[];
  results: boolean;
  options: { id: string; text: string; votes: number | null }[];
}

/** Плейлист и трек: музыка из переписки, собранная в списки. */
export interface Playlist {
  id: string;
  name: string;
  is_default: boolean;
  /** Ключ ссылки; пусто — плейлист личный. */
  share_token?: string;
  /** Общедоступный: виден собеседникам во вкладке «Музыка». */
  is_public?: boolean;
  created_at?: string;
  tracks_count?: number;
  /** Сколько раз его слушали другие (свои запуски и повторы в полчаса не в счёт). */
  plays?: number;
  /** Лайки; liked — мой (только у чужого плейлиста). Лайк — +5 к вайбу создателя. */
  likes?: number;
  liked?: boolean;
  /** Где я остановился: трек и секунда (lib/playlistResume). */
  resume?: { track_id: string; position: number } | null;
  /** Обложка владельца (/media/playlists/…); пусто — плитка со значком. */
  cover_url?: string | null;
}

/** Прослушивания и лайки плейлиста (ответ play/like). */
export interface PlaylistStats { plays: number; likes: number; liked: boolean }

/** Эфир (радиостанция): плейлист, который собеседники слушают вместе. */
export interface StationInfo {
  id: string;
  name: string;
  is_default: boolean;
  playlist_id: string;
  /** Обложка плейлиста эфира. */
  cover_url?: string | null;
  owner: { id: string; username: string; avatar_url?: string | null };
  /** Эфир от имени канала — его видят подписчики. */
  channel: { id: string; name: string; avatar_url?: string | null } | null;
  mine: boolean;
  can_control: boolean;
  paused: boolean;
  /** Вперемешку: порядок задаёт сервер, у всех слушателей один. */
  shuffle?: boolean;
  listeners: number;
  listeners_preview: { id: string; username: string; avatar_url?: string | null }[];
  now_title: string;
  now_artist: string;
  tracks_count: number;
}

/** Состояние эфира: что играет и с какого момента (мс по часам сервера). */
export interface StationState {
  station: StationInfo;
  server_now: number;
  now: { track: PlaylistTrack; started_at: number; position?: number } | null;
  next: { track: PlaylistTrack; started_at: number }[];
}

/** Мини-приложение в каталоге (GET webapps/). */
export interface MiniAppItem {
  bot: { id: string; username: string; avatar_url?: string | null };
  title: string;
  description: string;
  users: number;
  /** https://wyx.su/u/<бот>?app */
  link: string;
}

/** Открытый плейлист собеседника в списке вкладки «Музыка». */
export interface PublicPlaylist {
  id: string;
  name: string;
  is_default: boolean;
  tracks_count: number;
  /** Когда туда последний раз добавляли музыку. */
  updated_at?: string | null;
  owner: { id: string; username: string; avatar_url?: string | null };
  plays?: number;
  likes?: number;
  cover_url?: string | null;
}

export interface PlaylistTrack {
  id: string;
  /** Как лежит на сервере: /media/... или s3://key — плееру этого достаточно. */
  file_url: string;
  title: string;
  artist?: string;
  duration?: number | null;
  /** Исходное сообщение; null — его удалили, трек остался. */
  source?: string | null;
  added_at?: string;
  /** Из какого плейлиста (в общем списке listAllTracks). */
  playlist_name?: string;
}

/** Отложенное сообщение (сервер chat/scheduled.py): уйдёт само в send_at. */
export interface ScheduledItem {
  id: string;
  chat: string;
  send_at: string;
  content: string;
  entities?: { type: string; offset: number; length: number }[];
  reply_to_id?: string | null;
  effect?: string;
  silent?: boolean;
  /** Не ушло — почему (остаётся в списке, пока автор не решит). */
  error?: string;
}

export interface PinnedInfo {
  id: string;
  sender_username: string;
  preview: string;
}

/** Разделы «Медиа и файлы» (GET messages/media/). */
export type MediaKind = "photo" | "video" | "music" | "voice" | "file";

export interface ChatWallpaper { url: string | null; kind: "image" | "video" | "none" | string; poster?: string | null; anim?: string | null }

/** Действие в чате: кнопка name, в сообщении — «<emoji> <ник> <verb> <адресат>». */
export interface ChatActionInfo { id: number; slug: string; name: string; verb: string; emoji: string; premium?: boolean; adult?: boolean; /** «Про себя» — без адресата. */ solo?: boolean; name_en?: string; name_ko?: string; phrase_en?: string; phrase_ko?: string; order?: number; is_active?: boolean;
  /** Отправителю («Вы подмигиваете {whom}») и адресату («Вам подмигивает {who}»). */
  phrase_ru_self?: string; phrase_ru_you?: string; phrase_en_self?: string; phrase_en_you?: string; phrase_ko_self?: string; phrase_ko_you?: string }
/** Поля действия, которые правит админ (пустые переводы заполнит сервер). */
export type ChatActionDraft = Partial<Omit<ChatActionInfo, "id" | "slug">>;

/** Название действия на языке интерфейса (каталог хранит en/ko рядом с русским). */
export function actionName(a: { name: string; name_en?: string; name_ko?: string }, lang: string): string {
  return (lang === "en" && a.name_en) || (lang === "ko" && a.name_ko) || a.name;
}
/** Фраза действия: «Вася подмигивает Пете» / «Vasya winks at Petya» / «…에게 윙크해요». */
export function actionPhrase(a: { verb: string; phrase_en?: string; phrase_ko?: string }, lang: string, who: string, whom: string): string {
  const tpl = (lang === "en" && a.phrase_en) || (lang === "ko" && a.phrase_ko) || "";
  return tpl ? tpl.replace("{who}", who).replace("{whom}", whom) : `${who} ${a.verb} ${whom}`;
}

/** Бан на Стене: until пусто — навсегда. */
export interface WallBan { until: string | null; reason: string; created_at: string }
export interface WallBanRow extends WallBan { profile: { id: string; username: string; avatar_url?: string | null } }
export interface WallState {
  id: string; name: string; kind: "wall"; enabled: boolean; new_count: number;
  ban: WallBan | null; is_admin: boolean;
  muted_authors: { id: string; username: string; avatar_url?: string | null }[];
  /** Автоперевод чужих постов на мой язык и есть ли переводчик на сервере. */
  translate?: boolean; translate_available?: boolean;
  /** Пуши о постах собеседников: общий выключатель и авторы, о ком не уведомлять. */
  notify?: boolean; notify_muted?: string[];
}

export interface Chat {
  id: string;
  participants: Profile[];
  /** Общие обои чата и моя личная замена (kind "none" — скрыть у себя). */
  wallpaper?: ChatWallpaper | null;
  my_wallpaper?: ChatWallpaper | null;
  created_at?: string;
  is_group?: boolean;
  /** direct · group · channel · saved («Избранное»). */
  kind?: string;
  name?: string;
  avatar_url?: string | null;
  creator?: string | null;
  pinned_message?: PinnedInfo | null;
  /** Секретный чат: состояние и открытые ключи сторон (lib/secret.ts). */
  secret?: import("@/lib/secret").SecretInfo | null;
  /** Запрос на переписку: id того, кто должен принять; null — обычный чат. */
  pending_for?: string | null;
}

export interface ChatInfo {
  id: string;
  name?: string;
  is_group?: boolean;
  avatar_url?: string | null;
  creator?: string | null;
  participants?: Profile[];
  /** Группа: сколько питомцев одновременно (chat/pets.py); 0 — выключены. */
  pet_limit?: number;
  /** Мои права в группе (lib/groupRights): владелец — все, админ — выданные. */
  my_rights?: string[];
}

/** Живой перевод текста (chat/live.py LiveTextView): исходный язык, язык перевода и сам перевод. */
export interface LiveTextResult {
  text: string;
  from: string;
  to: string;
  translation: string;
}

export interface NotificationSoundInfo {
  id: string;
  slug: string;
  name: string;
  url: string;      // исходник — проигрывается в приложении
  caf_url: string;  // вариант для APNs, докачивается в Library/Sounds на iOS
  pack?: string | null;
  pack_name?: string;
  /** Можно поставить себе: вне пака, стандартный, свой или добавленный пак. Чужие
   *  публичные паки в каталоге — только чтобы сыграть входящее (SoundPicker их не показывает). */
  pack_mine?: boolean;
  pack_adult?: boolean;
  updated_at: string;
}

export interface VibeState { vibe: number; voted: boolean; can_vote: boolean; can_adjust?: boolean }
/** Шаблон причины начисления вайба админом (chat/ideabox.py, VibeReasonsView). */
export interface VibeReason { id: number; name: string; points: number }
export interface VibeLevel { min_vibe: number; name: string; color: string; glow: boolean }
export interface VibeLevelsConfig { bar_length: number; levels: VibeLevel[] }
export interface IdeaItem {
  id: string; text: string; likes: number; dislikes: number; status: "" | "done" | "hidden";
  created_at: string; done_at: string | null; mine: boolean; my_vote: number;
  /** Голосовая идея: само голосовое; transcript — состояние расшифровки, пока текста нет
   *  (pending — расшифровываем, error — не вышло, done без текста — тишина). */
  voice?: { url: string; duration: number; video?: boolean } | null;
  transcript?: string;
}
export interface IdeasPage {
  sort: string; page: number; pages: number; count: number; is_admin: boolean; my_vibe: number;
  points: { vote: number; like: number }; items: IdeaItem[];
}

interface UnreadCountResponse {
  total_unread: number;
  unread_by_chat: Record<string, number>;
  /** Группы, где меня упомянули или ответили мне, а я не прочитал. */
  mention_by_chat?: Record<string, boolean>;
}

/** Последний ответ /chats/ и его ETag — для условного запроса (If-None-Match). */
let chatsEtag: { tag: string | null; list: Chat[] | null } = { tag: null, list: null };

async function fetchWithAuth(input: RequestInfo, init?: RequestInit): Promise<Response> {
  const token = localStorage.getItem("access_token");
  const authInit = {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
      Authorization: token ? `Bearer ${token}` : "",
    },
  };

  let res = await fetchWithFallback(input, authInit);

  // Эндпоинты авторизации обновлять нечем и незачем: 401 там означает
  // «неверные данные», а не «протух токен». Без этой проверки обёртка лезла
  // обновлять несуществующий refresh и подменяла ответ сервера своей ошибкой —
  // пользователь видел «no refresh token» вместо «неверный логин или пароль».
  const url = typeof input === "string" ? input : (input as Request).url;
  const isAuthEndpoint = /\/(token|auth\/register)\/?$/.test(url)
    || url.includes("/token/refresh");

  // Если access token устарел — пробуем обновить
  if (res.status === 401 && !isAuthEndpoint) {
    // Сеанс завершили с другого устройства — не обновляем, а выходим и чистим кэш.
    const probe = await res.clone().json().catch(() => null);
    if (probe && /Сеанс завершён/.test(String(probe.detail || ""))) {
      void import("@/lib/forceLogout").then((m) => m.forceLogout("revoked"));
      throw new LError("Сеанс завершён — войдите снова");
    }
    const refreshToken = localStorage.getItem("refresh_token");
    if (!refreshToken) throw new LError("Unauthorized: no refresh token");

    try {
      const refreshRes = await fetchWithFallback(`${API_URL}/token/refresh/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh: refreshToken }),
      });

      if (!refreshRes.ok) {
        // Refresh token тоже недействителен (истёк или сеанс отозван) — выходим и чистим кэш.
        const body = await refreshRes.json().catch(() => null);
        void import("@/lib/forceLogout").then((m) => m.forceLogout(/Сеанс завершён/.test(String(body?.detail || "")) ? "revoked" : "expired"));
        throw new LError("Refresh token expired, please login again");
      }

      const data = await refreshRes.json();
      localStorage.setItem("access_token", data.access);

      // Повторяем исходный запрос с новым токеном
      const retryInit = {
        ...authInit,
        headers: {
          ...(authInit.headers as Record<string, string>),
          Authorization: `Bearer ${data.access}`,
        },
      };
      res = await fetch(input, retryInit);
    } catch (err) {
      throw err;
    }
  }

  return res;
}

/**
 * Токен для WebSocket. Обычные запросы обновляют токен по 401, а сокету
 * ответить нечем: сервер просто закрывает соединение. Поэтому проверяем
 * срок жизни заранее и при необходимости обновляем перед подключением —
 * иначе после протухания сокет не переподключится никогда, и пропадут
 * realtime-сообщения и звонки.
 */
export async function getFreshAccessToken(): Promise<string | undefined> {
  const token = localStorage.getItem("access_token") || undefined;
  const refresh = localStorage.getItem("refresh_token");
  const expiresAt = (t?: string): number => {
    if (!t) return 0;
    try {
      return (JSON.parse(atob(t.split(".")[1]))?.exp || 0) * 1000;
    } catch {
      return 0;
    }
  };

  // Запас в минуту: подключение не должно стартовать с почти мёртвым токеном.
  if (token && expiresAt(token) - Date.now() > 60_000) return token;
  if (!refresh) return token;

  try {
    const res = await fetchWithFallback(`${API_URL}/token/refresh/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh }),
    });
    if (!res.ok) return token;
    const data = await res.json();
    if (data.access) {
      localStorage.setItem("access_token", data.access);
      return data.access;
    }
  } catch {
    /* сеть подведёт — пробуем старым токеном */
  }
  return token;
}

function authHeaders() {
  const token = localStorage.getItem("access_token");
  return {
    "Content-Type": "application/json",
    Authorization: token ? `Bearer ${token}` : "",
  };
}

// Добавим функцию для загрузки файлов
async function fetchWithAuthMultipart(input: RequestInfo, init?: RequestInit): Promise<Response> {
  const token = localStorage.getItem("access_token");
  const authInit = {
    ...init,
    headers: {
      ...(init?.headers || {}),
      Authorization: token ? `Bearer ${token}` : "",
    },
  };

  let res = await fetchWithFallback(input, authInit);

  // Если access token устарел — пробуем обновить (та же логика что и в fetchWithAuth)
  if (res.status === 401) {
    const refreshToken = localStorage.getItem("refresh_token");
    if (!refreshToken) throw new LError("Unauthorized: no refresh token");

    try {
      const refreshRes = await fetchWithFallback(`${API_URL}/token/refresh/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh: refreshToken }),
      });

      if (!refreshRes.ok) {
        localStorage.removeItem("access_token");
        localStorage.removeItem("refresh_token");
        throw new LError("Refresh token expired, please login again");
      }

      const data = await refreshRes.json();
      localStorage.setItem("access_token", data.access);

      const retryInit = {
        ...authInit,
        headers: {
          ...(authInit.headers as Record<string, string>),
          Authorization: `Bearer ${data.access}`,
        },
      };
      res = await fetch(input, retryInit);
    } catch (err) {
      throw err;
    }
  }

  return res;
}


/** Загрузка с прогрессом. Как и fetchWithFallback: если CDN-адрес оборвал
 *  запрос (сетевая ошибка, 413, 408, 5xx — у CDN свои лимиты на тело и
 *  время запроса, большой файл с мобильной сети в них не укладывается) —
 *  тот же запрос повторяется напрямую на сервер, где лимит 50 МБ и сутки. */
/**
 * Отправка файла кусками. Каждый кусок — отдельный короткий запрос, поэтому
 * шлюз CDN успевает его принять; кусок, который не дошёл, повторяется до трёх
 * раз, и на слабой сети это спасает всю отправку вместо того, чтобы начинать
 * её заново. Последний кусок собирает файл на сервере и возвращает обычный
 * ответ загрузки.
 */
// Большие файлы грузим строго по одному на всё приложение. Две отправки
// разом (два альбома, повторная отправка) делили слабый мобильный канал, и
// iOS рвал соединения — «The network connection was lost», второе видео так и
// не доходило. Очередь общая: следующая загрузка ждёт конца предыдущей.
let chunkQueue: Promise<unknown> = Promise.resolve();

/** Загрузку отменил человек (крестик у полоски) — не ошибка сети, не повторяем. */
export const isUploadCancelled = (e: unknown) => !!(e as { cancelled?: boolean } | null)?.cancelled;
const cancelled = () => Object.assign(new LError("Загрузка отменена"), { cancelled: true });

/**
 * Возврат на экран после блокировки или фона. iOS, усыпив WebView, рвёт
 * соединения, а запрос куска при этом мог так и не завершиться — загрузка
 * стояла «навсегда» (баг: «не факт, что возобновится»). Вернулись спустя
 * пару секунд — повисший кусок шлём заново сразу, паузы между попытками
 * обрываем, неудачи за время сна не считаем.
 */
const resumeKicks = new Set<() => void>();
let hiddenAt = 0;
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") { hiddenAt = Date.now(); return; }
    const slept = hiddenAt && Date.now() - hiddenAt > 3000;
    hiddenAt = 0;
    if (slept && resumeKicks.size) {
      applog.info(`upload: вернулись на экран — повисшие куски заново (${resumeKicks.size})`);
      [...resumeKicks].forEach((k) => k());
    }
  });
}

/** Пауза, которую обрывают отмена и возврат на экран. */
const pause = (ms: number, signal?: AbortSignal) => new Promise<void>((res) => {
  const done = () => { clearTimeout(t); resumeKicks.delete(done); signal?.removeEventListener("abort", done); res(); };
  const t = setTimeout(done, ms);
  resumeKicks.add(done);
  signal?.addEventListener("abort", done, { once: true });
});

/** Докуда дошла загрузка файла: «Повторить» с тем же файлом продолжает с
 *  первого недошедшего куска — сервер держит принятые куски 12 часов. */
const chunkProgress = new WeakMap<Blob, { id: string; next: number; total: number; key: string }>();

function uploadInChunks(
  file: File,
  extra: Record<string, string>,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<any> {
  const turn = chunkQueue.then(() => (signal?.aborted ? Promise.reject(cancelled()) : uploadInChunksNow(file, extra, onProgress, signal)));
  // Очередь не должна вставать из-за чужой ошибки; следующая ждёт, пока эта
  // действительно остановится.
  chunkQueue = turn.catch(() => undefined);
  if (!signal) return turn;
  // Отменили, пока ждали очереди, — сразу, не дожидаясь чужой загрузки.
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(cancelled());
    if (signal.aborted) { onAbort(); return; }
    signal.addEventListener("abort", onAbort, { once: true });
    turn.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

async function uploadInChunksNow(
  file: File,
  extra: Record<string, string>,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<any> {
  const token = await getFreshAccessToken();
  const total = Math.ceil(file.size / CHUNK_SIZE);
  const key = `${file.size}|${total}|${JSON.stringify(extra)}`;
  let st = chunkProgress.get(file);
  if (!st || st.key !== key) {
    const id = (crypto.randomUUID?.() || `${Date.now()}${Math.random()}`).replace(/[^0-9a-f]/gi, "").slice(0, 32).padEnd(32, "0").toLowerCase();
    st = { id, next: 0, total, key };
    chunkProgress.set(file, st);
  }
  const state = st;
  const uploadId = state.id;
  onProgress?.(Math.round((state.next / total) * 100)); // очередь дошла — загрузка началась
  applog.info(state.next
    ? `upload chunked продолжаю ${Math.round(file.size / 1024)}KB с куска ${state.next + 1}/${total}`
    : `upload chunked start ${Math.round(file.size / 1024)}KB кусков=${total}`);
  const started = performance.now();
  // Пока файл уходит, экран не гаснет: с блокировкой WebView засыпает и
  // загрузка встаёт (на телефоне экран гаснет сам, если его не трогать).
  const awake = `upload:${uploadId}`;
  keepScreenAwake(awake, true);
  // Самый долгий удачный кусок — от него таймаут попытки: на медленной сети
  // кусок честно идёт минуту, а повисший не должен держать загрузку вечно.
  let slowest = 0;
  try {
    for (let i = state.next; i < total; i++) {
      const last = i === total - 1;
      const body = new FormData();
      body.append("upload_id", uploadId);
      body.append("index", String(i));
      body.append("total", String(total));
      body.append("chunk", file.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE), "part");
      if (last) {
        body.append("file_name", file.name);
        for (const [k, v] of Object.entries(extra)) body.append(k, v);
      }
      let lastErr: unknown = null;
      let jumpTo: number | null = null;
      // Мобильная сеть рвётся надолго — ждём дольше и пробуем больше раз:
      // паузы 0,5 · 1 · 2 · 4 · 6 · 8 с, всего около 20 с на кусок.
      const PAUSES = [500, 1000, 2000, 4000, 6000, 8000];
      for (let attempt = 0; attempt <= PAUSES.length; attempt++) {
        if (signal?.aborted) throw cancelled();
        const ctrl = new AbortController();
        const onCancel = () => ctrl.abort();
        signal?.addEventListener("abort", onCancel, { once: true });
        // Вернулись на экран — эта попытка, скорее всего, мертва: заново, и не в счёт.
        let kicked = false;
        const kick = () => { kicked = true; ctrl.abort(); };
        resumeKicks.add(kick);
        const limit = Math.max(60_000, slowest * 4);
        const timer = setTimeout(() => ctrl.abort(), limit);
        const t0 = performance.now();
        try {
          const res = await fetch(`${uploadBase()}/upload/chunk/`, {
            method: "POST",
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
            body,
            signal: ctrl.signal,
          });
          if (res.status === 409 && last) {
            // Сервер не досчитался кусков (не дошли раньше) — дошлём их и снова последний.
            const d = await res.json().catch(() => ({}));
            const missing = Array.isArray(d?.missing) ? (d.missing as number[]).filter((n) => Number.isInteger(n) && n >= 0 && n < i) : [];
            if (missing.length) { jumpTo = Math.min(...missing); lastErr = null; break; }
          }
          if (!res.ok) {
            let msg = tr("Кусок {i} из {n}: ошибка {code}", { i: i + 1, n: total, code: res.status });
            try { msg = (await res.json()).error || msg; } catch { /* не JSON */ }
            // Отказ сервера по сути (не сеть, не перегрузка) повторять бессмысленно.
            const fatal = res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429 && res.status !== 409;
            throw Object.assign(new LError(msg), { fatal });
          }
          slowest = Math.max(slowest, performance.now() - t0);
          // Последний кусок: сервер склеил файл и обрабатывает его в фоне
          // (сжатие видео, хранилище) — держим 99%, пока не придёт итог.
          onProgress?.(last ? 99 : Math.round(((i + 1) / total) * 100));
          if (last) {
            let done = await res.json();
            if (done?.processing) {
              // -2 — «обработка на сервере»: файл уже залит, сервер сжимает
              // видео. На голых 99% это выглядело зависанием.
              onProgress?.(-2);
              done = await waitUploadDone(uploadId, token, signal);
            }
            chunkProgress.delete(file);
            onProgress?.(100);
            applog.info(`upload chunked ok ${Math.round(file.size / 1024)}KB ${Math.round(performance.now() - started)}ms`);
            return done;
          }
          state.next = i + 1;
          lastErr = null;
          break;
        } catch (e) {
          if (signal?.aborted || isUploadCancelled(e)) throw cancelled();
          lastErr = e;
          if ((e as any)?.fatal) break;
          if (kicked) { attempt = -1; continue; }
          if (attempt >= PAUSES.length) break;
          applog.warn(`upload кусок ${i + 1}/${total} не прошёл${ctrl.signal.aborted ? ` (нет ответа ${Math.round(limit / 1000)} с)` : ""}, попытка ${attempt + 1}`);
          await pause(PAUSES[attempt], signal);
        } finally {
          clearTimeout(timer);
          resumeKicks.delete(kick);
          signal?.removeEventListener("abort", onCancel);
        }
      }
      if (jumpTo != null) {
        applog.warn(`upload: сервер не досчитался кусков — дошлю с ${jumpTo + 1}/${total}`);
        state.next = jumpTo;
        i = jumpTo - 1;
        continue;
      }
      if (lastErr) {
        applog.error(`upload chunked ✗ на куске ${i + 1}/${total}`);
        throw lastErr;
      }
    }
    throw new LError("Загрузка не завершилась");
  } finally {
    keepScreenAwake(awake, false);
  }
}

/** Ждём, пока сервер обработает склеенный файл. Опросы короткие — каждый
 *  укладывается в таймаут CDN; сжатие большого видео занимает до пары минут. */
async function waitUploadDone(uploadId: string, token?: string, signal?: AbortSignal): Promise<any> {
  const deadline = Date.now() + 6 * 60_000;
  let delay = 1200;
  while (Date.now() < deadline) {
    await pause(delay, signal);
    if (signal?.aborted) throw cancelled();
    delay = Math.min(4000, Math.round(delay * 1.3));
    try {
      const res = await fetch(`${uploadBase()}/upload/chunk/${uploadId}/`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        signal,
      });
      if (res.status === 202) continue;
      const data = await res.json().catch(() => ({}));
      if (res.ok) return data;
      throw new LError(data?.error || tr("Обработка не удалась ({code})", { code: res.status }));
    } catch (e) {
      if (signal?.aborted) throw cancelled();
      // Сетевой сбой посреди ожидания — не повод терять уже залитый файл.
      if (e instanceof TypeError) continue;
      throw e;
    }
  }
  throw new LError("Сервер слишком долго обрабатывает файл");
}

async function uploadWithProgress(
  url: string,
  formData: FormData,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<any> {
  if (signal?.aborted) throw cancelled();
  const token = await getFreshAccessToken();
  const started = performance.now();
  const size = (() => { let n = 0; formData.forEach((v) => { if (v instanceof Blob) n += v.size; }); return Math.round(n / 1024); })();
  const attempt = (target: string) => new Promise<any>((resolve, reject) => {
    applog.info(`upload start ${safePath(target)} ${size}KB`);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", target);
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      const ms = Math.round(performance.now() - started);
      if (xhr.status >= 200 && xhr.status < 300) {
        applog.info(`upload ok ${safePath(target)} ${size}KB ${ms}ms`);
        try { resolve(JSON.parse(xhr.responseText)); } catch { resolve({}); }
        return;
      }
      applog.warn(`upload ✗ ${safePath(target)} ${size}KB → ${xhr.status} ${ms}ms`);
      let detail = "";
      try { detail = JSON.parse(xhr.responseText)?.error || ""; } catch { /* не JSON */ }
      const err = new LError(detail || (xhr.status === 413 ? "Файл слишком большой для сервера" : tr("Загрузка не удалась ({code})", { code: xhr.status }))) as Error & { status?: number };
      err.status = xhr.status;
      reject(err);
    };
    xhr.onerror = () => {
      applog.error(`upload ✗ ${safePath(target)} ${size}KB сеть ${Math.round(performance.now() - started)}ms`);
      reject(Object.assign(new LError("Сеть оборвала загрузку"), { status: 0 }));
    };
    xhr.ontimeout = () => {
      applog.error(`upload ✗ ${safePath(target)} ${size}KB таймаут`);
      reject(Object.assign(new LError("Загрузка не уложилась во время"), { status: 408 }));
    };
    const onCancel = () => xhr.abort();
    xhr.onabort = () => reject(cancelled());
    xhr.onloadend = () => signal?.removeEventListener("abort", onCancel);
    signal?.addEventListener("abort", onCancel, { once: true });
    xhr.send(formData);
  });
  const awake = `upload:${Math.random().toString(36).slice(2)}`;
  keepScreenAwake(awake, true);
  try {
    return await attempt(url);
  } catch (e: any) {
    if (isUploadCancelled(e)) throw e;
    const st = e?.status ?? 0;
    const retryable = st === 0 || st === 413 || st === 408 || st >= 500;
    const from = originOf(url);
    const next = from ? nextOrigin(from) : null;
    if (!from || !next || !retryable) throw e;
    // Слишком большой файл или таймаут шлюза — это ограничение CDN, запасной
    // домен того же CDN упрётся в него же: сразу на сервер. Сеть — по цепочке
    // до конца (запасной тоже может не отвечать), адрес — от исходного звена.
    let to: string | null = (st === 413 || st === 408) && CDN_ORIGINS.includes(from) ? DIRECT_ORIGIN : next;
    let prev = from;
    for (;;) {
      switchFrom(prev, `upload ${st || "network"}`, to);
      onProgress?.(0);
      try {
        return await attempt(retarget(url, from, to));
      } catch (e2: any) {
        if (isUploadCancelled(e2)) throw e2;
        const st2 = e2?.status ?? 0;
        const after = nextOrigin(to);
        if (!(st2 === 0 || st2 >= 500) || !after) throw e2;
        prev = to;
        to = after;
      }
    }
  } finally {
    keepScreenAwake(awake, false);
  }
}


export const api = {
  // ===== AUTH =====
  register: async (username: string, password: string, acceptTerms = false): Promise<AuthResponse> => {
    const res = await fetchWithAuth(`${API_URL}/auth/register/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, accept_terms: acceptTerms }),
    });

    if (!res.ok) {
      const fullResponseText = await res.text();
      console.log("🔴🔴🔴 ПОЛНЫЙ ОТВЕТ СЕРВЕРА (register):");
      console.log("----------------------------------------");
      console.log(fullResponseText);
      console.log("----------------------------------------");
      console.log("Длина ответа:", fullResponseText.length, "символов");
      
      const error = new LError(`Register failed: ${res.status} ${res.statusText}`);
      (error as any).fullResponse = fullResponseText;
      throw error;
    }

    return res.json();
  },

  login: async (username: string, password: string): Promise<{ access: string; refresh: string }> => {
    // Паспорт устройства — для списка «Устройства» и выхода с него издалека.
    let device: Record<string, string> = {};
    try { const { deviceInfo } = await import("@/lib/device"); device = deviceInfo(); } catch { /* без него тоже войдём */ }
    const res = await fetchWithAuth(`${API_URL}/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, ...device }),
    });

    if (!res.ok) {
      const fullResponseText = await res.text();
      console.log("🔴🔴🔴 ПОЛНЫЙ ОТВЕТ СЕРВЕРА (login):");
      console.log("----------------------------------------");
      console.log(fullResponseText);
      console.log("----------------------------------------");
      console.log("Длина ответа:", fullResponseText.length, "символов");
      
      const error = new LError(`Login failed: ${res.status} ${res.statusText}`);
      (error as any).fullResponse = fullResponseText;
      throw error;
    }

    const data = await res.json();
    localStorage.setItem("access_token", data.access);
    localStorage.setItem("refresh_token", data.refresh);
    return data;
  },

  logout: async (): Promise<AuthResponse> => {
    // Сначала завершаем сеанс на сервере, чтобы устройство пропало из списка.
    try {
      const { deviceId } = await import("@/lib/secret");
      await fetchWithAuth(`${API_URL}/account/devices/${encodeURIComponent(deviceId())}/revoke/`, { method: "POST", headers: authHeaders() }).catch(() => {});
    } catch { /* офлайн — не страшно */ }
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    return { message: "Logged out" };
  },

  /** Автоперевод в личке: мои флаги, языки обоих, настроен ли провайдер. */
  getChatTranslate: async (chatId: string): Promise<ChatTranslate> => {
    const res = await fetchWithAuth(`${API_URL}/chats/${chatId}/translate/`, { method: "GET", headers: authHeaders() });
    if (!res.ok) throw new LError("Не удалось получить настройки перевода");
    return res.json();
  },
  setChatTranslate: async (chatId: string, data: { translate_in?: boolean; translate_out?: boolean }): Promise<ChatTranslate> => {
    const res = await fetchWithAuth(`${API_URL}/chats/${chatId}/translate/`, { method: "PATCH", headers: authHeaders(), body: JSON.stringify(data) });
    if (!res.ok) throw new LError("Не удалось сохранить настройки перевода");
    return res.json();
  },
  /** Перевод одного сообщения по запросу — на мой язык (или to). */
  translateMessage: async (messageId: string, to?: string): Promise<any> => {
    const res = await fetchWithAuth(`${API_URL}/messages/${messageId}/translate/`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ to }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(body?.error || "Не удалось перевести");
    return body;
  },

  /** Устройства с действующим входом (Конфиденциальность → Устройства). */
  listDevices: async (): Promise<{ current: string; devices: DeviceSession[] }> => {
    const res = await fetchWithAuth(`${API_URL}/account/devices/`, { method: "GET", headers: authHeaders() });
    if (!res.ok) throw new LError("Не удалось получить устройства");
    return res.json();
  },
  revokeDevice: async (deviceId: string): Promise<{ ok: boolean; self: boolean }> => {
    const res = await fetchWithAuth(`${API_URL}/account/devices/${encodeURIComponent(deviceId)}/revoke/`, { method: "POST", headers: authHeaders() });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(body?.error || "Не удалось завершить сеанс");
    return body;
  },
  /** Выйти везде, кроме этого устройства; сервер выдаёт этому устройству новые токены. */
  revokeOtherDevices: async (): Promise<{ ok: boolean; revoked: number }> => {
    const res = await fetchWithAuth(`${API_URL}/account/devices/revoke-others/`, { method: "POST", headers: authHeaders() });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(body?.error || "Не удалось завершить сеансы");
    if (body.access && body.refresh) { localStorage.setItem("access_token", body.access); localStorage.setItem("refresh_token", body.refresh); }
    return body;
  },

  // ===== PROFILES =====
  getCurrentUser: async (): Promise<Profile> => {
    const res = await fetchWithAuth(`${API_URL}/profiles/current/`, {
      method: "GET",
      headers: authHeaders(),
    });
    if (!res.ok) throw new LError("Failed to get current user");
    return res.json();
  },

  getProfile: async (profileId?: string): Promise<Profile> => {
    if (profileId) {
      const res = await fetchWithAuth(`${API_URL}/profiles/${profileId}/`, {
        method: "GET",
        headers: authHeaders(),
      });
      return res.json();
    } else {
      return api.getCurrentUser();
    }
  },

  /** Люди по началу ника (от 2 символов, до 20): без скрывших себя из поиска. */
  searchPeople: async (query: string): Promise<Profile[]> => {
    const res = await fetchWithAuth(`${API_URL}/people/search/?q=${encodeURIComponent(query)}`, { method: "GET", headers: authHeaders() });
    if (res.status === 429) throw new LError("Слишком часто — подождите минуту");
    if (!res.ok) throw new LError(`Search failed: ${res.status}`);
    return res.json();
  },

  searchUsers: async (query: string): Promise<Profile[]> => {
    const res = await fetchWithAuth(`${API_URL}/profiles/?search=${encodeURIComponent(query)}`, {
      method: "GET",
      headers: authHeaders(),
    });
    if (!res.ok) throw new LError(`Search failed: ${res.status}`);
    return res.json();
  },

  /** Публичная карточка по нику — для ссылки «Поделиться профилем» (/u/<ник>). */
  getProfileByUsername: async (username: string): Promise<Profile & { bio?: string; is_bot?: boolean }> => {
    const res = await fetchWithAuth(`${API_URL}/profiles/by-username/${encodeURIComponent(username)}/`, {
      method: "GET",
      headers: authHeaders(),
    });
    if (res.status === 404) throw new LError("not_found");
    if (!res.ok) throw new LError(`Profile failed: ${res.status}`);
    return res.json();
  },

  getProfileById: async (profileId: string): Promise<Profile> => {
    const res = await fetchWithAuth(`${API_URL}/profiles/${profileId}/`, {
      method: "GET",
      headers: authHeaders(),
    });
    return res.json();
  },

  // ===== CHATS =====
  getChats: async (): Promise<Chat[]> => {
    // ETag: список не изменился — сервер отвечает 304 без тела, отдаём прежний.
    const res = await fetchWithAuth(`${API_URL}/chats/`, {
      method: "GET",
      headers: { ...authHeaders(), ...(chatsEtag.tag ? { "If-None-Match": chatsEtag.tag } : {}) },
    });
    if (res.status === 304 && chatsEtag.list) return chatsEtag.list;
    const list = await res.json();
    if (res.ok && Array.isArray(list)) chatsEtag = { tag: res.headers.get("ETag"), list };
    return list;
  },

  getChatParticipants: async (chatId: string): Promise<Profile[]> => {
    const res = await fetchWithAuth(`${API_URL}/chats/${chatId}/participants/`, {
      method: "GET",
      headers: authHeaders(),
    });
    if (!res.ok) throw new LError("Failed to get chat participants");
    return res.json();
  },

  createChat: async (participantIds: string[], group?: { name: string; avatarUrl?: string }): Promise<Chat> => {
    const res = await fetchWithAuth(`${API_URL}/chats/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        participants: participantIds,
        ...(group ? { is_group: true, name: group.name, avatar_url: group.avatarUrl || undefined } : {}),
      }),
    });
    if (!res.ok) {
      const errorData = await res.json();
      if (res.status === 400 && errorData.detail?.includes("exists")) {
        const error = new LError("exists");
        (error as any).chatId = errorData.chat_id;
        throw error;
      }
      throw new LError(errorData.detail || "Failed to create chat");
    }
    return res.json();
  },

  /** «Начать» с ботом: личка создаётся, боту уходит /start; повтор — просто открыть. */
  startBot: async (botId: string): Promise<{ chat_id: string; started: boolean }> => {
    const res = await fetchWithAuth(`${API_URL}/bots/${botId}/start/`, { method: "POST", headers: authHeaders() });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(body?.error || "Не удалось начать");
    return body;
  },

  createDirectChat: async (friendId: string): Promise<Chat> => {
    try {
      return await api.createChat([friendId]);
    } catch (error: any) {
      if (error.message === "exists") {
        const err = new LError("exists") as any;
        err.chatId = error.chatId;
        throw err;
      }
      throw error;
    }
  },

  // «Избранное» — личный чат без собеседника; сервер создаёт его при первом
  // обращении. В общий список чатов не входит, у него своя вкладка.
  getSavedChat: async (): Promise<Chat> => {
    const res = await fetchWithAuth(`${API_URL}/chats/saved/`, { headers: authHeaders() });
    if (!res.ok) throw new LError("Не удалось открыть Избранное");
    return res.json();
  },

  // Закрепить/открепить сообщение в его чате (закреп один на чат).
  pinMessage: async (messageId: string, pin: boolean): Promise<{ pinned_message: PinnedInfo | null }> => {
    const res = await fetchWithAuth(`${API_URL}/messages/${messageId}/pin/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ pin }),
    });
    if (!res.ok) throw new LError((await res.json().catch(() => ({})))?.error || "Не удалось закрепить");
    return res.json();
  },

  // Переслать сообщение в другой чат (в «Избранное» — тоже сюда).
  // «Сохранёнки»: картинки из переписки в профиле.
  listSavedImages: async (profileId?: string, limit?: number): Promise<{ count: number; items: SavedImage[] }> => {
    const q = new URLSearchParams(); if (profileId) q.set("profile", profileId); if (limit) q.set("limit", String(limit));
    const res = await fetchWithAuth(`${API_URL}/saved-images/${q.toString() ? "?" + q : ""}`, { method: "GET", headers: authHeaders() });
    if (!res.ok) throw new LError("Не удалось загрузить сохранёнки");
    return res.json();
  },
  addSavedImage: async (messageId: string): Promise<SavedImage & { already?: boolean }> => {
    const res = await fetchWithAuth(`${API_URL}/saved-images/`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ message_id: messageId }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(d.error || "Не удалось сохранить");
    return { ...d, already: res.status === 200 };
  },
  deleteSavedImage: async (id: string): Promise<void> => {
    const res = await fetchWithAuth(`${API_URL}/saved-images/${id}/`, { method: "DELETE", headers: authHeaders() });
    if (!res.ok && res.status !== 404) throw new LError("Не удалось удалить");
  },
  /** Несколько сообщений одним пакетом: копии получают общий album_id и в
   *  ленте получателя склеиваются в один пузырь. */
  forwardMany: async (messageIds: string[], chatId: string): Promise<{ messages: any[] }> => {
    const res = await fetchWithAuth(`${API_URL}/messages/forward_many/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ message_ids: messageIds, chat_id: chatId }),
    });
    if (!res.ok) throw new LError((await res.json().catch(() => ({})))?.error || "Не удалось переслать");
    return res.json();
  },

  forwardMessage: async (messageId: string, chatId: string): Promise<any> => {
    const res = await fetchWithAuth(`${API_URL}/messages/${messageId}/forward/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ chat_id: chatId }),
    });
    if (!res.ok) throw new LError((await res.json().catch(() => ({})))?.error || "Не удалось переслать");
    return res.json();
  },

  getChat: async (chatId: string): Promise<Chat> => {
    const res = await fetchWithAuth(`${API_URL}/chats/${chatId}/`, {
      method: "GET",
      headers: authHeaders(),
    });
    return res.json();
  },

  // ===== CHANNELS =====
  getMyChannels: async (): Promise<any[]> => {
    const res = await fetchWithAuth(`${API_URL}/channels/`, { method: "GET", headers: authHeaders() });
    const d = await res.json();
    return d.channels || [];
  },
  discoverChannels: async (q: string): Promise<any[]> => {
    const res = await fetchWithAuth(`${API_URL}/channels/discover/?q=${encodeURIComponent(q)}`, { method: "GET", headers: authHeaders() });
    const d = await res.json();
    return d.channels || [];
  },
  /** Подключить публичный Telegram-канал как канал WYX (зеркало). */
  addTelegramChannel: async (url: string): Promise<any> => {
    const res = await fetchWithAuth(`${API_URL}/channels/from-telegram/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ url }),
    });
    if (!res.ok) throw new LError((await res.json().catch(() => ({})))?.error || "Не удалось подключить канал");
    return (await res.json()).channel;
  },

  createChannel: async (data: { name: string; username?: string; description?: string; sign_posts?: boolean }): Promise<any> => {
    const res = await fetchWithAuth(`${API_URL}/channels/`, { method: "POST", headers: authHeaders(), body: JSON.stringify(data) });
    const d = await res.json();
    if (!res.ok) throw new LError(d.error || "Не удалось создать канал");
    return d.channel;
  },
  /** Канал по ссылке /c/<handle>: @username или id. */
  getChannelByHandle: async (handle: string): Promise<any> => {
    const res = await fetchWithAuth(`${API_URL}/channels/by-handle/${encodeURIComponent(handle)}/`, { method: "GET", headers: authHeaders() });
    if (res.status === 404) throw new LError("not_found");
    if (!res.ok) throw new LError(`Channel failed: ${res.status}`);
    return res.json();
  },
  getChannel: async (id: string): Promise<any> => {
    const res = await fetchWithAuth(`${API_URL}/channels/${id}/`, { method: "GET", headers: authHeaders() });
    return res.json();
  },
  updateChannel: async (id: string, data: Record<string, any>): Promise<any> => {
    const res = await fetchWithAuth(`${API_URL}/channels/${id}/`, { method: "PATCH", headers: authHeaders(), body: JSON.stringify(data) });
    const d = await res.json();
    if (!res.ok) throw new LError(d.error || "Ошибка");
    return d;
  },
  deleteChannel: async (id: string): Promise<void> => {
    await fetchWithAuth(`${API_URL}/channels/${id}/`, { method: "DELETE", headers: authHeaders() });
  },
  subscribeChannel: async (id: string): Promise<any> => {
    const res = await fetchWithAuth(`${API_URL}/channels/${id}/subscribe/`, { method: "POST", headers: authHeaders() });
    return res.json();
  },
  /** Обои чата: файл (фото/gif/видео) → сервер ужмёт; scope chat — для всех, me — только мне. */
  setChatWallpaper: async (chatId: string, file: File, scope: "chat" | "me"): Promise<ChatWallpaper> => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("scope", scope);
    const res = await fetchWithAuthMultipart(`${API_URL}/chats/${chatId}/wallpaper/`, { method: "POST", body: fd });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(d.error || "Не удалось поставить обои");
    return d;
  },
  clearChatWallpaper: async (chatId: string, scope: "chat" | "me", hide = false): Promise<void> => {
    const res = await fetchWithAuth(`${API_URL}/chats/${chatId}/wallpaper/?scope=${scope}${hide ? "&hide=1" : ""}`, { method: "DELETE", headers: authHeaders() });
    if (!res.ok) throw new LError((await res.json().catch(() => ({}))).error || "Не вышло");
  },
  /** Кто прочитал сообщение и кто какие реакции поставил (поимённо). */
  messageViewers: async (messageId: string): Promise<{
    read_by: { id: string; username: string; avatar_url?: string | null; read_at: string }[];
    reactions: { emoji: string; key?: string; custom?: { url: string; repaint?: boolean }; users: { id: string; username: string; avatar_url?: string | null; at: string }[] }[];
  }> => {
    const res = await fetchWithAuth(`${API_URL}/messages/${messageId}/viewers/`, { method: "GET", headers: authHeaders() });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(d.error || "Не удалось загрузить");
    return d;
  },
  /** Inline-бот: «@бот запрос» в поле ввода → запрос боту; результаты придут в
   *  личный сокет событием inline_results (Chat.tsx → window "hyax:inline"). */
  inlineQuery: async (bot: string, query: string, chatId: string): Promise<{ query_id: string }> => {
    const res = await fetchWithAuth(`${API_URL}/bots/inline/query/`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ bot, query, chat_id: chatId }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(d.error || "Бот не отвечает");
    return d;
  },
  /** Выбор результата: в чат уходит сообщение-заглушка «через @бота», бот её заполнит. */
  inlineChoose: async (queryId: string, resultId: string): Promise<any> => {
    const res = await fetchWithAuth(`${API_URL}/bots/inline/${queryId}/choose/`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ result_id: resultId }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(d.error || "Не вышло");
    return d;
  },
  /** Выключить/включить пуши канала для себя. Возвращает канал с новым muted. */
  muteChannel: async (id: string, muted: boolean): Promise<any> => {
    const res = await fetchWithAuth(`${API_URL}/channels/${id}/mute/`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ muted }) });
    const d = await res.json();
    if (!res.ok) throw new LError(d.error || "Не удалось сохранить");
    return d;
  },
  leaveChannel: async (id: string): Promise<void> => {
    await fetchWithAuth(`${API_URL}/channels/${id}/leave/`, { method: "POST", headers: authHeaders() });
  },
  /** Лента канала: страница (limit/before) или приращение (since) — как syncMessages. */
  getChannelPosts: async (id: string, opts: { limit?: number; before?: string; since?: string } = {}): Promise<{ posts: any[]; deleted: string[]; has_more: boolean; now: string; authors?: { id: string; username: string; avatar_url?: string | null }[] }> => {
    const q = new URLSearchParams();
    if (opts.limit) q.set("limit", String(opts.limit));
    if (opts.before) q.set("before", opts.before);
    if (opts.since) q.set("since", opts.since);
    const res = await fetchWithAuth(`${API_URL}/channels/${id}/posts/${q.toString() ? "?" + q : ""}`, { method: "GET", headers: authHeaders() });
    if (!res.ok) throw new LError(`posts ${res.status}`);
    const d = await res.json();
    return { posts: d.posts || [], deleted: d.deleted || [], has_more: !!d.has_more, now: d.now || new Date().toISOString() };
  },
  getChannelAdmins: async (id: string): Promise<any[]> => {
    const res = await fetchWithAuth(`${API_URL}/channels/${id}/admins/`, { method: "GET", headers: authHeaders() });
    const d = await res.json();
    return d.admins || [];
  },
  setChannelAdmin: async (id: string, userId: string, action: "add" | "remove"): Promise<any> => {
    const res = await fetchWithAuth(`${API_URL}/channels/${id}/admins/`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ user_id: userId, action }) });
    return res.json();
  },
  /** Открыть плейлист по ссылке: вернёт ключ (повторный вызов — тот же). */
  sharePlaylist: async (id: string): Promise<string> => {
    const res = await fetchWithAuth(`${API_URL}/playlists/${id}/share/`, { method: "POST", headers: authHeaders() });
    if (!res.ok) throw new LError("Не удалось открыть доступ");
    return (await res.json()).share_token as string;
  },

  /** Закрыть доступ: прежняя ссылка перестанет работать. */
  unsharePlaylist: async (id: string): Promise<void> => {
    const res = await fetchWithAuth(`${API_URL}/playlists/${id}/share/`, { method: "DELETE", headers: authHeaders() });
    if (!res.ok && res.status !== 204) throw new LError("Не удалось закрыть доступ");
  },

  getSharedPlaylist: async (token: string): Promise<{ playlist: Playlist; owner: string; tracks: PlaylistTrack[] }> => {
    const res = await fetchWithAuth(`${API_URL}/playlists/shared/${token}/`, { method: "GET", headers: authHeaders() });
    if (!res.ok) throw new LError("Плейлист не найден или ссылка отозвана");
    return res.json();
  },

  /** Открытые плейлисты собеседников (по личке). */
  listPublicPlaylists: async (): Promise<PublicPlaylist[]> => {
    const res = await fetchWithAuth(`${API_URL}/playlists/public/`, { method: "GET", headers: authHeaders() });
    if (!res.ok) throw new LError("Не удалось загрузить плейлисты");
    return (await res.json()).playlists || [];
  },

  /** Запустил чужой плейлист — счётчик прослушиваний. token — ключ ссылки, если открыт по ней. */
  playlistPlayed: async (id: string, token?: string): Promise<PlaylistStats> => {
    const res = await fetchWithAuth(`${API_URL}/playlists/${id}/play/`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ token: token || undefined }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(body?.error || "Не получилось");
    return body;
  },
  /** Где я остановился в плейлисте (lib/playlistResume). */
  savePlaylistProgress: async (id: string, trackId: string, position: number, token?: string): Promise<void> => {
    const res = await fetchWithAuth(`${API_URL}/playlists/${id}/progress/`, { method: "PUT", headers: authHeaders(), body: JSON.stringify({ track_id: trackId, position, token: token || undefined }) });
    if (!res.ok) throw new LError("Не получилось");
  },
  /** Лайк чужого плейлиста (on=false — снять). */
  likePlaylist: async (id: string, on: boolean, token?: string): Promise<PlaylistStats> => {
    const res = await fetchWithAuth(`${API_URL}/playlists/${id}/like/`, { method: on ? "POST" : "DELETE", headers: authHeaders(), body: JSON.stringify({ token: token || undefined }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(body?.error || "Не получилось");
    return body;
  },

  getPublicPlaylist: async (id: string): Promise<{ playlist: Playlist; owner: string; owner_info?: PublicPlaylist["owner"]; tracks: PlaylistTrack[] }> => {
    const res = await fetchWithAuth(`${API_URL}/playlists/public/${id}/`, { method: "GET", headers: authHeaders() });
    if (!res.ok) throw new LError("Плейлист не найден или закрыт");
    return res.json();
  },

  /** Сохранить открытый плейлист собеседника себе копией. */
  savePublicPlaylist: async (id: string): Promise<Playlist> => {
    const res = await fetchWithAuth(`${API_URL}/playlists/public/${id}/`, { method: "POST", headers: authHeaders() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(data?.error || "Не удалось сохранить");
    return data.playlist;
  },

  /** Открыть свой плейлист собеседникам или снова сделать личным. */
  setPlaylistPublic: async (id: string, isPublic: boolean): Promise<Playlist> => {
    const res = await fetchWithAuth(`${API_URL}/playlists/${id}/`, {
      method: "PATCH", headers: authHeaders(), body: JSON.stringify({ is_public: isPublic }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(data?.error || "Не получилось");
    return data;
  },

  /** Мини-приложение: адрес и подписанные данные запуска для страницы бота. */
  webappInit: async (botId: string, opts: { url?: string; chatId?: string; startParam?: string } = {}): Promise<{
    url: string; init_data: string; query_id: string; title: string;
    bot: { id: string; username: string; avatar_url?: string | null };
  }> => {
    const res = await fetchWithAuth(`${API_URL}/webapp/init/`, {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify({ bot_id: botId, url: opts.url || undefined, chat_id: opts.chatId || undefined, start_param: opts.startParam || undefined }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(d?.error || "Не удалось открыть приложение");
    return d;
  },

  /** Каталог мини-приложений: все боты с приложением, популярные первыми. */
  listMiniApps: async (q = ""): Promise<MiniAppItem[]> => {
    const res = await fetchWithAuth(`${API_URL}/webapps/${q ? `?q=${encodeURIComponent(q)}` : ""}`, { method: "GET", headers: authHeaders() });
    if (!res.ok) throw new LError("Не удалось загрузить мини-приложения");
    return (await res.json()).apps || [];
  },

  /** Мини-приложение отправило боту данные (WYX.WebApp.sendData). */
  webappSendData: async (botId: string, initData: string, data: string): Promise<void> => {
    const res = await fetchWithAuth(`${API_URL}/webapp/data/`, {
      method: "POST", headers: authHeaders(), body: JSON.stringify({ bot_id: botId, init_data: initData, data }),
    });
    if (!res.ok) throw new LError((await res.json().catch(() => ({})))?.error || "Не удалось отправить данные боту");
  },

  /** Загрузить свой трек прямо в плейлист (без playlistId — в «Мою музыку»). */
  uploadTrack: async (file: File, playlistId?: string, opts?: { clientId?: string; onProgress?: (percent: number) => void }): Promise<{ track: PlaylistTrack; playlist: Playlist; repeat?: boolean }> => {
    const fd = new FormData();
    fd.append("file", file);
    // Метка загрузки: повтор после оборванного ответа сервер узнает и не
    // заведёт второй такой же трек (очередь lib/trackUploads.ts).
    if (opts?.clientId) fd.append("client_id", opts.clientId);
    if (opts?.onProgress) {
      const path = playlistId ? `/playlists/${playlistId}/tracks/upload/` : "/playlists/tracks/upload/";
      return uploadWithProgress(`${uploadBase()}${path}`, fd, opts.onProgress);
    }
    const url = playlistId ? `${API_URL}/playlists/${playlistId}/tracks/upload/` : `${API_URL}/playlists/tracks/upload/`;
    const res = await fetchWithAuthMultipart(url, { method: "POST", body: fd });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new LError(d.error || "Не удалось загрузить трек"), { status: res.status });
    return d;
  },

  /** Трек из своего плейлиста, открытого плейлиста собеседника, эфира или
   *  плейлиста по ссылке (shareToken) — в «Мою музыку» или в playlistId. */
  addTrackFromPublic: async (trackId: string, shareToken?: string, playlistId?: string): Promise<{ track: PlaylistTrack; playlist?: Playlist; already: boolean }> => {
    const url = playlistId ? `${API_URL}/playlists/${playlistId}/tracks/` : `${API_URL}/playlists/tracks/`;
    const res = await fetchWithAuth(url, {
      method: "POST", headers: authHeaders(), body: JSON.stringify({ track_id: trackId, token: shareToken || undefined }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(data?.error || "Не удалось добавить");
    return data;
  },

  /** Эфиры, которые мне видны, и каналы, от которых я могу вести эфир. */
  listStations: async (): Promise<{ stations: StationInfo[]; channels: { id: string; name: string; avatar_url?: string | null }[] }> => {
    const res = await fetchWithAuth(`${API_URL}/radio/`, { method: "GET", headers: authHeaders() });
    if (!res.ok) throw new LError("Не удалось загрузить эфиры");
    return res.json();
  },

  /** Запустить эфир своего плейлиста (от себя или от канала). */
  startStation: async (playlistId: string, channelId?: string): Promise<StationState> => {
    const res = await fetchWithAuth(`${API_URL}/radio/`, {
      method: "POST", headers: authHeaders(), body: JSON.stringify({ playlist_id: playlistId, channel_id: channelId || undefined }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(data?.error || "Не удалось запустить эфир");
    return data;
  },

  getStation: async (id: string): Promise<StationState> => {
    const res = await fetchWithAuth(`${API_URL}/radio/${id}/`, { method: "GET", headers: authHeaders() });
    if (!res.ok) throw new LError("Эфир закончился");
    return res.json();
  },

  /** «Я слушаю» — раз в 15 секунд; в ответ состояние эфира. */
  listenStation: async (id: string): Promise<StationState> => {
    const res = await fetchWithAuth(`${API_URL}/radio/${id}/listen/`, { method: "POST", headers: authHeaders() });
    if (!res.ok) {
      // 404 — эфира больше нет; остальное (сеть, 5xx) — повторим позже.
      const e = new LError("Эфир закончился") as Error & { gone?: boolean };
      e.gone = res.status === 404;
      throw e;
    }
    return res.json();
  },

  leaveStation: async (id: string): Promise<void> => {
    await fetchWithAuth(`${API_URL}/radio/${id}/listen/`, { method: "DELETE", headers: authHeaders() }).catch(() => undefined);
  },

  controlStation: async (id: string, action: "skip" | "pause" | "resume" | "shuffle", extra?: { on?: boolean }): Promise<StationState> => {
    const res = await fetchWithAuth(`${API_URL}/radio/${id}/control/`, {
      method: "POST", headers: authHeaders(), body: JSON.stringify({ action, ...extra }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(data?.error || "Не получилось");
    return data;
  },

  stopStation: async (id: string): Promise<void> => {
    const res = await fetchWithAuth(`${API_URL}/radio/${id}/`, { method: "DELETE", headers: authHeaders() });
    if (!res.ok && res.status !== 204) throw new LError("Не удалось остановить эфир");
  },

  /** Админ: снять файл по жалобе правообладателя — из всех плейлистов, эфиров и сообщений. */
  takedownTrack: async (trackId: string): Promise<{ tracks: number; messages: number }> => {
    const res = await fetchWithAuth(`${API_URL}/music/takedown/`, {
      method: "POST", headers: authHeaders(), body: JSON.stringify({ track_id: trackId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(data?.error || "Не получилось");
    return data;
  },

  /** Забрать чужой плейлист себе: создаётся свой, чужой не меняется. */
  savePlaylistCopy: async (token: string): Promise<Playlist> => {
    const res = await fetchWithAuth(`${API_URL}/playlists/shared/${token}/`, { method: "POST", headers: authHeaders() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(data?.error || "Не удалось сохранить");
    return data.playlist;
  },

  /** Отправить трек в чат обычным сообщением с файлом. */
  sendTrackToChat: async (chatId: string, track: { file_url: string; title: string }): Promise<void> => {
    const res = await fetchWithAuth(`${API_URL}/messages/`, {
      method: "POST", headers: authHeaders(),
      // Расширение — как у файла: m4a/flac под именем .mp3 не открываются у получателя.
      body: JSON.stringify({ chat: chatId, content: "", file_url: track.file_url, file_name: `${track.title}${(track.file_url.split("?")[0].match(/\.[a-z0-9]{2,5}$/i) || [".mp3"])[0]}` }),
    });
    if (!res.ok) throw new LError("Не удалось отправить");
  },

  /** Нажать кнопку под сообщением бота: data уходит боту событием. */
  /** Нажатие на кнопку бота. Наши боты («Долгий ящик») отвечают сразу:
   *  обновлённым сообщением, подсказкой или ссылкой. */
  pressButton: async (messageId: string, data: string): Promise<{ message?: any; toast?: string; toast_kind?: "success" | "error"; open?: string }> => {
    // caps: что умеет этот клиент — «Бездна» из чата бота открывает экран.
    const res = await fetchWithAuth(`${API_URL}/messages/${messageId}/press/`, {
      method: "POST", headers: authHeaders(), body: JSON.stringify({ data, caps: ["ideas_screen"] }),
    });
    if (!res.ok) {
      throw new LError((await res.json().catch(() => ({})))?.error || "Кнопка не сработала");
    }
    return res.json().catch(() => ({}));
  },

  // ===== ДЕЙСТВИЯ («подмигнуть», «обнять») =====
  getActions: async (): Promise<ChatActionInfo[]> => {
    const res = await fetchWithAuth(`${API_URL}/actions/`, { method: "GET", headers: authHeaders() });
    if (!res.ok) throw new LError(`HTTP ${res.status}`);
    return (await res.json()).actions || [];
  },
  /** Админ: весь каталог со скрытыми. */
  getAllActions: async (): Promise<ChatActionInfo[]> => {
    const res = await fetchWithAuth(`${API_URL}/actions/?all=1`, { method: "GET", headers: authHeaders() });
    if (!res.ok) throw new LError(`HTTP ${res.status}`);
    return (await res.json()).actions || [];
  },
  /** Админ: новое действие или правка (пустые переводы — переводчиком на сервере). */
  saveAction: async (id: number | null, data: ChatActionDraft): Promise<ChatActionInfo> => {
    const res = await fetchWithAuth(id ? `${API_URL}/actions/${id}/` : `${API_URL}/actions/`, {
      method: id ? "PATCH" : "POST", headers: authHeaders(), body: JSON.stringify(data),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(body?.error || "Не удалось сохранить");
    return body;
  },
  /** Отправить действие: в личке адресат — собеседник, в группе — target. */
  sendAction: async (chatId: string, actionId: number, targetId?: string): Promise<any> => {
    const res = await fetchWithAuth(`${API_URL}/messages/`, {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify({ chat: chatId, content: "", action_id: actionId, target_id: targetId || undefined }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(body?.error || "Не удалось отправить");
    return body;
  },

  // ===== СТЕНА (chat/wall.py) =====
  getWall: async (): Promise<WallState> => {
    const res = await fetchWithAuth(`${API_URL}/wall/`, { method: "GET", headers: authHeaders() });
    if (!res.ok) throw new LError(`HTTP ${res.status}`);
    return res.json();
  },
  setWallEnabled: async (enabled: boolean): Promise<WallState> => {
    const res = await fetchWithAuth(`${API_URL}/wall/`, { method: "PATCH", headers: authHeaders(), body: JSON.stringify({ enabled }) });
    if (!res.ok) throw new LError(`HTTP ${res.status}`);
    return res.json();
  },
  setWallTranslate: async (translate: boolean): Promise<WallState> => {
    const res = await fetchWithAuth(`${API_URL}/wall/`, { method: "PATCH", headers: authHeaders(), body: JSON.stringify({ translate }) });
    if (!res.ok) throw new LError(`HTTP ${res.status}`);
    return res.json();
  },
  markWallSeen: async (): Promise<void> => {
    await fetchWithAuth(`${API_URL}/wall/seen/`, { method: "POST", headers: authHeaders() }).catch(() => {});
  },
  /** Сверка кэша ленты: каких постов для меня больше нет (удалены, скрыты). */
  checkPosts: async (ids: string[], channelId?: string | null): Promise<string[]> => {
    if (!ids.length) return [];
    const url = channelId ? `${API_URL}/channels/${channelId}/posts/check/` : `${API_URL}/wall/posts/check/`;
    const res = await fetchWithAuth(url, { method: "POST", headers: authHeaders(), body: JSON.stringify({ ids }) });
    if (!res.ok) throw new LError(`HTTP ${res.status}`);
    return (await res.json()).gone || [];
  },

  getWallPosts: async (opts: { limit?: number; before?: string; since?: string } = {}): Promise<{ posts: any[]; deleted: string[]; has_more: boolean; now: string; authors?: { id: string; username: string; avatar_url?: string | null }[] }> => {
    const q = new URLSearchParams();
    if (opts.limit) q.set("limit", String(opts.limit));
    if (opts.before) q.set("before", opts.before);
    if (opts.since) q.set("since", opts.since);
    const res = await fetchWithAuth(`${API_URL}/wall/posts/${q.toString() ? `?${q}` : ""}`, { method: "GET", headers: authHeaders() });
    if (!res.ok) throw new LError(`HTTP ${res.status}`);
    return res.json();
  },
  muteWallAuthor: async (profileId: string, mute = true): Promise<WallState> => {
    const res = await fetchWithAuth(`${API_URL}/wall/mute/`, { method: mute ? "POST" : "DELETE", headers: authHeaders(), body: JSON.stringify({ profile_id: profileId }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(body?.error || "Не получилось");
    return body;
  },
  /** Не уведомлять о постах автора на Стене (mute=false — снова уведомлять). */
  muteWallNotify: async (profileId: string, mute = true): Promise<WallState> => {
    const res = await fetchWithAuth(`${API_URL}/wall/notify-mute/`, { method: mute ? "POST" : "DELETE", headers: authHeaders(), body: JSON.stringify({ profile_id: profileId }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(body?.error || "Не получилось");
    return body;
  },
  /** Репост поста своего канала на Стену. */
  repostToWall: async (messageId: string, wallSafe: boolean): Promise<any> => {
    const res = await fetchWithAuth(`${API_URL}/wall/repost/`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ message_id: messageId, wall_safe: wallSafe }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { const e: any = new LError(body?.error || "Не получилось"); e.body = body; throw e; }
    return body;
  },
  wallAdminPost: async (messageId: string, data: { hidden?: boolean; wall_safe?: boolean }): Promise<any> => {
    const res = await fetchWithAuth(`${API_URL}/wall/admin/posts/${messageId}/`, { method: "PATCH", headers: authHeaders(), body: JSON.stringify(data) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(body?.error || "Не получилось");
    return body;
  },
  getWallBans: async (): Promise<WallBanRow[]> => {
    const res = await fetchWithAuth(`${API_URL}/wall/admin/bans/`, { method: "GET", headers: authHeaders() });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(body?.error || "Не получилось");
    return body.bans || [];
  },
  banWallUser: async (profileId: string, hours: number | null, reason: string): Promise<WallBanRow> => {
    const res = await fetchWithAuth(`${API_URL}/wall/admin/bans/`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ profile_id: profileId, hours, reason }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(body?.error || "Не получилось");
    return body;
  },
  unbanWallUser: async (profileId: string): Promise<void> => {
    const res = await fetchWithAuth(`${API_URL}/wall/admin/bans/`, { method: "DELETE", headers: authHeaders(), body: JSON.stringify({ profile_id: profileId }) });
    if (!res.ok) throw new LError("Не получилось");
  },

  // ===== ВАЙБОМЕТР И ИДЕИ (chat/ideabox.py) =====
  getVibe: async (profileId: string): Promise<VibeState> => {
    const res = await fetchWithAuth(`${API_URL}/vibe/${profileId}/`, { method: "GET", headers: authHeaders() });
    if (!res.ok) throw new LError(`HTTP ${res.status}`);
    return res.json();
  },
  // ===== ПИТОМЦЫ (chat/pets.py, рисунки — public/pets/<вид>/) =====
  /** Питомец человека для карточки профиля (нет — null). */
  getPetOf: async (profileId: string): Promise<Pet | null> => {
    const res = await fetchWithAuth(`${API_URL}/pets/of/${profileId}/`, { method: "GET", headers: authHeaders() });
    if (!res.ok) throw new LError(`HTTP ${res.status}`);
    return (await res.json()).pet ?? null;
  },
  /** Питомцы во всех моих чатах (у каждого — chat_id): кот в ленте и лапка в списке чатов. */
  getPetsHere: async (): Promise<PetBrief[]> => {
    const res = await fetchWithAuth(`${API_URL}/pets/here/`, { method: "GET", headers: authHeaders() });
    if (!res.ok) throw new LError(`HTTP ${res.status}`);
    return (await res.json()).pets ?? [];
  },
  /** Покормить или погладить: раз в сутки от человека (+1 к вайбу). Рано — ошибка с next_care_at и pet. */
  /** Завести питомца (chat/pets.py PetGrantView): себе — свой profile_id, стартовые — всем. */
  grantPet: async (profileId: string, species: string): Promise<Pet> => {
    const res = await fetchWithAuth(`${API_URL}/pets/grant/`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ profile_id: profileId, species }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError((data as { error?: string }).error || `HTTP ${res.status}`);
    return (data as { pet: Pet }).pet;
  },

  carePet: async (petId: string, action: PetAction): Promise<{ pet: Pet; vibe: number; vibe_gain: number }> => {
    const res = await fetchWithAuth(`${API_URL}/pets/${petId}/care/`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ action }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new LError(data?.error || "Не получилось"), { status: res.status, pet: data?.pet as Pet | undefined, nextCareAt: data?.next_care_at as string | undefined });
    return data;
  },
  /** Свой питомец: кличка; позвать в чат (chat_id) или домой (chat_id: null). */
  /** Отпустить своего питомца насовсем (chat/pets.py MyPetView.delete). */
  deleteMyPet: async (): Promise<void> => {
    const res = await fetchWithAuth(`${API_URL}/pets/mine/`, { method: "DELETE", headers: authHeaders() });
    if (!res.ok && res.status !== 404) {
      const data = await res.json().catch(() => ({}));
      throw new LError((data as { error?: string }).error || `HTTP ${res.status}`);
    }
  },

  updateMyPet: async (patch: { name?: string; show_in_chats?: boolean; chat_id?: string | null; color?: string; sex?: "m" | "f"; accessories?: string[] | null; species?: string }): Promise<Pet> => {
    const res = await fetchWithAuth(`${API_URL}/pets/mine/`, { method: "PATCH", headers: authHeaders(), body: JSON.stringify(patch) });
    const data = await res.json().catch(() => ({}));
    // 409: в группе нет мест (code=pets_full, limit, pets — кто уже здесь) или питомцы выключены (pets_off).
    if (!res.ok) throw Object.assign(new LError(data?.error || "Не получилось"), { code: data?.code as string | undefined, limit: data?.limit as number | undefined, pets: data?.pets as { name: string; species: string; owner: { username: string } }[] | undefined });
    return data.pet;
  },
  /** Домой: хозяин — своего, владелец группы — любого питомца в ней. */
  sendPetHome: async (petId: string): Promise<Pet> => {
    const res = await fetchWithAuth(`${API_URL}/pets/${petId}/home/`, { method: "POST", headers: authHeaders() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(data?.error || "Не получилось");
    return data.pet;
  },

  /** Кто и за что поднимал мой вайб (и что снимало) — от новых к старым. */
  vibeHistory: async (): Promise<VibeHistory> => {
    const res = await fetchWithAuth(`${API_URL}/vibe/history/`, { method: "GET", headers: authHeaders() });
    if (!res.ok) throw new LError("Не удалось загрузить историю вайба");
    return res.json();
  },
  getVibeLevels: async (): Promise<VibeLevelsConfig> => {
    const res = await fetchWithAuth(`${API_URL}/vibe-levels/`, { method: "GET", headers: authHeaders() });
    if (!res.ok) throw new LError(`HTTP ${res.status}`);
    return res.json();
  },
  saveVibeLevels: async (cfg: VibeLevelsConfig): Promise<VibeLevelsConfig> => {
    const res = await fetchWithAuth(`${API_URL}/vibe-levels/`, { method: "PUT", headers: authHeaders(), body: JSON.stringify(cfg) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(body?.error || "Не удалось сохранить");
    return body;
  },
  /** Поднять вайб владельцу за его сохранёнку (раз на картинку). */
  raiseSavedVibe: async (savedId: string): Promise<{ vibes: number; vibed: boolean; vibe?: number }> => {
    const res = await fetchWithAuth(`${API_URL}/saved-images/${savedId}/vibe/`, { method: "POST", headers: authHeaders() });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { const e: any = new LError(body?.error || "Не получилось"); if ("vibes" in body) e.state = body; e.status = res.status; throw e; }
    return body;
  },
  raiseVibe: async (profileId: string, anonymous = false): Promise<VibeState> => {
    const res = await fetchWithAuth(`${API_URL}/vibe/${profileId}/`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ anonymous }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { const e: any = new LError(body?.error || "Не получилось"); if ("vibe" in body) e.state = body; throw e; }
    return body;
  },
  /** Поиск по сообщениям: по всем моим чатам или в одном (chat); before — курсор «старее». */
  searchMessages: async (q: string, opts?: { chat?: string; before?: string; limit?: number }): Promise<{ items: MessageHit[]; has_more: boolean }> => {
    const p = new URLSearchParams({ q });
    if (opts?.chat) p.set("chat", opts.chat);
    if (opts?.before) p.set("before", opts.before);
    if (opts?.limit) p.set("limit", String(opts.limit));
    const res = await fetchWithAuth(`${API_URL}/messages/search/?${p}`, { method: "GET", headers: authHeaders() });
    const body = await res.json().catch(() => ({}));
    // 404 — сервер старее клиента, поиска там ещё нет.
    if (!res.ok) throw new LError(res.status === 404 ? "Поиск сейчас недоступен" : body?.error || "Не удалось найти");
    return body;
  },
  /** Админ: шаблоны причин начисления и само начисление (или снятие) с причиной. */
  getVibeReasons: async (): Promise<{ items: VibeReason[] }> => {
    const res = await fetchWithAuth(`${API_URL}/vibe-reasons/`, { method: "GET", headers: authHeaders() });
    if (!res.ok) throw new LError("Не удалось загрузить шаблоны");
    return res.json();
  },
  saveVibeReason: async (r: { id?: number; name: string; points: number }): Promise<{ item: VibeReason; items: VibeReason[] }> => {
    const res = await fetchWithAuth(`${API_URL}/vibe-reasons/`, { method: "POST", headers: authHeaders(), body: JSON.stringify(r) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(body?.error || "Не удалось сохранить шаблон");
    return body;
  },
  deleteVibeReason: async (id: number): Promise<{ items: VibeReason[] }> => {
    const res = await fetchWithAuth(`${API_URL}/vibe-reasons/`, { method: "DELETE", headers: authHeaders(), body: JSON.stringify({ id }) });
    if (!res.ok) throw new LError("Не удалось удалить шаблон");
    return res.json();
  },
  adjustVibe: async (profileId: string, data: { points?: number; reason?: string; template_id?: number }): Promise<{ vibe: number; item: VibeEvent }> => {
    const res = await fetchWithAuth(`${API_URL}/vibe/${profileId}/adjust/`, { method: "POST", headers: authHeaders(), body: JSON.stringify(data) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(body?.error || "Не получилось");
    return body;
  },
  createIdea: async (text: string): Promise<{ idea: IdeaItem }> => {
    const res = await fetchWithAuth(`${API_URL}/ideas/`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ text }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(body?.error || "Не удалось отправить");
    return body;
  },
  getIdeas: async (sort: "top" | "new" | "done" | "mine", page: number, size = 20): Promise<IdeasPage> => {
    const res = await fetchWithAuth(`${API_URL}/ideas/?sort=${sort}&page=${page}&size=${size}`, { method: "GET", headers: authHeaders() });
    if (!res.ok) throw new LError(`HTTP ${res.status}`);
    return res.json();
  },
  ideaAction: async (ideaId: string, act: "vote" | "done" | "hide" | "report", value?: 1 | -1): Promise<{ idea?: IdeaItem; my_vibe?: number; ok?: boolean }> => {
    const res = await fetchWithAuth(`${API_URL}/ideas/${ideaId}/${act}/`, {
      method: "POST", headers: authHeaders(), body: JSON.stringify(value ? { value } : {}),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(body?.error || "Не получилось");
    return body;
  },

  /** Поставить или снять реакцию на сообщение. Повторное нажатие снимает.
   *  409 — упёрлись в предел разных реакций на человека. */
  reactToMessage: async (messageId: string, emoji: string): Promise<{ reactions: ReactionSummary[] }> => {
    const res = await fetchWithAuth(`${API_URL}/messages/${messageId}/react/`, {
      method: "POST", headers: authHeaders(), body: JSON.stringify({ emoji }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(data?.error || "Не удалось поставить реакцию");
    return data;
  },

  reactToPost: async (msgId: string, value: string): Promise<any> => {
    const res = await fetchWithAuth(`${API_URL}/posts/${msgId}/react/`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ value }) });
    return res.json();
  },
  /** Опрос поста (backend chat/polls.py): голос или новый выбор, отзыв, кто голосовал. */
  votePoll: async (postId: string, optionId: string): Promise<{ poll: PollInfo }> => {
    const res = await fetchWithAuth(`${API_URL}/posts/${postId}/poll/`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ option: optionId }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(body?.error || "Не удалось проголосовать");
    return body;
  },
  unvotePoll: async (postId: string): Promise<{ poll: PollInfo }> => {
    const res = await fetchWithAuth(`${API_URL}/posts/${postId}/poll/`, { method: "DELETE", headers: authHeaders() });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(body?.error || "Не удалось отменить голос");
    return body;
  },
  pollVoters: async (postId: string, optionId: string): Promise<{ count: number; voters: { id: string; username: string; avatar_url?: string | null }[] }> => {
    const res = await fetchWithAuth(`${API_URL}/posts/${postId}/poll/voters/?option=${encodeURIComponent(optionId)}`, { method: "GET", headers: authHeaders() });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(body?.error || "Не удалось загрузить");
    return body;
  },
  unreactPost: async (msgId: string): Promise<any> => {
    const res = await fetchWithAuth(`${API_URL}/posts/${msgId}/react/`, { method: "DELETE", headers: authHeaders() });
    return res.json();
  },
  getPostComments: async (msgId: string): Promise<any[]> => {
    const res = await fetchWithAuth(`${API_URL}/posts/${msgId}/comments/`, { method: "GET", headers: authHeaders() });
    const d = await res.json();
    return d.comments || [];
  },
  /** file — вложение комментария (фото или музыка), загруженное через uploadFile. */
  addPostComment: async (msgId: string, content: string, parent?: string,
    file?: { file_url: string; file_name: string; file_kind: "image" | "audio"; file_size?: number; file_width?: number | null; file_height?: number | null }): Promise<any> => {
    const res = await fetchWithAuth(`${API_URL}/posts/${msgId}/comments/`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ content, parent, ...(file || {}) }) });
    const d = await res.json();
    if (!res.ok) throw new LError(d.error || "Ошибка");
    return d;
  },
  deletePostComment: async (commentId: string): Promise<void> => {
    const res = await fetchWithAuth(`${API_URL}/posts/comments/${commentId}/`, { method: "DELETE", headers: authHeaders() });
    if (!res.ok) throw new LError((await res.json().catch(() => ({})))?.error || "Не удалось удалить комментарий");
  },
  markPostView: async (msgId: string): Promise<void> => {
    await fetchWithAuth(`${API_URL}/posts/${msgId}/view/`, { method: "POST", headers: authHeaders() }).catch(() => {});
  },

  // ===== MESSAGES =====
  /** Лента постранично и приращениями (см. messageCache.ts). since — всё,
   *  что менялось после (плюс id удалённых у всех); before — страница старее. */
  syncMessages: async (
    chatId: string,
    opts: { since?: string; before?: string; after?: string; limit?: number; around?: string } = {},
  ): Promise<{ messages: any[]; deleted: string[]; has_more: boolean; has_newer?: boolean; now: string; authors?: { id: string; username: string; avatar_url?: string | null }[] }> => {
    const q = new URLSearchParams({ chat: chatId });
    if (opts.since) q.set("since", opts.since);
    if (opts.before) q.set("before", opts.before);
    // after — страница новее (листаем вниз из окна вокруг найденного).
    if (opts.after) q.set("after", opts.after);
    // around — окно вокруг сообщения: переход к закреплённому одним запросом.
    if (opts.around) q.set("around", opts.around);
    if (opts.limit) q.set("limit", String(opts.limit));
    const res = await fetchWithAuth(`${API_URL}/messages/sync/?${q.toString()}`, { headers: authHeaders() });
    if (!res.ok) throw new LError(`sync failed: ${res.status}`);
    return res.json();
  },

  /** «Медиа и файлы» чата: раздел, новые первыми; counts — в первой странице. */
  getChatMedia: async (chatId: string, type: MediaKind, before?: string): Promise<{ results: any[]; has_more: boolean; counts?: Record<MediaKind, number> }> => {
    const q = new URLSearchParams({ chat: chatId, type });
    if (before) q.set("before", before);
    const res = await fetchWithAuth(`${API_URL}/messages/media/?${q}`, { method: "GET", headers: authHeaders() });
    if (!res.ok) throw new LError("Не удалось загрузить");
    return res.json();
  },
  getMessages: async (chatId: string): Promise<any[]> => {
    const res = await fetchWithAuth(`${API_URL}/messages/?chat=${chatId}`, {
      method: "GET",
      headers: authHeaders(),
    });
    return res.json();
  },

  sendMessage: async (chatId: string, content: string, soundId?: string, replyToId?: string, entities?: { type: string; offset: number; length: number }[], extra?: Record<string, unknown>): Promise<any> => {
    const res = await fetchWithAuth(`${API_URL}/messages/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ chat: chatId, content, sound_id: soundId || undefined, reply_to_id: replyToId || undefined, entities: entities?.length ? entities : undefined, ...(extra || {}) }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { const e: any = new LError(body?.error || `HTTP ${res.status}`); e.body = body; throw e; }
    return body;
  },

  // ===== ОТЛОЖЕННЫЕ =====
  listScheduled: async (chatId: string): Promise<ScheduledItem[]> => {
    const res = await fetchWithAuth(`${API_URL}/scheduled/?chat=${chatId}`, { method: "GET", headers: authHeaders() });
    if (!res.ok) return [];
    return (await res.json()).scheduled || [];
  },
  scheduleMessage: async (body: { chat: string; send_at: string; content: string; entities?: unknown[]; reply_to_id?: string; reply_quote?: string; silent?: boolean }): Promise<ScheduledItem> => {
    const res = await fetchWithAuth(`${API_URL}/scheduled/`, { method: "POST", headers: authHeaders(), body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(data?.error || "Не удалось отложить сообщение");
    return data;
  },
  rescheduleMessage: async (id: string, sendAt: string): Promise<ScheduledItem> => {
    const res = await fetchWithAuth(`${API_URL}/scheduled/${id}/`, { method: "PATCH", headers: authHeaders(), body: JSON.stringify({ send_at: sendAt }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(data?.error || "Не удалось перенести");
    return data;
  },
  deleteScheduled: async (id: string): Promise<void> => {
    const res = await fetchWithAuth(`${API_URL}/scheduled/${id}/`, { method: "DELETE", headers: authHeaders() });
    if (!res.ok && res.status !== 204) throw new LError((await res.json().catch(() => ({})))?.error || "Не удалось удалить");
  },
  sendScheduledNow: async (id: string): Promise<{ ok: boolean; message_id: string }> => {
    const res = await fetchWithAuth(`${API_URL}/scheduled/${id}/send/`, { method: "POST", headers: authHeaders(), body: "{}" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(data?.error || "Не удалось отправить");
    return data;
  },

  // ===== MESSAGE READ STATUS =====
  markMessageAsRead: async (messageId: string): Promise<void> => {
    const res = await fetchWithAuth(`${API_URL}/messages/${messageId}/mark_as_read/`, {
      method: "POST",
      headers: authHeaders(),
    });
    if (!res.ok) throw new LError("Failed to mark message as read");
    return res.json();
  },

  markChatAsRead: async (chatId: string): Promise<void> => {
    const res = await fetchWithAuth(`${API_URL}/messages/mark_chat_as_read/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ chat_id: chatId }),
    });
    if (!res.ok) throw new LError("Failed to mark chat as read");
    return res.json();
  },

  /** «Долгий ящик» — чат с ботом для идей (создаётся при первом заходе). */
  getIdeabox: async (): Promise<Chat> => {
    const res = await fetchWithAuth(`${API_URL}/ideabox/`, { method: "GET", headers: authHeaders() });
    if (!res.ok) throw new LError("Не удалось открыть долгий ящик");
    return res.json();
  },

  /** Секретный чат: создать (своя открытая половина ключа) и принять/отклонить. */
  createSecretChat: async (peerId: string, pub: string, deviceId: string): Promise<Chat> => {
    const res = await fetchWithAuth(`${API_URL}/secret-chats/`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ peer_id: peerId, pub, device_id: deviceId }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(d.error || "Не удалось создать секретный чат");
    return d;
  },
  acceptSecretChat: async (chatId: string, pub: string, deviceId: string): Promise<void> => {
    const res = await fetchWithAuth(`${API_URL}/secret-chats/${chatId}/accept/`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ pub, device_id: deviceId }) });
    if (!res.ok) throw new LError((await res.json().catch(() => ({}))).error || "Не удалось принять");
  },
  declineSecretChat: async (chatId: string): Promise<void> => {
    await fetchWithAuth(`${API_URL}/secret-chats/${chatId}/decline/`, { method: "POST", headers: authHeaders() });
  },
  /** Сообщение в секретный чат — только шифротекст (lib/secret.ts). */
  sendSecretMessage: async (chatId: string, cipher: string, replyToId?: string, file?: { file_url: string; file_size: number }): Promise<any> => {
    const res = await fetchWithAuth(`${API_URL}/messages/`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ chat: chatId, cipher, reply_to_id: replyToId || undefined, ...(file || {}) }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(d.error || "Не удалось отправить");
    return d;
  },
  editSecretMessage: async (messageId: string, cipher: string): Promise<any> => {
    const res = await fetchWithAuth(`${API_URL}/messages/${messageId}/edit/`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ cipher }) });
    if (!res.ok) throw new LError("Не удалось изменить");
    return res.json();
  },

  getAdminRegistrations: async (from: string, to: string, tzOffsetMin: number): Promise<{
    from: string; to: string; count: number; unit?: "day" | "month"; days: { date: string; count: number }[]; users: { username: string; created_at: string }[];
  }> => {
    const res = await fetchWithAuth(`${API_URL}/admin/registrations/?from=${from}&to=${to}&tz=${tzOffsetMin}`, { method: "GET", headers: authHeaders() });
    if (!res.ok) throw new LError(res.status === 403 ? "403" : `HTTP ${res.status}`);
    return res.json();
  },

  getAdminMetrics: async (range: string, tzOffsetMin: number): Promise<AdminMetrics> => {
    const res = await fetchWithAuth(`${API_URL}/admin/metrics/?range=${encodeURIComponent(range)}&tz=${tzOffsetMin}`, { method: "GET", headers: authHeaders() });
    if (res.status === 403) throw new LError("403");
    if (!res.ok) throw new LError(`HTTP ${res.status}`);
    return res.json();
  },

  /** Живой перевод текста (расширение «WYX Переводчик», TranslatorHost): в
   *  нужную сторону между моим языком `to` и языком собеседника `other`;
   *  from — исходный язык, если закреплён (chat/live.py LiveTextView). */
  liveText: async (opts: { text: string; to: string; other?: string; from?: string }): Promise<LiveTextResult> => {
    const res = await fetchWithAuth(`${API_URL}/live/text/`, {
      method: "POST", headers: authHeaders(), body: JSON.stringify(opts),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(data?.error || "Не удалось перевести");
    return data;
  },

  getUnreadCount: async (): Promise<UnreadCountResponse> => {
    const res = await fetchWithAuth(`${API_URL}/messages/unread_count/`, {
      method: "GET",
      headers: authHeaders(),
    });
    if (!res.ok) throw new LError("Failed to get unread count");
    return res.json();
  },

  // ===== FRIENDSHIPS =====
  getFriends: async (): Promise<Profile[]> => {
    const res = await fetchWithAuth(`${API_URL}/friendships/`, {
      method: "GET",
      headers: authHeaders(),
    });
    return res.json();
  },

  deleteChat: async (chatId: string): Promise<void> => {
    const res = await fetchWithAuth(`${API_URL}/chats/${chatId}/`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    if (!res.ok) throw new LError("Failed to delete chat");
  },

  /** Удалить человека из группы (только владелец). */
  /** Назначить админа группы или поменять его права (lib/groupRights). */
  setGroupAdmin: async (chatId: string, userId: string, rights: string[]): Promise<{ group_role: string; group_rights: string[] }> => {
    const res = await fetchWithAuth(`${API_URL}/chats/${chatId}/set_admin/`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ user_id: userId, rights }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(body?.error || "Не получилось");
    return body;
  },
  /** Снять админа группы. */
  removeGroupAdmin: async (chatId: string, userId: string): Promise<void> => {
    const res = await fetchWithAuth(`${API_URL}/chats/${chatId}/remove_admin/`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ user_id: userId }) });
    if (!res.ok) throw new LError((await res.json().catch(() => ({})))?.error || "Не получилось");
  },
  removeGroupMember: async (chatId: string, userId: string): Promise<void> => {
    const res = await fetchWithAuth(`${API_URL}/chats/${chatId}/remove_participant/`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ user_id: userId }) });
    if (!res.ok) throw new LError((await res.json().catch(() => ({})))?.error || "Не получилось");
  },
  /** Принять запрос на переписку — вернёт чат уже без pending_for. */
  acceptChatRequest: async (chatId: string): Promise<Chat> => {
    const res = await fetchWithAuth(`${API_URL}/chats/${chatId}/accept_request/`, { method: "POST", headers: authHeaders() });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(body?.error || "Не получилось");
    return body;
  },
  /** Отклонить запрос: чат удаляется у обоих. */
  declineChatRequest: async (chatId: string): Promise<void> => {
    const res = await fetchWithAuth(`${API_URL}/chats/${chatId}/decline_request/`, { method: "POST", headers: authHeaders() });
    if (!res.ok) throw new LError((await res.json().catch(() => ({})))?.error || "Не получилось");
  },

  leaveChat: async (chatId: string): Promise<void> => {
    const res = await fetchWithAuth(`${API_URL}/chats/${chatId}/leave/`, {
      method: "POST",
      headers: authHeaders(),
    });
    if (!res.ok) throw new LError("Failed to leave chat");
  },

  addFriend: async (friendId: string): Promise<any> => {
    const res = await fetchWithAuth(`${API_URL}/friendships/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ to_user: friendId }),
    });
    return res.json();
  },
// ===== FILE UPLOAD =====
  uploadFile: async (
    file: File,
    compress?: string,
    onProgress?: (percent: number) => void,
    local?: boolean,
    /** Отмена (крестик у полоски загрузки) — промис отклоняется, isUploadCancelled. */
    signal?: AbortSignal,
  ): Promise<{ file_url: string; file_name: string; file_size: number; width?: number | null; height?: number | null; poster_url?: string | null; preview?: string | null }> => {
    // Большой файл — кусками: одним запросом его обрывает шлюз CDN.
    if (file.size > CHUNK_MIN) {
      const extra: Record<string, string> = {};
      if (compress) extra.compress = compress;
      if (local) extra.local = '1';
      return uploadInChunks(file, extra, onProgress, signal);
    }

    const formData = new FormData();
    formData.append('file', file);
    if (compress) formData.append('compress', compress);
    if (local) formData.append('local', '1');
    if (onProgress || signal) {
      return uploadWithProgress(`${uploadBase()}/upload/`, formData, onProgress, signal);
    }

    const res = await fetchWithAuthMultipart(`${uploadBase()}/upload/`, {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error("Upload error:", errorText);
      throw new LError(`File upload failed: ${res.status} ${res.statusText}`);
    }

    return res.json();
  },

  sendMessageWithFile: async (chatId: string, fileData: {
    file_url: string;
    file_name: string;
    file_size: number;
    width?: number | null;
    height?: number | null;
    /** Кадр-превью видео с сервера (ответ upload). */
    poster_url?: string | null;
    /** Микропревью картинки (data-URI из ответа upload) — размытая заглушка в ленте. */
    file_preview?: string | null;
    /** Трек из своего плейлиста: сервер возьмёт файл у него, без загрузки. */
    playlist_track_id?: string;
    /** Общий id для фото/видео, отправленных одним альбомом. */
    album_id?: string | null;
    /** Оформление подписи (см. lib/format.tsx). */
    entities?: { type: string; offset: number; length: number }[];
  }, content?: string, soundId?: string, replyToId?: string, downloadOnly?: boolean, extra?: Record<string, unknown>): Promise<any> => {
    const res = await fetchWithAuth(`${API_URL}/messages/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        ...(extra || {}),
        chat: chatId,
        content: content || null,
        file_url: fileData.file_url,
        file_name: fileData.file_name,
        file_size: fileData.file_size,
        file_width: fileData.width || undefined,
        file_height: fileData.height || undefined,
        poster_url: fileData.poster_url || undefined,
        file_preview: fileData.file_preview || undefined,
        playlist_track_id: fileData.playlist_track_id || undefined,
        album_id: fileData.album_id || undefined,
        entities: content && fileData.entities?.length ? fileData.entities : undefined,
        sound_id: soundId || undefined,
        reply_to_id: replyToId || undefined,
        download_only: downloadOnly ? "1" : undefined
      }),
    });
    return res.json();
  },

  // ===== ГОЛОСОВЫЕ СООБЩЕНИЯ =====
  uploadVoice: async (file: File, onProgress?: (percent: number) => void): Promise<{ file_url: string; file_name: string }> => {
    const formData = new FormData();
    formData.append("file", file);
    if (onProgress) return uploadWithProgress(`${uploadBase()}/voice/upload/`, formData, onProgress);
    const res = await fetchWithAuthMultipart(`${uploadBase()}/voice/upload/`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) throw new LError(`Voice upload failed: ${res.status}`);
    return res.json();
  },

  /** Расшифровка голосового: сервер ставит задачу и отвечает сразу (transcript_status
   *  pending), готовый текст приезжает через sync по updated_at. */
  transcribeVoice: async (messageId: string): Promise<any> => {
    const res = await fetchWithAuth(`${API_URL}/messages/${messageId}/transcribe/`, {
      method: "POST", headers: authHeaders(),
    });
    if (!res.ok) throw new LError("Не удалось расшифровать");
    return res.json();
  },

  sendMessageWithVoice: async (chatId: string, voiceUrl: string, duration: number, replyToId?: string): Promise<any> => {
    const res = await fetchWithAuth(`${API_URL}/messages/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ chat: chatId, voice_url: voiceUrl, voice_duration: duration, reply_to_id: replyToId || undefined }),
    });
    if (!res.ok) throw new LError("Не удалось отправить голосовое");
    return res.json();
  },

  // Настройки группы (название, аватар) — только для админа-создателя.
  configureGroup: async (chatId: string, data: { name?: string; avatarUrl?: string; notifySoundId?: string | null; petLimit?: number }): Promise<ChatInfo> => {
    const body: Record<string, string | number | null> = {};
    if (data.petLimit !== undefined) body.pet_limit = data.petLimit;
    if (data.name !== undefined) body.name = data.name;
    if (data.avatarUrl !== undefined) body.avatar_url = data.avatarUrl;
    // Общий звук группы: с ним все её сообщения приходят всем участникам.
    if (data.notifySoundId !== undefined) body.notify_sound_id = data.notifySoundId;
    const res = await fetchWithAuth(`${API_URL}/chats/${chatId}/configure/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new LError(e.error || "Не удалось сохранить группу");
    }
    return res.json();
  },

  addChatParticipants: async (chatId: string, participantIds: string[]): Promise<any> => {
    const res = await fetchWithAuth(`${API_URL}/chats/${chatId}/add_participants/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ participants: participantIds }),
    });
    if (!res.ok) throw new LError("Не удалось добавить участников");
    return res.json();
  },

  removeMessage: async (messageId: string, scope: "me" | "all"): Promise<void> => {
    const res = await fetchWithAuth(`${API_URL}/messages/${messageId}/remove/`, {
      method: "POST", headers: authHeaders(), body: JSON.stringify({ scope }),
    });
    if (!res.ok) throw new LError("Не удалось удалить");
  },

  editMessage: async (messageId: string, content: string, entities?: { type: string; offset: number; length: number }[]): Promise<any> => {
    const res = await fetchWithAuth(`${API_URL}/messages/${messageId}/edit/`, {
      method: "POST", headers: authHeaders(), body: JSON.stringify({ content, entities: entities || [] }),
    });
    // Причину отказа — человеку: «только в первые сутки», «опрос нельзя изменить».
    if (!res.ok) throw new LError((await res.json().catch(() => ({})))?.error || "Не удалось изменить");
    return res.json();
  },

  sendMessageWithVideo: async (chatId: string, videoUrl: string, duration: number, mirror?: boolean, replyToId?: string, flip?: boolean, extra?: Record<string, unknown>): Promise<any> => {
    const res = await fetchWithAuth(`${API_URL}/messages/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ chat: chatId, video_url: videoUrl, video_duration: duration, video_mirror: mirror ? "1" : undefined, video_flip: flip ? "1" : undefined, reply_to_id: replyToId || undefined, ...(extra || {}) }),
    });
    if (!res.ok) throw new LError("Не удалось отправить видео-сообщение");
    return res.json();
  },

  // ===== ЗВОНКИ =====
  // ICE-серверы (STUN + TURN с кредами) приходят с сервера — в сборке ничего
  // секретного, и TURN можно поменять без релиза.
  getIceServers: async (): Promise<RTCIceServer[]> => {
    try {
      const res = await fetchWithAuth(`${API_URL}/ice-servers/`, {
        method: "GET",
        headers: authHeaders(),
      });
      if (!res.ok) throw new LError(String(res.status));
      const data = await res.json();
      return data.iceServers || [];
    } catch {
      return [{ urls: "stun:stun.l.google.com:19302" }];
    }
  },

  /** Ключ трансляции звонка в OBS (lib/obsRelay.ts); renew — новый, старые ссылки перестают работать. */
  obsKey: async (renew = false): Promise<string> => {
    if (!renew) {
      const res = await fetchWithAuth(`${API_URL}/obs/key/`, { method: "GET", headers: authHeaders() });
      if (!res.ok) throw new LError("Не удалось получить ссылку для OBS");
      const key = (await res.json()).key as string | null;
      if (key) return key;
    }
    const res = await fetchWithAuth(`${API_URL}/obs/key/`, { method: "POST", headers: authHeaders() });
    if (!res.ok) throw new LError("Не удалось получить ссылку для OBS");
    return (await res.json()).key as string;
  },

  // ===== ЗВУКИ УВЕДОМЛЕНИЙ (аудио-стикеры) =====
  // Временная подписанная ссылка на приватное вложение (S3). Маркер s3://key.
  signMedia: async (marker: string): Promise<string> => {
    const key = marker.replace(/^s3:\/\//, "");
    const res = await fetchWithAuth(`${API_URL}/media/sign/?key=${encodeURIComponent(key)}`, {
      method: "GET",
      headers: authHeaders(),
    });
    if (!res.ok) throw new LError("sign failed");
    const d = await res.json();
    return d.url as string;
  },

  getNotificationSounds: async (): Promise<NotificationSoundInfo[]> => {
    const res = await fetchWithAuth(`${API_URL}/sounds/`, {
      method: "GET",
      headers: authHeaders(),
    });
    if (!res.ok) return [];
    return res.json();
  },

  // ===== СТИКЕРЫ =====
  // Перенесено из веб-версии: бэкенд стикеры поддерживает давно, в мобильном
  // приложении их просто не было.
  getMyStickerPacks: async (): Promise<any[]> => {
    const res = await fetchWithAuth(`${API_URL}/sticker-packs/my_packs/`, {
      method: "GET",
      headers: authHeaders(),
    });
    if (!res.ok) throw new LError("Failed to load sticker packs");
    return res.json();
  },

  /** «Недавние»: стикеры, которые я отправляю чаще всего (сервер считает по моим сообщениям). */
  getRecentStickers: async (): Promise<any[]> => {
    const res = await fetchWithAuth(`${API_URL}/stickers/recent/`, { method: "GET", headers: authHeaders() });
    if (!res.ok) throw new LError("Failed to load stickers");
    return (await res.json()).stickers || [];
  },
  getStickers: async (packId?: string): Promise<any[]> => {
    const url = packId ? `${API_URL}/stickers/?pack=${packId}` : `${API_URL}/stickers/`;
    const res = await fetchWithAuth(url, {
      method: "GET",
      headers: authHeaders(),
    });
    if (!res.ok) throw new LError("Failed to load stickers");
    return res.json();
  },

  /** Геопозиция: текст и ссылку на карту сервер подставит сам. */
  sendLocation: async (chatId: string, lat: number, lng: number, replyToId?: string): Promise<any> => {
    const res = await fetchWithAuth(`${API_URL}/messages/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ chat: chatId, geo_lat: lat, geo_lng: lng, reply_to_id: replyToId || undefined }),
    });
    if (!res.ok) throw new LError((await res.json().catch(() => ({})))?.error || "Не удалось отправить");
    return res.json();
  },

  /** Эффекты получения (глюк-стикеры) разыграны — сервер запомнит для всех моих устройств. */
  markEffectsSeen: async (ids: string[]): Promise<void> => {
    const res = await fetchWithAuth(`${API_URL}/messages/effects_seen/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ ids }),
    });
    if (!res.ok) throw new LError("Failed to mark effects");
  },

  sendMessageWithSticker: async (chatId: string, stickerId: string, content?: string, replyToId?: string, effect?: string): Promise<any> => {
    const res = await fetchWithAuth(`${API_URL}/messages/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        chat: chatId,
        content: content || null,
        sticker_id: stickerId,
        reply_to_id: replyToId || undefined,
        effect: effect || undefined,
      }),
    });
    if (!res.ok) throw new LError("Failed to send sticker");
    return res.json();
  },


  // Создание наборов прямо в приложении: сначала файл уходит на сервер и
  // возвращает ссылку, затем стикер привязывается к набору.
  /** kind=emoji — картинка своего эмодзи: сервер ужмёт до 100 px. */
  uploadSticker: async (file: File, kind?: "emoji"): Promise<{ file_url: string; file_name: string }> => {
    const formData = new FormData();
    formData.append("file", file);
    if (kind) formData.append("kind", kind);
    const res = await fetchWithAuthMultipart(`${uploadBase()}/stickers/upload/`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) throw new LError((await res.json().catch(() => ({})))?.error || "Не удалось загрузить файл стикера");
    return res.json();
  },

  /** Граффити (backend chat/graffiti.py): PNG рисунка → стикер в паке «Мои граффити». */
  saveGraffiti: async (png: Blob): Promise<{ id: string; pack: string; file_url: string; emoji?: string }> => {
    const formData = new FormData();
    formData.append("file", png, "graffiti.png");
    const res = await fetchWithAuthMultipart(`${uploadBase()}/graffiti/`, { method: "POST", body: formData });
    if (!res.ok) throw new LError((await res.json().catch(() => ({})))?.error || "Не удалось сохранить граффити");
    return res.json();
  },
  /** Мои граффити — новые первыми; пака ещё нет — пусто. */
  myGraffiti: async (): Promise<{ id: string; pack: string; file_url: string; emoji?: string }[]> => {
    const packs = await api.getMyStickerPacks();
    const pack = packs.map((r: any) => r.pack || r).find((p: any) => p?.is_graffiti);
    return pack ? api.getStickers(pack.id) : [];
  },
  /** kind: sticker — стикеры, emoji — набор своих эмодзи (вставляются в текст). */
  createStickerPack: async (name: string, description?: string, isPublic = true, kind: "sticker" | "emoji" = "sticker"): Promise<any> => {
    const res = await fetchWithAuth(`${API_URL}/sticker-packs/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name, description, is_public: isPublic, kind }),
    });
    if (!res.ok) throw new LError("Не удалось создать набор");
    return res.json();
  },

  /** Изменить макрос/эмодзи/порядок стикера — только автор набора. */
  updateSticker: async (id: string, patch: { keyword?: string; emoji?: string | null; order?: number }): Promise<any> => {
    const res = await fetchWithAuth(`${API_URL}/stickers/${id}/`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new LError((await res.json().catch(() => ({})))?.detail || "Не удалось изменить стикер");
    return res.json();
  },

  deleteSticker: async (id: string): Promise<void> => {
    const res = await fetchWithAuth(`${API_URL}/stickers/${id}/`, { method: "DELETE", headers: authHeaders() });
    if (!res.ok) throw new LError("Не удалось удалить стикер");
  },

  /** Автор: разрешить или запретить добавлять стикеры всем, кто сохранил набор. */
  setStickerPackOpenAdd: async (packId: string, open: boolean): Promise<StickerPackInfo> => {
    const res = await fetchWithAuth(`${API_URL}/sticker-packs/${packId}/`, { method: "PATCH", headers: authHeaders(), body: JSON.stringify({ open_add: open }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(body?.error || body?.detail || "Не удалось сохранить");
    return body;
  },
  /** emoji — обычный эмодзи, который стоит за своим (его видят старые клиенты). */
  createSticker: async (packId: string, fileUrl: string, fileName: string, order = 0, keyword = "", emoji?: string): Promise<any> => {
    const res = await fetchWithAuth(`${API_URL}/stickers/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ pack: packId, file_url: fileUrl, file_name: fileName, order, keyword: keyword || undefined, emoji: emoji || undefined }),
    });
    if (!res.ok) throw new LError("Не удалось добавить стикер");
    return res.json();
  },


  /** Закрепить чат вверху списка или открепить. Закрепление личное. */
  /** Уведомления чата у себя: на время, навсегда или включить (lib/chatMute). */
  muteChat: async (chatId: string, span: "1h" | "4h" | "8h" | "forever" | "off"): Promise<{ muted: boolean; muted_until: string | null }> => {
    const res = await fetchWithAuth(`${API_URL}/chats/${chatId}/mute/`, {
      method: "POST", headers: authHeaders(), body: JSON.stringify({ for: span }),
    });
    if (!res.ok) throw new LError("Не удалось изменить уведомления");
    return res.json();
  },
  pinChat: async (chatId: string, pinned: boolean): Promise<void> => {
    const res = await fetchWithAuth(`${API_URL}/chats/${chatId}/pin/`, {
      method: pinned ? "POST" : "DELETE", headers: authHeaders(),
    });
    if (!res.ok) throw new LError(pinned ? "Не удалось закрепить" : "Не удалось открепить");
  },

  // ===== ТЕМЫ ОФОРМЛЕНИЯ =====
  /** Мои темы и установленные чужие. Объекты — «сырые», через normalizeTheme. */
  listThemes: async (): Promise<any[]> => {
    const res = await fetchWithAuth(`${API_URL}/themes/`, { method: "GET", headers: authHeaders() });
    if (!res.ok) throw new LError("Не удалось загрузить темы");
    return (await res.json()).themes || [];
  },
  getTheme: async (id: string): Promise<any> => {
    const res = await fetchWithAuth(`${API_URL}/themes/${id}/`, { method: "GET", headers: authHeaders() });
    if (!res.ok) throw new LError("Тема не найдена");
    return res.json();
  },
  /** Создать (без id) или сохранить свою тему. Сервер проверяет схему. */
  saveTheme: async (theme: { id?: string; name: string; base: string; colors: Record<string, string>; shape: object; is_public?: boolean }): Promise<any> => {
    const { id, ...body } = theme;
    const res = await fetchWithAuth(id ? `${API_URL}/themes/${id}/` : `${API_URL}/themes/`, {
      method: id ? "PATCH" : "POST", headers: authHeaders(), body: JSON.stringify(body),
    });
    if (!res.ok) {
      let msg = "Не удалось сохранить тему";
      try { msg = (await res.json()).error || msg; } catch { /* тело не JSON */ }
      throw new LError(msg);
    }
    return res.json();
  },
  deleteTheme: async (id: string): Promise<void> => {
    const res = await fetchWithAuth(`${API_URL}/themes/${id}/`, { method: "DELETE", headers: authHeaders() });
    if (!res.ok) throw new LError("Не удалось удалить тему");
  },
  installTheme: async (id: string): Promise<any> => {
    const res = await fetchWithAuth(`${API_URL}/themes/${id}/install/`, { method: "POST", headers: authHeaders() });
    if (!res.ok) throw new LError("Не удалось установить тему");
    return res.json();
  },
  uninstallTheme: async (id: string): Promise<void> => {
    const res = await fetchWithAuth(`${API_URL}/themes/${id}/install/`, { method: "DELETE", headers: authHeaders() });
    if (!res.ok) throw new LError("Не удалось убрать тему");
  },
  /** Запомнить выбор темы в профиле — он переедет на другие устройства. */
  setActiveTheme: async (themeId: string): Promise<void> => {
    if (!localStorage.getItem("access_token")) return;
    const me = await api.getCurrentUser();
    await fetchWithAuth(`${API_URL}/profiles/${me.id}/`, { method: "PATCH", headers: authHeaders(), body: JSON.stringify({ active_theme: themeId }) });
  },

  // ===== АККАУНТ =====
  /** Принять правила и политику — для тех, кто регистрировался до их появления. */
  acceptTerms: async (): Promise<Profile> => {
    const res = await fetchWithAuth(`${API_URL}/account/accept-terms/`, { method: "POST", headers: authHeaders() });
    if (!res.ok) throw new LError("Не удалось сохранить согласие");
    return res.json();
  },

  /** Безвозвратно удалить свой аккаунт. Пароль — подтверждение. */
  /** Перенос ключей секретных чатов на другое устройство (lib/secret.ts). */
  createKeyTransfer: async (pub: string): Promise<{ id: string; code: string; pub: string; ready: boolean; expires_at: string }> => {
    const res = await fetchWithAuth(`${API_URL}/secret-transfer/`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ pub }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(body?.error || "Не удалось открыть сеанс");
    return body;
  },
  lookupKeyTransfer: async (ref: string): Promise<{ id: string; code: string; pub: string; ready: boolean; expires_at: string }> => {
    const res = await fetchWithAuth(`${API_URL}/secret-transfer/${encodeURIComponent(ref)}/`, { method: "GET", headers: authHeaders() });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(body?.error || "Сеанс не найден");
    return body;
  },
  sendKeyTransferBlob: async (id: string, blob: string, oldPub: string, chats: string[]): Promise<{ ok: boolean; notified: number }> => {
    const res = await fetchWithAuth(`${API_URL}/secret-transfer/${id}/blob/`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ blob, old_pub: oldPub, chats }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(body?.error || "Не удалось отправить ключи");
    return body;
  },
  pollKeyTransfer: async (id: string): Promise<{ ready: boolean; blob?: string; old_pub?: string; pub?: string }> => {
    const res = await fetchWithAuth(`${API_URL}/secret-transfer/${id}/blob/`, { method: "GET", headers: authHeaders() });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(body?.error || "Сеанс истёк");
    return body;
  },

  /** Почта для восстановления пароля: письмо с кодом на новый адрес. */
  setEmail: async (email: string): Promise<{ sent: boolean; email: string }> => {
    const res = await fetchWithAuth(`${API_URL}/account/email/`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ email }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(body?.error || "Не удалось отправить код");
    return body;
  },
  confirmEmail: async (code: string): Promise<Profile> => {
    const res = await fetchWithAuth(`${API_URL}/account/email/confirm/`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ code }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(body?.error || "Не удалось подтвердить");
    return body;
  },
  unlinkEmail: async (): Promise<Profile> => {
    const res = await fetchWithAuth(`${API_URL}/account/email/`, { method: "DELETE", headers: authHeaders() });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(body?.error || "Не удалось отвязать");
    return body;
  },
  /** Сброс пароля без входа: код на привязанную почту, затем новый пароль. */
  forgotPassword: async (login: string): Promise<void> => {
    const res = await fetchWithAuth(`${API_URL}/auth/password/forgot/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ login }) });
    if (!res.ok) { const body = await res.json().catch(() => ({})); throw new LError(body?.error || "Не удалось отправить код"); }
  },
  resetPassword: async (login: string, code: string, password: string): Promise<void> => {
    const res = await fetchWithAuth(`${API_URL}/auth/password/reset/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ login, code, password }) });
    if (!res.ok) { const body = await res.json().catch(() => ({})); throw new LError(body?.error || "Не удалось сменить пароль"); }
  },

  deleteAccount: async (password: string): Promise<void> => {
    const res = await fetchWithAuth(`${API_URL}/account/delete/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      let msg = "Не удалось удалить аккаунт";
      try { msg = (await res.json()).error || msg; } catch { /* тело не JSON */ }
      throw new LError(msg);
    }
  },

  // ===== ПРОФИЛЬ =====
  updateProfile: async (profileId: string, data: { username?: string; bio?: string; push_preview?: boolean; notify_silent?: boolean; notify_wall?: boolean; notify_pet?: boolean; rov_enabled?: boolean; allow_adult?: boolean; ringtone?: string; hide_online?: boolean; show_last_seen?: boolean; confirm_chats?: boolean; hide_from_search?: boolean; wall_enabled?: boolean; ideabox_enabled?: boolean; saved_visibility?: "all" | "selected" | "none"; notify_sound_id?: string | null; aura_color?: string; aura_text?: string; aura_presets?: { color: string; text: string }[]; aura_anim?: boolean; quick_reaction?: { key: string; emoji?: string; custom?: { url: string; repaint?: boolean } } | null; language?: string; translate_in_default?: boolean; translate_out_default?: boolean; nav_tabs?: string[] | null; email_prompt_off?: boolean }): Promise<any> => {
    const res = await fetchWithAuth(`${API_URL}/profiles/${profileId}/`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      let msg = "Не удалось сохранить профиль";
      try {
        const body = await res.json();
        msg = body.username?.[0] || body.bio?.[0] || body.aura_color?.[0] || body.error || msg;
      } catch { /* тело не JSON */ }
      throw new LError(msg);
    }
    return res.json();
  },

  uploadAvatar: async (file: File): Promise<{ avatar_url: string }> => {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetchWithAuthMultipart(`${uploadBase()}/avatar/upload/`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) throw new LError((await res.json().catch(() => ({})))?.error || "Не удалось загрузить аватар");
    return res.json();
  },
  /** GIF или видео до 5 с → видео-аватар группы или канала (ставит его клиент). */
  uploadAnimatedAvatar: async (file: File): Promise<{ file_url: string }> => {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetchWithAuthMultipart(`${uploadBase()}/avatar/animated/`, { method: "POST", body: formData });
    if (!res.ok) throw new LError((await res.json().catch(() => ({})))?.error || "Не удалось загрузить аватар");
    return res.json();
  },

  /** Обложка профиля. Сервер сам удаляет прежний файл и отдаёт новый путь. */
  uploadCover: async (file: File): Promise<{ cover_url: string }> => {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetchWithAuthMultipart(`${uploadBase()}/cover/upload/`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) {
      let msg = "Не удалось загрузить обложку";
      try { msg = (await res.json()).error || msg; } catch { /* тело не JSON */ }
      throw new LError(msg);
    }
    return res.json();
  },

  // ---- Жалобы и блокировки ----

  /** Пожаловаться. Уходит в системный чат «Жалобы» к support/admin. */
  report: async (data: { target_type: ReportTarget; target_id: string; reason: ReportReason; comment?: string }): Promise<void> => {
    const res = await fetchWithAuth(`${API_URL}/reports/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      let msg = "Не удалось отправить жалобу";
      try { msg = (await res.json()).error || msg; } catch { /* тело не JSON */ }
      throw new LError(msg);
    }
  },

  /** Кому открыты мои сохранёнки при настройке «избранные люди». */
  listSavedViewers: async (): Promise<{ id: string; username: string; avatar_url?: string | null }[]> => {
    const res = await fetchWithAuth(`${API_URL}/saved-viewers/`, { method: "GET", headers: authHeaders() });
    if (!res.ok) throw new LError("Не удалось загрузить список");
    return (await res.json()).viewers || [];
  },

  addSavedViewer: async (profileId: string): Promise<void> => {
    const res = await fetchWithAuth(`${API_URL}/saved-viewers/`, {
      method: "POST", headers: authHeaders(), body: JSON.stringify({ profile_id: profileId }),
    });
    if (!res.ok) throw new LError((await res.json().catch(() => ({}))).error || "Не удалось добавить");
  },

  removeSavedViewer: async (profileId: string): Promise<void> => {
    const res = await fetchWithAuth(`${API_URL}/saved-viewers/`, {
      method: "DELETE", headers: authHeaders(), body: JSON.stringify({ profile_id: profileId }),
    });
    if (!res.ok) throw new LError("Не удалось убрать");
  },

  /** Вся моя музыка одним списком (все плейлисты, без повторов файла). */
  listAllTracks: async (q?: string): Promise<PlaylistTrack[]> => {
    const res = await fetchWithAuth(`${API_URL}/playlists/all-tracks/${q ? `?q=${encodeURIComponent(q)}` : ""}`, { method: "GET", headers: authHeaders() });
    if (!res.ok) throw new LError("Не удалось загрузить музыку");
    return (await res.json()).tracks || [];
  },

  /** Плейлисты: свои, с числом треков. «Моя музыка» заводится сама. */
  listPlaylists: async (): Promise<Playlist[]> => {
    const res = await fetchWithAuth(`${API_URL}/playlists/`, { method: "GET", headers: authHeaders() });
    if (!res.ok) throw new LError("Не удалось загрузить плейлисты");
    return (await res.json()).playlists || [];
  },

  getPlaylist: async (id: string): Promise<{ playlist: Playlist; tracks: PlaylistTrack[] }> => {
    const res = await fetchWithAuth(`${API_URL}/playlists/${id}/`, { method: "GET", headers: authHeaders() });
    if (!res.ok) throw new LError("Плейлист не найден");
    return res.json();
  },

  createPlaylist: async (name: string): Promise<Playlist> => {
    const res = await fetchWithAuth(`${API_URL}/playlists/`, {
      method: "POST", headers: authHeaders(), body: JSON.stringify({ name }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(data?.error || "Не удалось создать плейлист");
    return data;
  },

  renamePlaylist: async (id: string, name: string): Promise<Playlist> => {
    const res = await fetchWithAuth(`${API_URL}/playlists/${id}/`, {
      method: "PATCH", headers: authHeaders(), body: JSON.stringify({ name }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(data?.error || "Не удалось переименовать");
    return data;
  },

  deletePlaylist: async (id: string): Promise<void> => {
    const res = await fetchWithAuth(`${API_URL}/playlists/${id}/`, { method: "DELETE", headers: authHeaders() });
    if (!res.ok && res.status !== 204) {
      throw new LError((await res.json().catch(() => ({})))?.error || "Не удалось удалить");
    }
  },

  /** Добавить музыку из сообщения. Без playlistId — в «Мою музыку». */
  addTrackFromMessage: async (messageId: string, playlistId?: string): Promise<{ track: PlaylistTrack; playlist: Playlist; already: boolean }> => {
    const url = playlistId ? `${API_URL}/playlists/${playlistId}/tracks/` : `${API_URL}/playlists/tracks/`;
    const res = await fetchWithAuth(url, {
      method: "POST", headers: authHeaders(), body: JSON.stringify({ message_id: messageId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(data?.error || "Не удалось добавить");
    return data;
  },

  /** Новый порядок треков (все id плейлиста по порядку). */
  reorderPlaylist: async (id: string, ids: string[]): Promise<{ playlist: Playlist; tracks: PlaylistTrack[] }> => {
    const res = await fetchWithAuth(`${API_URL}/playlists/${id}/tracks/reorder/`, {
      method: "POST", headers: authHeaders(), body: JSON.stringify({ ids }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(data?.error || "Не удалось сохранить порядок");
    return data;
  },

  /** Подпись трека в своём плейлисте. */
  editTrack: async (playlistId: string, trackId: string, patch: { title?: string; artist?: string }): Promise<PlaylistTrack> => {
    const res = await fetchWithAuth(`${API_URL}/playlists/${playlistId}/tracks/${trackId}/`, {
      method: "PATCH", headers: authHeaders(), body: JSON.stringify(patch),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(data?.error || "Не удалось сохранить");
    return data;
  },

  /** Обложка плейлиста (уже ужатая клиентом картинка); null — убрать. */
  setPlaylistCover: async (id: string, image: Blob | null): Promise<Playlist> => {
    let res: Response;
    if (image) {
      const fd = new FormData();
      fd.append("file", image, image.type === "image/png" ? "cover.png" : "cover.jpg");
      res = await fetchWithAuthMultipart(`${API_URL}/playlists/${id}/cover/`, { method: "POST", body: fd });
    } else {
      res = await fetchWithAuth(`${API_URL}/playlists/${id}/cover/`, { method: "DELETE", headers: authHeaders() });
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new LError(data?.error || "Не удалось сменить обложку");
    return data;
  },

  removeTrack: async (playlistId: string, trackId: string): Promise<void> => {
    const res = await fetchWithAuth(`${API_URL}/playlists/${playlistId}/tracks/${trackId}/`, {
      method: "DELETE", headers: authHeaders(),
    });
    if (!res.ok && res.status !== 204) throw new LError("Не удалось убрать трек");
  },

  listBlocks: async (): Promise<{ id: string; username: string; avatar_url?: string | null }[]> => {
    const res = await fetchWithAuth(`${API_URL}/blocks/`, { method: "GET", headers: authHeaders() });
    if (!res.ok) throw new LError("Не удалось загрузить список");
    return (await res.json()).blocked || [];
  },

  blockUser: async (profileId: string): Promise<void> => {
    const res = await fetchWithAuth(`${API_URL}/blocks/`, {
      method: "POST", headers: authHeaders(), body: JSON.stringify({ profile_id: profileId }),
    });
    if (!res.ok) throw new LError("Не удалось заблокировать");
  },

  unblockUser: async (profileId: string): Promise<void> => {
    const res = await fetchWithAuth(`${API_URL}/blocks/`, {
      method: "DELETE", headers: authHeaders(), body: JSON.stringify({ profile_id: profileId }),
    });
    if (!res.ok) throw new LError("Не удалось разблокировать");
  },

  // ---- Стикерпаки по ссылке ----

  getStickerPack: async (id: string): Promise<StickerPackInfo> => {
    const res = await fetchWithAuth(`${API_URL}/sticker-packs/${id}/`, { method: "GET", headers: authHeaders() });
    if (!res.ok) throw new LError("Пак не найден");
    return res.json();
  },

  saveStickerPack: async (id: string): Promise<void> => {
    const res = await fetchWithAuth(`${API_URL}/sticker-packs/${id}/save/`, { method: "POST", headers: authHeaders() });
    if (!res.ok) throw new LError("Не удалось добавить пак");
  },

  unsaveStickerPack: async (id: string): Promise<void> => {
    const res = await fetchWithAuth(`${API_URL}/sticker-packs/${id}/unsave/`, { method: "POST", headers: authHeaders() });
    if (!res.ok) throw new LError("Не удалось убрать пак");
  },

  /** Удалить свой стикерпак целиком (только автор). */
  deleteStickerPack: async (id: string): Promise<void> => {
    const res = await fetchWithAuth(`${API_URL}/sticker-packs/${id}/`, { method: "DELETE", headers: authHeaders() });
    if (!res.ok) throw new LError((await res.json().catch(() => ({}))).error || "Не удалось удалить пак");
  },

  // ---- Паки звуков (подписка, как у стикеров) ----

  getSoundPack: async (id: string): Promise<SoundPackInfo> => {
    const res = await fetchWithAuth(`${API_URL}/sounds/pack/${id}/`, { method: "GET", headers: authHeaders() });
    if (!res.ok) throw new LError("Пак не найден");
    return res.json();
  },

  /** Импорт набора стикеров из Telegram по ссылке t.me/addstickers/… .
   *  Сервер качает стикеры в фоне, поэтому отвечает сразу — прогресс
   *  спрашиваем отдельно (telegramImportProgress). */
  importTelegramStickers: async (url: string): Promise<{ pack_id: string; name: string; total: number; done: number; kind?: "sticker" | "emoji" }> => {
    const res = await fetchWithAuth(`${API_URL}/sticker-packs/import-telegram/`, {
      method: "POST", headers: authHeaders(), body: JSON.stringify({ url }),
    });
    if (!res.ok) {
      let msg = "Не удалось импортировать набор";
      try { msg = (await res.json()).error || msg; } catch { /* тело не JSON */ }
      throw new LError(msg);
    }
    return res.json();
  },

  telegramImportProgress: async (packId: string): Promise<{ total: number; done: number; failed: number; finished: boolean }> => {
    const res = await fetchWithAuth(`${API_URL}/sticker-packs/import-telegram/${packId}/`, { method: "GET", headers: authHeaders() });
    if (!res.ok) throw new LError("Импорт не найден");
    return res.json();
  },

  /** Создать свой пак звуков: название и файлы с их названиями. */
  createSoundPack: async (name: string, items: { file: File; title: string }[]): Promise<SoundPackInfo> => {
    // Частями по BATCH звуков: пак создаёт первая часть, остальные досылаются в
    // него. Одним запросом больше 100 файлов сервер не принимает (400,
    // TooManyFilesSent), а сотня звуков разом перекодировалась бы дольше
    // таймаута — большой пак не сохранялся вовсе.
    const BATCH = 20;
    const send = async (url: string, part: typeof items, withName: boolean) => {
      const fd = new FormData();
      if (withName) fd.append("pack_name", name);
      for (const it of part) { fd.append("files", it.file); fd.append("names", it.title); }
      const res = await fetchWithAuthMultipart(url, { method: "POST", body: fd });
      if (!res.ok) {
        let msg = "Не удалось создать пак";
        try { msg = (await res.json()).error || msg; } catch { /* тело не JSON */ }
        throw new LError(msg);
      }
      // Студийная ручка отвечает {pack, created, failed}.
      return res.json() as Promise<{ pack: SoundPackInfo; failed?: unknown[] }>;
    };
    const first = await send(`${uploadBase()}/sounds/pack/`, items.slice(0, BATCH), true);
    let pack = first.pack;
    let failed = first.failed?.length || 0;
    for (let i = BATCH; i < items.length; i += BATCH) {
      const part = items.slice(i, i + BATCH);
      try {
        const r = await send(`${uploadBase()}/sounds/pack/${pack.id}/sounds/`, part, false);
        pack = r.pack || pack;
        failed += r.failed?.length || 0;
      } catch { failed += part.length; }
    }
    if (failed) throw new LError(tr("Не обработано звуков: {n}", { n: failed }));
    return pack;
  },

  /** Обложка пака: загрузить или убрать (только владелец). */
  setSoundPackCover: async (id: string, file: File | null): Promise<SoundPackInfo> => {
    let res: Response;
    if (file) {
      const fd = new FormData();
      fd.append("file", file);
      // Заголовки не ставим: границу multipart проставляет браузер сам,
      // а токен подставляет fetchWithAuthMultipart.
      res = await fetchWithAuthMultipart(`${uploadBase()}/sounds/pack/${id}/cover/`, { method: "POST", body: fd });
    } else {
      res = await fetchWithAuth(`${API_URL}/sounds/pack/${id}/cover/`, { method: "DELETE", headers: authHeaders() });
    }
    if (!res.ok) {
      let msg = "Не удалось сохранить обложку";
      try { msg = (await res.json()).error || msg; } catch { /* тело не JSON */ }
      throw new LError(msg);
    }
    return res.json();
  },

  addSoundPack: async (id: string): Promise<void> => {
    const res = await fetchWithAuth(`${API_URL}/sounds/pack/${id}/subscribe/`, { method: "POST", headers: authHeaders() });
    if (!res.ok) throw new LError("Не удалось добавить пак");
  },

  removeSoundPack: async (id: string): Promise<void> => {
    const res = await fetchWithAuth(`${API_URL}/sounds/pack/${id}/subscribe/`, { method: "DELETE", headers: authHeaders() });
    if (!res.ok) throw new LError("Не удалось убрать пак");
  },

  /** Свои паки (созданные в приложении или в студии). */
  listMySoundPacks: async (): Promise<SoundPackInfo[]> => {
    const res = await fetchWithAuth(`${API_URL}/sounds/mine/`, { method: "GET", headers: authHeaders() });
    if (!res.ok) throw new LError(`HTTP ${res.status}`);
    return ((await res.json()).packs || []) as SoundPackInfo[];
  },

  listAddedSoundPacks: async (): Promise<SoundPackInfo[]> => {
    const res = await fetchWithAuth(`${API_URL}/sounds/added/`, { method: "GET", headers: authHeaders() });
    if (!res.ok) throw new LError("Не удалось загрузить паки");
    return (await res.json()).packs || [];
  },

  /** Баг-репорт: multipart с описанием, скриншотом, логом и meta. */
  sendBugReport: async (fd: FormData): Promise<void> => {
    const res = await fetchWithAuthMultipart(`${uploadBase()}/bugreports/`, { method: "POST", body: fd });
    if (!res.ok) {
      let msg = "Не удалось отправить репорт";
      try { msg = (await res.json()).error || msg; } catch { /* тело не JSON */ }
      throw new LError(msg);
    }
  },

  removeCover: async (): Promise<void> => {
    const res = await fetchWithAuth(`${API_URL}/cover/upload/`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    if (!res.ok) throw new LError("Не удалось убрать обложку");
  },


  // Регистрация FCM-токена устройства. Профиль берётся из сессии на сервере.
  registerPushToken: async (token: string, platform: string, secret?: string): Promise<any> => {
    let device_id: string | undefined;
    try { device_id = (await import("@/lib/secret")).deviceId(); } catch { /* без него тоже зарегистрируемся */ }
    const res = await fetchWithAuth(`${API_URL}/push/register/`, {
      method: "POST",
      headers: authHeaders(),
      // secret — ключ шифрования пушей с устройства (см. lib/pushSecret.ts);
      // device_id — чтобы «выйти с устройства» убирал и пуш-токен.
      body: JSON.stringify({ token, platform, secret: secret || undefined, device_id }),
    });
    if (!res.ok) throw new LError("Не удалось зарегистрировать устройство");
    return res.json();
  },

};

// Загрузки — «занято» (lib/busy): обновление по воздуху не перезагрузит
// интерфейс посреди отправки файла, голосового или трека.
for (const k of ["uploadFile", "uploadVoice", "uploadTrack"] as const) {
  const run = api[k] as (...args: unknown[]) => Promise<unknown>;
  (api as Record<string, unknown>)[k] = (...args: unknown[]) => withBusy("upload", () => run(...args));
}
