// Сервер «Осколков Короны»: статика мини-приложения, комнаты и партии по
// WebSocket. Партия считается только здесь (shared/game.js), клиенты шлют
// действия и получают состояние целиком.

import http from "node:http";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomInt } from "node:crypto";
import { WebSocketServer } from "ws";
import { checkInitData } from "./auth.js";
import { createNotifier } from "./notify.js";
import { createGame, act, runBattleAI, forceBattleStep } from "../shared/game.js";
import { activeStack } from "../shared/battle.js";
import { nextAiAction } from "../shared/ai.js";
import { FACTION_IDS, FACTIONS } from "../shared/data.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 8090);
const DEV = process.env.DEV === "1";
const TOKEN = process.env.HYAX_BOT_TOKEN || "";
const DATA = process.env.DATA_DIR || join(ROOT, "data");
const APP_URL = process.env.APP_URL || "https://wyx.su/shards/";
const BATTLE_TURN_MS = Number(process.env.BATTLE_TURN_MS || 45000);
const AI_DELAY_MS = Number(process.env.AI_DELAY_MS || 350);
const MAX_ROOMS_PER_USER = 8;
const ROOM_TTL_MS = 30 * 24 * 3600 * 1000; // брошенные партии живут месяц

if (!TOKEN && !DEV) {
  // Страница открывается, но войти нельзя: данные запуска нечем проверить.
  console.error("Нет HYAX_BOT_TOKEN — вход закрыт. Для проверки без WYX: DEV=1 npm start");
}

await mkdir(DATA, { recursive: true });
const notifier = createNotifier({
  token: TOKEN, api: process.env.HYAX_API, ws: process.env.HYAX_WS, appUrl: APP_URL, file: join(DATA, "chats.json"),
});

// ---------- комнаты ----------

/** code → {code, name, host, status: lobby|play|over, size, maxSeats, seats, game, chat, updated} */
const rooms = new Map();
/** Что не сохраняем: подписчики, таймеры, память ИИ. code → {subs, timer, aiMem, aiKey} */
const live = new Map();

try {
  const saved = JSON.parse(readFileSync(join(DATA, "rooms.json"), "utf8"));
  for (const r of saved) if (Date.now() - r.updated < ROOM_TTL_MS) rooms.set(r.code, r);
  console.log(`загружено партий: ${rooms.size}`);
} catch { /* первый запуск */ }

let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    const tmp = join(DATA, "rooms.json.tmp");
    try {
      await writeFile(tmp, JSON.stringify([...rooms.values()]));
      await rename(tmp, join(DATA, "rooms.json"));
    } catch (e) { console.error("сохранение:", e.message); }
  }, 1500);
}

const rt = (code) => {
  if (!live.has(code)) live.set(code, { subs: new Set(), timer: null, aiMem: {}, aiKey: "" });
  return live.get(code);
};

function newCode() {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (;;) {
    let c = "";
    for (let i = 0; i < 5; i++) c += abc[randomInt(abc.length)];
    if (!rooms.has(c)) return c;
  }
}

function summary(r, uid) {
  const g = r.game;
  const cur = g && !g.over ? g.players[g.turn] : null;
  return {
    code: r.code, name: r.name, host: r.host, status: r.status, size: r.size, maxSeats: r.maxSeats,
    seats: r.seats.map((s) => ({ uid: s.uid, name: s.name, faction: s.faction, ai: !!s.ai })),
    day: g?.day || 0, turnName: cur?.name || "", myTurn: !!cur && cur.uid === uid && !cur.ai,
    winner: g?.over && g.winner !== null ? g.players[g.winner].name : null, updated: r.updated,
  };
}

// ---------- сокеты ----------

const sockets = new Set();

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function broadcastState(r, events = []) {
  r.updated = Date.now();
  scheduleSave();
  const msg = JSON.stringify({ t: "state", code: r.code, room: summary(r), state: r.game, events });
  for (const ws of rt(r.code).subs) if (ws.readyState === 1) ws.send(msg);
  pushLobbies(r);
}

function broadcastRoom(r) {
  r.updated = Date.now();
  scheduleSave();
  for (const ws of rt(r.code).subs) send(ws, { t: "room", room: summary(r, ws.user.id) });
  pushLobbies(r);
}

