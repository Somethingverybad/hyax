// Ретро-ПК: страница открыта всем, а сам эмулятор (app.js, v86, BIOS) — только
// по пропуску. Пропуск выдаётся тем, кто открыл мини-приложение из WYX и есть
// в списке допуска (DATA_DIR/allow.txt). Образы дисков сюда не попадают никогда.

import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { readFile, mkdir } from "node:fs/promises";
import { join, dirname, extname, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { checkInitData } from "./auth.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(ROOT, "public");
const PRIVATE = join(ROOT, "private");
const PORT = Number(process.env.PORT || 8092);
const DEV = process.env.DEV === "1";
const TOKEN = process.env.HYAX_BOT_TOKEN || "";
const DATA = process.env.DATA_DIR || join(ROOT, "data");
const ALLOW_FILE = join(DATA, "allow.txt");
const DAY = 86400;

if (!TOKEN && !DEV) console.error("Нет HYAX_BOT_TOKEN — пропуска не выдаются. Для проверки без WYX: DEV=1 npm start");

// Ключ пропусков выводится из токена бота: перезапуск их не сбрасывает.
const KEY = createHmac("sha256", "retro-pass").update(TOKEN || "dev").digest();

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".wasm": "application/wasm", ".json": "application/json",
};

const FRAME = "frame-ancestors 'self' https://hyax.ru https://wyx.su https://huyax.e-tree.su capacitor://localhost https://localhost http://localhost app://hyax";

// ---------- список допуска ----------

let allow = { mtime: -1, ids: new Set(), names: new Set() };

/** Строки allow.txt: id пользователя или @username; «#» — комментарий. Перечитывается при изменении. */
function allowList() {
  let mtime = 0;
  try { mtime = statSync(ALLOW_FILE).mtimeMs; } catch { /* файла нет — никого */ }
  if (mtime === allow.mtime) return allow;
  const ids = new Set(), names = new Set();
  let text = "";
  try { text = readFileSync(ALLOW_FILE, "utf8"); } catch { /* пусто */ }
  for (let line of text.split("\n")) {
    line = line.replace(/#.*/, "").trim();
    if (!line) continue;
    if (line.startsWith("@")) names.add(line.slice(1).toLowerCase());
    else ids.add(line);
  }
  allow = { mtime, ids, names };
  return allow;
}

export function allowed(user) {
  if (DEV && user.id === "dev") return true;
  const a = allowList();
  return a.ids.has(user.id) || a.names.has(String(user.username || "").toLowerCase());
}

// ---------- пропуск ----------
// base64url({u, n, e}).подпись. Срок — до конца завтрашнего дня (UTC): в течение
// суток адрес одинаковый, и браузер берёт v86 из кэша.

const b64 = (s) => Buffer.from(s).toString("base64url");
const sig = (data) => createHmac("sha256", KEY).update(data).digest("base64url");

export function issuePass(user, now = Date.now() / 1000) {
  const e = (Math.floor(now / DAY) + 2) * DAY;
  const data = b64(JSON.stringify({ u: user.id, n: user.username || "", e }));
  return `${data}.${sig(data)}`;
}

/** Пропуск верный, не истёк и его владелец всё ещё в списке → пользователь, иначе null. */
export function checkPass(pass, now = Date.now() / 1000) {
  const [data, got = ""] = String(pass).split(".");
  if (!data) return null;
  const want = sig(data);
  if (got.length !== want.length || !timingSafeEqual(Buffer.from(got), Buffer.from(want))) return null;
  let p;
  try { p = JSON.parse(Buffer.from(data, "base64url").toString()); } catch { return null; }
  if (!(p.e > now)) return null;
  const user = { id: String(p.u), username: p.n };
  return allowed(user) ? user : null;
}

// ---------- HTTP ----------

function send(res, code, body, type = "text/plain; charset=utf-8", extra = {}) {
  res.writeHead(code, { "Content-Type": type, "Content-Security-Policy": FRAME, "Cache-Control": "no-cache", ...extra });
  res.end(body);
}

/** Файл из каталога base; путь не может выйти наружу. */
async function serveFile(res, base, rel, cache = "no-cache") {
  const file = normalize(join(base, rel));
  if (!file.startsWith(base + sep)) return send(res, 404, "Нет такого файла");
  let body;
  try { body = await readFile(file); } catch { return send(res, 404, "Нет такого файла"); }
  send(res, 200, body, MIME[extname(file)] || "application/octet-stream", { "Cache-Control": cache });
}

async function readBody(req, limit = 8192) {
  let size = 0;
  const parts = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("too big");
    parts.push(chunk);
  }
  return Buffer.concat(parts).toString();
}

export const server = createServer((req, res) => {
  handle(req, res).catch((e) => { console.error(e); if (!res.headersSent) send(res, 500, ""); else res.end(); });
});

async function handle(req, res) {
  let path;
  try { path = decodeURIComponent(new URL(req.url, "http://x").pathname); } catch { return send(res, 400, ""); }

  if (path === "/api/session" && req.method === "POST") {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { return send(res, 400, "{}", MIME[".json"]); }
    const user = DEV && !body.initData ? { id: "dev", username: "dev" } : checkInitData(body.initData, TOKEN);
    if (!user) return send(res, 401, JSON.stringify({ error: "no_wyx" }), MIME[".json"]);
    if (!allowed(user)) return send(res, 403, JSON.stringify({ error: "denied", username: user.username }), MIME[".json"]);
    return send(res, 200, JSON.stringify({ pass: issuePass(user), username: user.username }), MIME[".json"]);
  }

  // /s/<пропуск>/<файл> — эмулятор. Пропуск в пути, а не в куках: внутри
  // приложения WYX страница чужая для рамки, и сторонние куки там режутся.
  const m = path.match(/^\/s\/([^/]+)\/(.+)$/);
  if (m) {
    if (!checkPass(m[1])) return send(res, 403, "Нет доступа");
    // v86 и BIOS меняются только с версией — пусть лежат в кэше; app.js — свежий.
    return serveFile(res, PRIVATE, m[2], m[2].startsWith("v86/") ? "private, max-age=86400" : "no-cache");
  }

  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "");
  return serveFile(res, PUBLIC, path === "/" ? "index.html" : path);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await mkdir(DATA, { recursive: true });
  server.listen(PORT, () => console.log(`Ретро-ПК: http://localhost:${PORT}`));
}
