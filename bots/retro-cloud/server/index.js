// Ретро-ПК на сервере. HTTP: /health, /dev/ (только DEV=1). WebSocket /ws:
// первый кадр — текст {t:"hello", initData, room?} (данные запуска WYX, как в
// bots/retro); ответ {t:"ready", w, h, room, players}. Дальше двоичные кадры —
// это VNC (RFB) как есть, в обе стороны; текстовые кадры от клиента — ввод:
//   {t:"move", x, y}   указатель в точку экрана      {t:"rel", dx, dy}  тачпад
//   {t:"btn", b:"left"|"right"|"middle", down}        {t:"click", b, n}
//   {t:"key", k:<имя из KEYS>|<qcode>, down}          {t:"tap", k}  {t:"text", s}
//   {t:"park"}  курсор в угол (сброс рассинхрона)      {t:"ping"}
// Текстовые кадры от сервера — состояние: {t:"room", code, players:[…]}, {t:"error", m}.
//
// Комната = общая сеть: машины игроков одной комнаты видят друг друга по LAN.
// Машина игрока живёт, пока к ней кто-то подключён, и ещё IDLE_MIN минут после,
// потом усыпляется снимком (следующий вход продолжает с того же места).

import { createServer } from "node:http";
import { createConnection } from "node:net";
import { readFile, stat } from "node:fs/promises";
import { readFileSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { WebSocketServer } from "ws";
import { checkInitData, signInitData } from "./auth.js";
import { Vm, SCREEN, KEYS } from "./vm.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 8099);
const DEV = process.env.DEV === "1";
const TOKEN = process.env.HYAX_BOT_TOKEN || "";
const DATA = process.env.DATA_DIR || join(ROOT, "data");
const BASE = process.env.BASE_IMAGE || join(DATA, "base", "win98.img");
const CDROM = process.env.CDROM_IMAGE || join(DATA, "base", "heroes3.iso");
const RAM = Number(process.env.VM_RAM || 128);
const IDLE_MIN = Number(process.env.IDLE_MIN || 10);
const MAX_VMS = Number(process.env.MAX_VMS || 6);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---------- допуск ----------
let allow = { mtime: -1, ids: new Set(), names: new Set() };
function allowed(user) {
  if (DEV) return true;
  const f = join(DATA, "allow.txt");
  let mtime = 0;
  try { mtime = statSync(f).mtimeMs; } catch { /* нет файла — никого */ }
  if (mtime !== allow.mtime) {
    const ids = new Set(), names = new Set();
    let text = ""; try { text = readFileSync(f, "utf8"); } catch { /* пусто */ }
    for (const raw of text.split("\n")) {
      const line = raw.trim(); if (!line || line.startsWith("#")) continue;
      if (line.startsWith("@")) names.add(line.slice(1).toLowerCase()); else ids.add(line);
    }
    allow = { mtime, ids, names };
  }
  return allow.ids.has(user.id) || allow.names.has(user.username.toLowerCase());
}

// ---------- комнаты и машины ----------
const vms = new Map();   // userId → {vm, clients:Set, idleTimer, room}
const rooms = new Map(); // code → {code, mcast, players:Map(userId→{username, photo_url})}
let mcastSeq = 0;
const roomCode = () => { let c; do { c = String(1000 + Math.floor(Math.random() * 9000)); } while (rooms.has(c)); return c; };

function getRoom(code, create) {
  if (code && rooms.has(code)) return rooms.get(code);
  if (!create) return null;
  const r = { code: roomCode(), mcast: 5000 + (mcastSeq++ % 1000), players: new Map(), created: Date.now() };
  rooms.set(r.code, r);
  return r;
}

function broadcastRoom(room) {
  const msg = JSON.stringify({ t: "room", code: room.code, players: [...room.players.values()] });
  for (const [uid] of room.players) for (const c of vms.get(uid)?.clients || []) if (c.readyState === 1) c.send(msg);
}

async function getVm(user, room) {
  let e = vms.get(user.id);
  if (e && e.room !== room) { // перешёл в другую комнату — другая сеть, машину перезапускаем
    clearTimeout(e.idleTimer);
    await e.vm.sleepAndQuit().catch(() => {});
    vms.delete(user.id); e = null;
  }
  if (!e) {
    const running = [...vms.values()].filter((x) => x.vm.proc).length;
    if (running >= MAX_VMS) throw new Error("busy");
    const vm = new Vm({ id: user.id, dataDir: DATA, base: BASE, cdrom: await stat(CDROM).then(() => CDROM, () => undefined), mcast: room.mcast, ram: RAM, log: (l) => log(`[${user.username}]`, l) });
    e = { vm, clients: new Set(), idleTimer: null, room };
    vms.set(user.id, e);
  }
  if (!e.vm.proc) await e.vm.start();
  clearTimeout(e.idleTimer);
  return e;
}

function scheduleIdle(e, user) {
  clearTimeout(e.idleTimer);
  e.idleTimer = setTimeout(async () => {
    if (e.clients.size || vms.get(user.id) !== e) return; // машину уже сменили/убрали
    log(`[${user.username}] никого ${IDLE_MIN} мин — усыпляю`);
    await e.vm.sleepAndQuit().catch((err) => log("усыпить не вышло:", err.message));
    vms.delete(user.id);
    e.room.players.delete(user.id);
    if (!e.room.players.size) rooms.delete(e.room.code); else broadcastRoom(e.room);
  }, IDLE_MIN * 60 * 1000);
}

// ---------- HTTP ----------
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml" };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/health") {
    const body = { ok: true, vms: [...vms.entries()].map(([id, e]) => ({ id, running: !!e.vm.proc, clients: e.clients.size, room: e.room.code })), rooms: rooms.size };
    res.writeHead(200, { "Content-Type": MIME[".json"] }); return res.end(JSON.stringify(body));
  }
  if (DEV && url.pathname === "/dev/init") { // подписанные данные запуска для проверки без WYX
    const u = { id: url.searchParams.get("id") || "1001", username: url.searchParams.get("name") || "tester" };
    res.writeHead(200, { "Content-Type": "text/plain" }); return res.end(signInitData(u, TOKEN || "dev"));
  }
  if (DEV && url.pathname.startsWith("/dev/shot/")) { // кадр машины: QMP пускает одного клиента, поэтому только через сервис
    const e = vms.get(url.pathname.slice(10));
    if (!e?.vm.qmp) { res.writeHead(404); return res.end("машины нет"); }
    const file = join(DATA, "run", `shot-${e.vm.id}.ppm`);
    try { await e.vm.qmp.cmd("screendump", { filename: file }); const data = await readFile(file); res.writeHead(200, { "Content-Type": "image/x-portable-pixmap" }); return res.end(data); }
    catch (err) { res.writeHead(500); return res.end(err.message); }
  }
  if (DEV) { // статика для разработки: /dev/ → public/
    let p = url.pathname.replace(/^\/dev\/?/, "") || "dev.html";
    if (p.includes("..")) { res.writeHead(400); return res.end(); }
    try {
      const file = join(ROOT, "public", p);
      const data = await readFile(file);
      res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
      return res.end(data);
    } catch { res.writeHead(404); return res.end("нет"); }
  }
  res.writeHead(404); res.end("Ретро-ПК: только WebSocket /ws");
});

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 1 << 20 });
wss.on("connection", (ws, req) => {
  let entry = null, user = null, vnc = null;
  const send = (o) => ws.readyState === 1 && ws.send(JSON.stringify(o));
  const fail = (m) => { send({ t: "error", m }); ws.close(); };

  ws.once("message", async (data, isBinary) => {
    if (isBinary) return fail("hello?");
    let hello; try { hello = JSON.parse(String(data)); } catch { return fail("hello?"); }
    user = checkInitData(hello.initData, TOKEN || (DEV ? "dev" : ""));
    if (!user) return fail("no_wyx");
    if (!allowed(user)) return fail("denied");
    let room = getRoom(String(hello.room || "").trim(), false);
    if (!room && hello.room) return fail("no_room");
    // «Создать» при живой своей машине — остаёмся в её комнате: иначе машину пришлось бы
    // перезапускать ради новой сети (у каждой комнаты свой мультикаст-порт).
    if (!room) room = vms.get(user.id)?.room || getRoom(null, true);
    try { entry = await getVm(user, room); } catch (e) { return fail(e.message === "busy" ? "busy" : "vm_failed"); }
    if (ws.readyState !== 1) { scheduleIdle(entry, user); return; }
    room.players.set(user.id, { id: user.id, username: user.username, photo_url: user.photo_url });
    entry.clients.add(ws);
    log(`[${user.username}] подключился, комната ${room.code}, клиентов ${entry.clients.size}`);

    // VNC: двоичные кадры туда-сюда
    vnc = createConnection(entry.vm.vnc);
    vnc.on("data", (d) => ws.readyState === 1 && ws.send(d, { binary: true }));
    vnc.on("error", (e) => fail(`vnc: ${e.message}`));
    vnc.on("close", () => ws.close());
    const size = await entry.vm.probeSize();
    send({ t: "ready", w: size.w, h: size.h, room: room.code, mcast: room.mcast });
    broadcastRoom(room);

    const vm = entry.vm;
    // Движения мыши склеиваем: пока очередь ввода занята, сдвиги суммируются, а из
    // «подвести в точку» остаётся только последняя цель — иначе быстрый жест
    // превращается в сотни событий и ввод отстаёт на секунды.
    const acc = { dx: 0, dy: 0, job: false, target: null, moveJob: false };
    ws.on("message", (d, bin) => {
      if (bin) { vnc.write(d); return; }
      let m; try { m = JSON.parse(String(d)); } catch { return; }
      if (m.t === "rel") {
        acc.dx += Number(m.dx) || 0; acc.dy += Number(m.dy) || 0;
        if (acc.job) return;
        acc.job = true;
        vm.run(async () => { acc.job = false; const dx = acc.dx, dy = acc.dy; acc.dx = acc.dy = 0; await vm.moveBy(dx, dy); }).catch((e) => { acc.job = false; log("ввод:", e.message); });
        return;
      }
      if (m.t === "move") {
        acc.target = { x: m.x, y: m.y };
        if (acc.moveJob) return;
        acc.moveJob = true;
        vm.run(async () => { acc.moveJob = false; const t = acc.target; acc.target = null; if (!t) return; if (Date.now() - (vm.sizedAt || 0) > 10000) { await vm.probeSize(); vm.sizedAt = Date.now(); } await vm.moveTo(t.x, t.y); }).catch((e) => { acc.moveJob = false; log("ввод:", e.message); });
        return;
      }
      vm.run(async () => {
        switch (m.t) {
          case "btn": await vm.button(m.b || "left", !!m.down); break;
          case "click": await vm.click(m.b || "left", Math.min(3, m.n || 1)); break;
          case "key": { const q = KEYS[m.k] || m.k; if (/^[\w-]{1,24}$/.test(q)) await vm.key(q, !!m.down); break; }
          case "tap": { const q = KEYS[m.k] || m.k; if (/^[\w-]{1,40}$/.test(q)) await vm.tap(q); break; }
          case "text": await vm.type(String(m.s || "").slice(0, 500)); break;
          case "park": await vm.probeSize(); await vm.park(); break;
          case "poweroff": { // игрок сам выключил машину: без снимка, следующий вход — холодный старт
            log(`[${user.username}] выключил машину`);
            await vm.quit(true); vms.delete(user.id); room.players.delete(user.id); broadcastRoom(room); ws.close(); break;
          }
          case "ping": send({ t: "pong" }); break;
        }
      }).catch((e) => log("ввод:", e.message));
    });
  });

  ws.on("close", () => {
    vnc?.destroy();
    if (!entry) return;
    entry.clients.delete(ws);
    log(`[${user.username}] отключился, осталось ${entry.clients.size}`);
    if (!entry.clients.size) scheduleIdle(entry, user);
  });
});

process.on("SIGTERM", async () => {
  log("останавливаюсь: усыпляю машины");
  await Promise.all([...vms.values()].map((e) => e.vm.sleepAndQuit().catch(() => {})));
  process.exit(0);
});

server.listen(PORT, () => log(`Ретро-ПК на сервере: порт ${PORT}, база ${BASE}, данные ${DATA}${DEV ? ", DEV" : ""}`));