/** Тем, кто сидит в лобби, — свежий список (свои партии и открытые). */
function pushLobbies() {
  for (const ws of sockets) if (ws.user && ws.inLobby) sendLobby(ws);
}

function sendLobby(ws) {
  const uid = ws.user.id;
  const mine = [], open = [];
  for (const r of rooms.values()) {
    if (r.seats.some((s) => s.uid === uid)) mine.push(summary(r, uid));
    else if (r.status === "lobby" && r.seats.length < r.maxSeats) open.push(summary(r, uid));
  }
  mine.sort((a, b) => Number(b.myTurn) - Number(a.myTurn) || b.updated - a.updated);
  open.sort((a, b) => b.updated - a.updated);
  send(ws, { t: "lobby", mine, open: open.slice(0, 30) });
}

const online = (r, uid) => [...rt(r.code).subs].some((ws) => ws.user.id === uid && ws.readyState === 1);

// ---------- ход партии: ИИ, таймеры, уведомления ----------

/** После каждого изменения: кто дальше — компьютер, таймер боя, письмо игроку. */
function afterChange(r, prevTurn) {
  const g = r.game;
  const L = rt(r.code);
  clearTimeout(L.timer);
  L.timer = null;
  if (g.over) {
    if (r.status !== "over") { r.status = "over"; broadcastRoom(r); }
    return;
  }
  if (g.battle) {
    const s = activeStack(g.battle);
    if (!s) return;
    const pl = g.battle.sides[s.side].player;
    // Человек не в игре — ходим за него быстро, в игре — ждём, сколько положено.
    const ms = online(r, g.players[pl].uid) ? BATTLE_TURN_MS : 4000;
    L.timer = setTimeout(() => {
      if (!r.game.battle) return;
      const events = [];
      forceBattleStep(r.game, events);
      broadcastState(r, events);
      afterChange(r, r.game.turn);
    }, ms);
    return;
  }
  const cur = g.players[g.turn];
  if (cur.ai) {
    L.timer = setTimeout(() => aiStep(r), AI_DELAY_MS);
    return;
  }
  if (prevTurn !== g.turn && !online(r, cur.uid)) {
    notifier.turn(cur.uid, `⚔️ Ваш ход в «${r.name}» — день ${g.day}.`, r.code);
  }
}

function aiStep(r) {
  const g = r.game;
  if (!g || g.over || g.battle) return;
  const L = rt(r.code);
  const key = `${g.day}:${g.turn}`;
  if (L.aiKey !== key) { L.aiKey = key; L.aiMem = {}; }
  const p = g.turn;
  const a = nextAiAction(g, p, L.aiMem);
  let res = act(g, p, a);
  if (res.error) res = act(g, p, { type: "end" });
  broadcastState(r, res.events || []);
  afterChange(r, p);
}

// ---------- обработка сообщений ----------

const clean = (s, n) => String(s ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);

