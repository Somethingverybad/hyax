/**
 * Кольцевой лог приложения — то, что уходит вместе с баг-репортом.
 *
 * Что сюда попадает: переходы между экранами, сетевые запросы (метод, путь,
 * код ответа, длительность), console.warn/error, необработанные ошибки и
 * отклонённые промисы. Чего здесь нет намеренно: текстов сообщений, токенов,
 * паролей, тел запросов и ответов. Лог уезжает на сервер к людям — он должен
 * объяснять, что делало приложение, а не пересказывать переписку.
 *
 * Держим в памяти последние MAX записей; между запусками не сохраняем — баг
 * репортят про текущую сессию, а хранить историю на диске значит хранить
 * лишнее.
 */

const MAX = 1500;

type Level = "info" | "warn" | "error";
interface Entry { t: number; l: Level; m: string }

const buf: Entry[] = [];
const startedAt = Date.now();

/** Вырезаем из строк то, что похоже на секреты: JWT, Bearer, пароли в JSON. */
export function redact(s: string): string {
  return s
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer ***")
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "***jwt***")
    .replace(/("(?:password|token|refresh|secret|bot_token)"\s*:\s*")[^"]*(")/gi, "$1***$2")
    .replace(/([?&](?:token|secret|sig|signature)=)[^&\s]+/gi, "$1***");
}

function push(l: Level, m: string) {
  buf.push({ t: Date.now(), l, m: redact(String(m)).slice(0, 600) });
  if (buf.length > MAX) buf.splice(0, buf.length - MAX);
}

export const applog = {
  info: (m: string) => push("info", m),
  warn: (m: string) => push("warn", m),
  error: (m: string) => push("error", m),
};

/** Путь без query-строки и без хоста: параметры могут содержать подписи. */
export function safePath(url: string): string {
  try {
    const u = new URL(url, location.origin);
    return u.pathname;
  } catch {
    return url.split("?")[0].slice(0, 200);
  }
}

/** Лог как текст для отправки: время от старта, уровень, сообщение. */
export function dumpLog(): string {
  const pad = (n: number, w: number) => String(n).padStart(w, "0");
  return buf.map((e) => {
    const ms = e.t - startedAt;
    const s = Math.floor(ms / 1000);
    return `+${pad(Math.floor(s / 60), 3)}:${pad(s % 60, 2)}.${pad(ms % 1000, 3)} ${e.l.toUpperCase().padEnd(5)} ${e.m}`;
  }).join("\n");
}

let installed = false;

/** Перехват глобальных ошибок и console.warn/error. Вызвать один раз из main. */
export function installAppLog() {
  if (installed) return;
  installed = true;
  applog.info(`start ${navigator.userAgent}`);

  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);
  console.warn = (...a: unknown[]) => { push("warn", a.map(fmt).join(" ")); origWarn(...a); };
  console.error = (...a: unknown[]) => { push("error", a.map(fmt).join(" ")); origError(...a); };

  window.addEventListener("error", (e) => {
    push("error", `uncaught ${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r = (e as PromiseRejectionEvent).reason;
    push("error", `unhandled ${r instanceof Error ? `${r.name}: ${r.message}` : fmt(r)}`);
  });
  document.addEventListener("visibilitychange", () => applog.info(`visibility ${document.visibilityState}`));
  window.addEventListener("online", () => applog.info("network online"));
  window.addEventListener("offline", () => applog.warn("network offline"));
}

function fmt(v: unknown): string {
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  if (typeof v === "string") return v;
  try { return JSON.stringify(v).slice(0, 300); } catch { return String(v); }
}