function handle(ws, m) {
  const uid = ws.user.id;
  const room = () => rooms.get(String(m.code || "").toUpperCase());
  switch (m.t) {
    case "lobby":
      ws.inLobby = true;
      if (ws.room) { rt(ws.room).subs.delete(ws); ws.room = null; }
      return sendLobby(ws);

    case "create": {
      const mineCount = [...rooms.values()].filter((r) => r.host === uid && r.status !== "over").length;
      if (mineCount >= MAX_ROOMS_PER_USER) return send(ws, { t: "error", text: `Не больше ${MAX_ROOMS_PER_USER} своих партий одновременно` });
      const faction = FACTION_IDS.includes(m.faction) ? m.faction : FACTION_IDS[0];
      const maxSeats = Math.min(4, Math.max(2, Number(m.maxSeats) || 2));
      const r = {
        code: newCode(), name: clean(m.name, 40) || `Партия ${ws.user.username}`, host: uid, status: "lobby",
        size: ["S", "M", "L"].includes(m.size) ? m.size : "M", maxSeats,
        seats: [{ uid, name: ws.user.username, faction }], game: null, chat: [], updated: Date.now(),
      };
      const ai = Math.min(maxSeats - 1, Math.max(0, Number(m.ai) || 0));
      for (let i = 0; i < ai; i++) addAi(r);
      rooms.set(r.code, r);
      openRoom(ws, r);
      return broadcastRoom(r);
    }

    case "join": {
      const r = room();
      if (!r) return send(ws, { t: "error", text: "Партия не найдена — проверьте код" });
      if (!r.seats.some((s) => s.uid === uid)) {
        if (r.status !== "lobby") return send(ws, { t: "error", text: "Партия уже идёт" });
        if (r.seats.length >= r.maxSeats) return send(ws, { t: "error", text: "Мест нет" });
        const faction = FACTION_IDS.includes(m.faction) ? m.faction : FACTION_IDS[r.seats.length % FACTION_IDS.length];
        r.seats.push({ uid, name: ws.user.username, faction });
      }
      openRoom(ws, r);
      return broadcastRoom(r);
    }

    case "open": {
      const r = room();
      if (!r) return send(ws, { t: "error", text: "Партия не найдена" });
      return openRoom(ws, r);
    }

    case "seat": {
      const r = room();
      if (!r || r.status !== "lobby") return;
      const i = Number(m.i ?? r.seats.findIndex((s) => s.uid === uid));
      const seat = r.seats[i];
      // Свою фракцию меняет сам игрок, фракцию компьютера — хозяин.
      if (!seat || !(seat.uid === uid || (seat.ai && r.host === uid))) return;
      if (FACTION_IDS.includes(m.faction)) seat.faction = m.faction;
      return broadcastRoom(r);
    }

    case "addAi": {
      const r = room();
      if (!r || r.host !== uid || r.status !== "lobby" || r.seats.length >= r.maxSeats) return;
      addAi(r);
      return broadcastRoom(r);
    }

    case "kick": {
      const r = room();
      const i = Number(m.i);
      if (!r || r.host !== uid || r.status !== "lobby" || !r.seats[i] || r.seats[i].uid === uid) return;
      r.seats.splice(i, 1);
      return broadcastRoom(r);
    }

    case "leave": {
      const r = room();
      if (!r) return;
      if (r.status === "lobby") {
        r.seats = r.seats.filter((s) => s.uid !== uid);
        if (!r.seats.some((s) => !s.ai)) { rooms.delete(r.code); scheduleSave(); pushLobbies(); }
        else {
          if (r.host === uid) r.host = r.seats.find((s) => !s.ai).uid;
          broadcastRoom(r);
        }
      } else if (r.status === "play") {
        // Сдаться: место переходит компьютеру, партия идёт дальше.
        const p = r.game.players.findIndex((pl) => pl.uid === uid);
        if (p >= 0) {
          r.game.players[p].ai = true;
          r.game.players[p].name += " (ИИ)";
          r.seats[p].ai = true;
          const events = [];
          if (r.game.battle) runBattleAI(r.game, events);
          broadcastState(r, events);
          afterChange(r, -1);
        }
      }
      return handle(ws, { t: "lobby" });
    }

    case "start": {
      const r = room();
      if (!r || r.host !== uid || r.status !== "lobby") return;
      if (r.seats.length < 2) return send(ws, { t: "error", text: "Нужно хотя бы двое: позовите друга или добавьте компьютер" });
      r.game = createGame({
        seed: randomInt(2 ** 31), size: r.size,
        players: r.seats.map((s) => ({ uid: s.uid, name: s.name, faction: s.faction, ai: !!s.ai })),
      });
      r.status = "play";
      broadcastState(r, [{ type: "start" }]);
      afterChange(r, -1);
      return;
    }

    case "act": {
      const r = room();
      if (!r?.game || r.status !== "play") return send(ws, { t: "error", text: "Партия не идёт" });
      const p = r.game.players.findIndex((pl) => pl.uid === uid);
      if (p < 0 || r.game.players[p].ai) return send(ws, { t: "error", text: "Вы не в этой партии" });
      const prevTurn = r.game.turn;
      const res = act(r.game, p, m.action);
      if (res.error) return send(ws, { t: "error", text: res.error, code: r.code });
      broadcastState(r, res.events);
      afterChange(r, prevTurn);
      return;
    }

    case "chat": {
      const r = room();
      const text = clean(m.text, 300);
      if (!r || !text || !r.seats.some((s) => s.uid === uid)) return;
      const msg = { from: ws.user.username, text, at: Date.now() };
      r.chat.push(msg);
      if (r.chat.length > 50) r.chat.shift();
      scheduleSave();
      for (const s of rt(r.code).subs) send(s, { t: "chat", code: r.code, msg });
      return;
    }
  }
}

function addAi(r) {
  const used = new Set(r.seats.map((s) => s.faction));
  const faction = FACTION_IDS.find((f) => !used.has(f)) || FACTION_IDS[r.seats.length % FACTION_IDS.length];
  const n = r.seats.filter((s) => s.ai).length + 1;
  r.seats.push({ uid: `ai:${r.code}:${n}:${Date.now() % 1e6}`, name: `Компьютер ${n}`, faction, ai: true });
}

function openRoom(ws, r) {
  if (ws.room && ws.room !== r.code) rt(ws.room).subs.delete(ws);
  ws.room = r.code;
  ws.inLobby = false;
  rt(r.code).subs.add(ws);
  send(ws, { t: "room", room: summary(r, ws.user.id), chat: r.chat });
  if (r.game) {
    send(ws, { t: "state", code: r.code, room: summary(r, ws.user.id), state: r.game, events: [] });
    // Вернулся участник боя — даём ему полное время на ход.
    if (r.game.battle) afterChange(r, r.game.turn);
  }
}

// ---------- HTTP ----------

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json" };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  let path = decodeURIComponent(url.pathname);
  if (path === "/health") { res.writeHead(200, { "Content-Type": "text/plain" }); return res.end("ok"); }
  if (path === "/" || path === "") path = "/index.html";
  // /shared/ — общий код партии (его же считает сервер), остальное — public/.
  const shared = path.startsWith("/shared/");
  const base = join(ROOT, shared ? "shared" : "public");
  const file = normalize(join(base, shared ? path.slice("/shared".length) : path));
  if (!file.startsWith(base + "/")) { res.writeHead(403); return res.end(); }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      "Content-Type": TYPES[extname(file)] || "application/octet-stream",
      "Cache-Control": "no-cache",
      // Окно WYX встраивает страницу: веб, iPhone, Android, компьютер.
      "Content-Security-Policy": "frame-ancestors https://huyax.e-tree.su https://hyax.ru https://wyx.su capacitor://localhost https://localhost http://localhost:* app://hyax",
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});

const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 16 * 1024 });

wss.on("connection", (ws) => {
  sockets.add(ws);
  ws.alive = true;
  ws.on("pong", () => (ws.alive = true));
  let budget = 30; // действий в секунду с запасом: защита от залпа
  const refill = setInterval(() => (budget = Math.min(30, budget + 15)), 1000);
  ws.on("message", (raw) => {
    if (--budget < 0) return;
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }
    if (!m || typeof m !== "object") return;
    if (!ws.user) {
      if (m.t !== "auth") return;
      let user = checkInitData(m.initData, TOKEN);
      if (!user && DEV && m.dev) user = { id: `dev:${clean(m.dev, 20)}`, username: clean(m.dev, 20), photo_url: "" };
      if (!user) return send(ws, { t: "authError", text: "Откройте игру из WYX — данные запуска не подошли или устарели" });
      ws.user = user;
      send(ws, { t: "hello", me: { id: user.id, name: user.username }, factions: FACTION_IDS.map((f) => ({ id: f, name: FACTIONS[f].name, icon: FACTIONS[f].icon })) });
      return;
    }
    try { handle(ws, m); } catch (e) {
      console.error("handle:", e);
      send(ws, { t: "error", text: "Ошибка сервера" });
    }
  });
  ws.on("close", () => {
    clearInterval(refill);
    sockets.delete(ws);
    if (ws.room) rt(ws.room).subs.delete(ws);
  });
});

setInterval(() => {
  for (const ws of sockets) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false;
    ws.ping();
  }
}, 30000);

// После перезапуска: партии, где ход компьютера или идёт бой, продолжаем.
for (const r of rooms.values()) if (r.status === "play" && r.game) afterChange(r, r.game.turn);

server.listen(PORT, () => console.log(`Осколки Короны: http://localhost:${PORT}${DEV ? " (DEV)" : ""}`));

async function shutdown() {
  try { await writeFile(join(DATA, "rooms.json"), JSON.stringify([...rooms.values()])); } catch { /* уходим всё равно */ }
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
