// Клиент «Осколков Короны»: лобби, ожидание игроков, карта, город, бой.
// Состояние партии приходит с сервера целиком; здесь только показ и ввод.

import {
  FACTIONS, UNITS, RES, RES_ICON, RES_NAME, SPELLS, MINES, TERRAIN, HERO_COST, HERO_MP, MAX_HEROES, MARKET, STAT_NAME,
  crowdLabel, costOf, canAfford, xpFor, buildingName,
} from "./shared/data.js";
import { findPath, occupancy } from "./shared/map.js";
import {
  playerIndex, heroById, objById, townsOf, heroesOf, heroInTown, buildOptions, dailyIncome, maxMana,
} from "./shared/game.js";
import { moveRange, canShoot, activeStack, stackAt, turnQueue, speedOf, expectedDamage } from "./shared/battle.js";
import { neighbors } from "./shared/hex.js";
import { MapView, BattleView } from "./render.js";

const WA = window.WYX?.WebApp;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const SIZE_NAME = { S: "Малая", M: "Средняя", L: "Большая" };

let ws = null;
let me = null;
let room = null;
let state = null;
let myIdx = -1;
let chat = [];
let sheetView = null;      // что открыто в шторке: {kind, id?}
let pathTarget = null;     // [x, y] клетка, куда показан путь
let spellMode = null;      // заклинание, ждущее цель
let inBattle = false;
let lastBattle = null;     // для итогов
let wantRoom = new URLSearchParams(location.search).get("room");

WA?.ready();

// ================= сеть =================

function connect() {
  const url = new URL("ws", location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(url);
  ws.onopen = () => {
    $("conn").classList.add("hidden");
    if (WA?.initData) send({ t: "auth", initData: WA.initData });
    else send({ t: "auth", dev: devName() });
  };
  ws.onmessage = (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    onMsg(m);
  };
  ws.onclose = () => {
    $("conn").classList.remove("hidden");
    setTimeout(connect, 2000);
  };
}

/** Вне WYX (проверка на своей машине) — имя из ?dev= или спрашиваем. */
function devName() {
  const q = new URLSearchParams(location.search).get("dev");
  if (q) return q;
  let n = "";
  try { n = localStorage.getItem("shards:dev") || ""; } catch { /* приватный режим */ }
  if (!n) {
    n = (prompt("Имя игрока (вне WYX)") || "").trim() || `Гость${Math.floor(Math.random() * 1000)}`;
    try { localStorage.setItem("shards:dev", n); } catch { /* без памяти */ }
  }
  return n;
}

const send = (m) => ws?.readyState === 1 && ws.send(JSON.stringify(m));
const act = (action) => send({ t: "act", code: room.code, action });

function onMsg(m) {
  switch (m.t) {
    case "hello":
      me = m.me;
      if (wantRoom) { send({ t: "join", code: wantRoom }); wantRoom = null; }
      else if (room) send({ t: "open", code: room.code });
      else send({ t: "lobby" });
      break;
    case "authError":
      show("lobby");
      $("mine").innerHTML = `<div class="empty">${esc(m.text)}</div>`;
      break;
    case "lobby": renderLobby(m); break;
    case "room":
      room = m.room;
      if (m.chat) chat = m.chat;
      if (room.status === "lobby") { state = null; renderRoom(); show("room"); }
      break;
    case "state": onState(m); break;
    case "chat":
      chat.push(m.msg);
      if (chat.length > 50) chat.shift();
      renderChat();
      if (m.msg.from !== me.name && !$("game").classList.contains("hidden") && sheetView?.kind !== "chat") toast(`💬 ${m.msg.from}: ${m.msg.text}`);
      break;
    case "error": toast(m.text, true); WA?.HapticFeedback.notificationOccurred("error"); break;
  }
}

// ================= экраны =================

function show(id) {
  for (const s of ["lobby", "room", "game", "battle"]) $(s).classList.toggle("hidden", s !== id && !(id === "battle" && s === "game"));
  updateBack();
}

function updateBack() {
  if (!WA) return;
  const deep = !$("sheet").classList.contains("hidden") || $("lobby").classList.contains("hidden");
  deep ? WA.BackButton.show() : WA.BackButton.hide();
}
WA?.BackButton.onClick(() => {
  if (!$("sheet").classList.contains("hidden")) return closeSheet();
  if (spellMode) return cancelSpell();
  if (inBattle) return;
  goLobby();
});

function goLobby() {
  room = null; state = null; inBattle = false;
  closeSheet();
  show("lobby");
  send({ t: "lobby" });
}

let toastTimer = null;
function toast(text, err = false) {
  const t = $("toast");
  t.textContent = text;
  t.className = `toast${err ? " err" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 2600);
}

function openSheet(view, html) {
  sheetView = view;
  $("sheetBody").innerHTML = html;
  $("sheet").classList.remove("hidden");
  updateBack();
}
function closeSheet() {
  sheetView = null;
  $("sheet").classList.add("hidden");
  updateBack();
}
$("sheetClose").onclick = closeSheet;
$("sheet").addEventListener("click", (e) => { if (e.target === $("sheet") && sheetView?.kind !== "chest") closeSheet(); });

// ================= лобби =================

function renderLobby({ mine, open }) {
  if (!room) show("lobby");
  $("mine").innerHTML = mine.length ? mine.map((r) => {
    const st = r.status === "lobby" ? `Ждём игроков ${r.seats.length}/${r.maxSeats}`
      : r.status === "over" ? (r.winner ? `Победа: ${esc(r.winner)}` : "Окончена")
      : `День ${r.day} · ходит ${esc(r.turnName)}`;
    return `<div class="card" data-open="${r.code}"><div class="grow"><div class="t">${esc(r.name)}</div><div class="muted small">${st}</div></div>
      ${r.myTurn ? '<span class="badge go">Ваш ход</span>' : `<span class="badge">${r.code}</span>`}</div>`;
  }).join("") : '<div class="empty">Пока нет. Создайте партию — с друзьями или против компьютера.</div>';
  $("open").innerHTML = open.length ? open.map((r) => `<div class="card" data-join="${r.code}">
      <div class="grow"><div class="t">${esc(r.name)}</div><div class="muted small">${esc(r.seats[0]?.name || "")} · ${SIZE_NAME[r.size]} карта · ${r.seats.length}/${r.maxSeats}</div></div>
      <span class="badge">Войти</span></div>`).join("") : '<div class="empty">Открытых партий нет.</div>';
  for (const el of document.querySelectorAll("[data-open]")) el.onclick = () => send({ t: "open", code: el.dataset.open });
  for (const el of document.querySelectorAll("[data-join]")) el.onclick = () => joinSheet(el.dataset.join);
}

function factionSeg(name, cur) {
  return `<div class="seg" data-seg="${name}">${Object.entries(FACTIONS).map(([id, f]) =>
    `<button type="button" data-v="${id}" class="${id === cur ? "on" : ""}">${f.icon} ${f.name}</button>`).join("")}</div>`;
}
function seg(name, opts, cur) {
  return `<div class="seg" data-seg="${name}">${opts.map(([v, t]) => `<button type="button" data-v="${v}" class="${String(v) === String(cur) ? "on" : ""}">${t}</button>`).join("")}</div>`;
}
function bindSegs(root, onChange) {
  const vals = {};
  for (const s of root.querySelectorAll("[data-seg]")) {
    vals[s.dataset.seg] = s.querySelector(".on")?.dataset.v;
    for (const b of s.querySelectorAll("button")) b.onclick = () => {
      for (const x of s.querySelectorAll("button")) x.classList.toggle("on", x === b);
      vals[s.dataset.seg] = b.dataset.v;
      onChange?.(vals, s.dataset.seg);
    };
  }
  return vals;
}

$("btnNew").onclick = () => {
  const draw = (v) => {
    const seats = Number(v.seats);
    openSheet({ kind: "create" }, `<h3>Новая партия</h3>
      <label class="f">Название</label><input type="text" id="cName" maxlength="40" placeholder="Партия ${esc(me?.name || "")}" value="${esc(v.name || "")}">
      <label class="f">Карта</label>${seg("size", [["S", "Малая"], ["M", "Средняя"], ["L", "Большая"]], v.size)}
      <label class="f">Игроков</label>${seg("seats", [[2, "2"], [3, "3"], [4, "4"]], seats)}
      <label class="f">Из них компьютеров</label>${seg("ai", Array.from({ length: seats }, (_, i) => [i, i ? String(i) : "Нет"]), Math.min(Number(v.ai), seats - 1))}
      <label class="f">Ваша фракция</label>${factionSeg("faction", v.faction)}
      <button class="btn primary wide" id="cGo">Создать</button>`);
    const vals = bindSegs($("sheetBody"), (nv, which) => { if (which === "seats") { nv.name = $("cName").value; draw(nv); } });
    $("cGo").onclick = () => {
      send({ t: "create", name: $("cName").value, size: vals.size, maxSeats: Number(vals.seats), ai: Number(vals.ai), faction: vals.faction });
      closeSheet();
    };
  };
  draw({ size: "M", seats: 2, ai: 0, faction: "dawn" });
};

$("btnCode").onclick = () => joinSheet("");

function joinSheet(code) {
  openSheet({ kind: "join" }, `<h3>Войти в партию</h3>
    <label class="f">Код</label><input type="text" id="jCode" maxlength="5" value="${esc(code)}" placeholder="ABCDE" style="text-transform:uppercase;letter-spacing:.2em">
    <label class="f">Фракция</label>${factionSeg("faction", "wild")}
    <button class="btn primary wide" id="jGo">Войти</button>`);
  const vals = bindSegs($("sheetBody"));
  $("jGo").onclick = () => {
    const c = $("jCode").value.trim().toUpperCase();
    if (c.length < 5) return toast("Код — пять знаков", true);
    send({ t: "join", code: c, faction: vals.faction });
    closeSheet();
  };
}

// ================= ожидание игроков =================

function renderRoom() {
  const host = room.host === me.id;
  $("roomName").textContent = room.name;
  $("roomMeta").textContent = `${SIZE_NAME[room.size]} карта · мест ${room.maxSeats}`;
  $("roomCode").textContent = room.code;
  $("seats").innerHTML = room.seats.map((s, i) => {
    const mine = s.uid === me.id;
    const canEdit = mine || (s.ai && host);
    const fac = canEdit
      ? `<select data-fac="${i}">${Object.entries(FACTIONS).map(([id, f]) => `<option value="${id}" ${id === s.faction ? "selected" : ""}>${f.icon} ${f.name}</option>`).join("")}</select>`
      : `<span class="muted small">${FACTIONS[s.faction].icon} ${FACTIONS[s.faction].name}</span>`;
    const kick = host && !mine ? `<button class="icon" data-kick="${i}" aria-label="Убрать">✕</button>` : "";
    return `<div class="seat"><span class="dot" style="background:${["#e04848", "#3b82f6", "#22b573", "#f2a516"][i]}"></span>
      <div class="grow">${s.ai ? "🤖 " : ""}${esc(s.name)}${mine ? ' <span class="muted small">(вы)</span>' : ""}${s.uid === room.host ? ' <span class="muted small">· хозяин</span>' : ""}</div>${fac}${kick}</div>`;
  }).join("") + Array.from({ length: room.maxSeats - room.seats.length }, () => '<div class="seat muted"><span class="dot" style="background:#444"></span>Свободное место</div>').join("");
  for (const el of document.querySelectorAll("[data-fac]")) el.onchange = () => send({ t: "seat", code: room.code, i: Number(el.dataset.fac), faction: el.value });
  for (const el of document.querySelectorAll("[data-kick]")) el.onclick = () => send({ t: "kick", code: room.code, i: Number(el.dataset.kick) });
  $("addAi").classList.toggle("hidden", !host || room.seats.length >= room.maxSeats);
  $("startGame").classList.toggle("hidden", !host);
  $("startGame").disabled = room.seats.length < 2;
  $("startGame").textContent = room.seats.length < 2 ? "Ждём второго игрока…" : "Начать партию";
  renderChat();
}

$("roomBack").onclick = goLobby;
$("copyCode").onclick = async () => {
  const text = `Заходи в «Осколки Короны»: код партии ${room.code}`;
  try { await navigator.clipboard.writeText(text); toast("Скопировано — отправьте другу"); }
  catch { toast(`Код: ${room.code}`); }
};
$("addAi").onclick = () => send({ t: "addAi", code: room.code });
$("startGame").onclick = () => send({ t: "start", code: room.code });
$("leaveRoom").onclick = () => { send({ t: "leave", code: room.code }); room = null; };

function chatHtml() {
  return `<div class="msgs" id="chatMsgs">${chat.map((c) => `<div><b>${esc(c.from)}:</b> ${esc(c.text)}</div>`).join("") || '<div class="muted small">Сообщений пока нет</div>'}</div>
    <form id="chatForm"><input type="text" id="chatText" maxlength="300" placeholder="Сообщение"><button class="btn">➤</button></form>`;
}
function bindChat() {
  const f = $("chatForm");
  if (!f) return;
  f.onsubmit = (e) => {
    e.preventDefault();
    const t = $("chatText").value.trim();
    if (t) send({ t: "chat", code: room.code, text: t });
    $("chatText").value = "";
  };
  const m = $("chatMsgs");
  m.scrollTop = m.scrollHeight;
}
function renderChat() {
  if (!room) return;
  if (!$("room").classList.contains("hidden")) {
    const typed = $("chatText")?.value || "";
    $("roomChat").innerHTML = `<h2>Чат</h2>${chatHtml()}`;
    $("chatText").value = typed;
    bindChat();
  } else if (sheetView?.kind === "chat") openChat();
}

// ================= партия =================

const mapView = new MapView($("map"), { onTap: onMapTap });
const battleView = new BattleView($("bfield"), { onTap: onBattleTap });
let centeredFor = null;

const myTurn = () => state && !state.over && state.turn === myIdx && !state.battle;

async function onState(m) {
  room = m.room;
  const first = !state || centeredFor !== room.code;
  const prev = state;
  state = m.state;
  myIdx = playerIndex(state, me.id);
  if ($("game").classList.contains("hidden") && !inBattle) show("game");
  mapView.setState(state, myIdx);
  if (first) {
    centeredFor = room.code;
    const h = heroesOf(state, myIdx)[0];
    const t = townsOf(state, myIdx)[0];
    const at = h || t;
    if (at) mapView.center(at.x, at.y);
    mapView.sel = h?.id || null;
  }
  if (mapView.sel && !heroById(state, mapView.sel)) mapView.sel = heroesOf(state, myIdx)[0]?.id || null;
  mapView.path = null;
  pathTarget = null;

  for (const e of m.events) {
    if (e.type === "move" && prev && myIdx >= 0) {
      const h = heroById(state, e.hero);
      if (h && (h.owner === myIdx || e.path.some(([x, y]) => state.players[myIdx].seen[y * state.w + x] === "1"))) {
        await mapView.animate(e.hero, e.path);
      }
    }
    if (e.type === "battleEnd") lastBattle = e;
    if (e.type === "turn" && e.player === myIdx) {
      toast(`Ваш ход! День ${e.day}`);
      WA?.HapticFeedback.notificationOccurred("success");
      const h = heroesOf(state, myIdx).find((x) => x.id === mapView.sel) || heroesOf(state, myIdx)[0];
      if (h) { mapView.sel = h.id; mapView.center(h.x, h.y); }
    }
    if (e.type === "levelup" && heroById(state, e.hero)?.owner === myIdx) toast(`⭐ ${heroById(state, e.hero).name}: уровень ${e.level}, ${STAT_NAME[e.stat]} +1`);
    if (e.type === "pickup" && myTurn()) toast(`${RES_ICON[e.res]} +${e.amt} ${RES_NAME[e.res].toLowerCase()}`);
    if (e.type === "week") toast("Новая неделя: в жилищах пополнение");
  }
  renderGame();
  renderBattle(m.events);
  if (sheetView?.kind === "town") openTown(sheetView.id);
  else if (sheetView?.kind === "hero") openHero(sheetView.id);
  if (lastBattle && !state.battle && (lastBattle.attacker === myIdx || lastBattle.defender === myIdx)) showBattleResult(lastBattle);
  lastBattle = state.battle ? lastBattle : null;
  if (state.pending?.player === myIdx) showChest();
  if (m.events.some((e) => e.type === "gameOver")) showGameOver();
}

function renderGame() {
  const pl = state.players[myIdx];
  if (pl) {
    const inc = dailyIncome(state, myIdx);
    $("resbar").innerHTML = RES.map((r) => `<span>${RES_ICON[r]} ${pl.res[r]}${inc[r] ? `<small>+${inc[r]}</small>` : ""}</span>`).join("");
  } else $("resbar").innerHTML = '<span class="muted">Зритель</span>';
  $("daybar").innerHTML = `День ${((state.day - 1) % 7) + 1}<br>Неделя ${Math.ceil(state.day / 7)}`;

  const heroes = heroesOf(state, myIdx);
  $("heroes").innerHTML = heroes.map((h) => `<button class="chip ${h.id === mapView.sel ? "on" : ""}" data-hero="${h.id}" title="${esc(h.name)}">
    ${FACTIONS[h.faction].heroIcon}<span class="mp"><i style="width:${Math.round(h.mp / HERO_MP * 100)}%"></i></span></button>`).join("");
  $("towns").innerHTML = townsOf(state, myIdx).map((t) => `<button class="chip" data-town="${t.id}" title="${esc(t.name)}">${FACTIONS[t.faction].town}</button>`).join("");
  for (const el of document.querySelectorAll("[data-hero]")) el.onclick = () => {
    const h = heroById(state, el.dataset.hero);
    if (mapView.sel === h.id) openHero(h.id);
    mapView.sel = h.id; mapView.path = null; pathTarget = null;
    mapView.center(h.x, h.y);
    renderGame();
  };
  for (const el of document.querySelectorAll("[data-town]")) el.onclick = () => {
    const t = objById(state, el.dataset.town);
    mapView.center(t.x, t.y);
    openTown(t.id);
  };
  const mine = myTurn();
  $("endTurn").disabled = !mine;
  const wb = $("waitbar");
  if (state.over) { wb.textContent = state.winner !== null ? `🏆 Победа: ${state.players[state.winner].name}` : "Партия окончена"; wb.classList.remove("hidden"); }
  else if (state.battle && !inBattle) { wb.textContent = `⚔️ Идёт бой…`; wb.classList.remove("hidden"); }
  else if (!mine) { wb.textContent = `Ходит ${state.players[state.turn].name}…`; wb.classList.remove("hidden"); }
  else wb.classList.add("hidden");
  $("info").classList.add("hidden");
}

$("endTurn").onclick = () => {
  const idle = heroesOf(state, myIdx).filter((h) => h.mp >= 60);
  if (idle.length && WA) {
    WA.showConfirm(`У героев ещё есть ход (${idle.map((h) => h.name).join(", ")}). Закончить день?`, (ok) => ok && act({ type: "end" }));
  } else if (idle.length && !confirm(`У героев ещё есть ход. Закончить день?`)) return;
  else act({ type: "end" });
};

function describeTile(x, y) {
  const seen = state.players[myIdx]?.seen;
  if (seen && seen[y * state.w + x] !== "1") return "Неизведанные земли";
  const cell = occupancy(state).get(`${x},${y}`) || {};
  const parts = [];
  if (cell.hero) {
    const h = cell.hero;
    parts.push(`${FACTIONS[h.faction].heroIcon} <b>${esc(h.name)}</b>, ур. ${h.level} — ${esc(state.players[h.owner].name)}`);
  }
  const o = cell.obj;
  if (o) {
    const owner = o.owner !== null && o.owner !== undefined ? esc(state.players[o.owner].name) : "ничей";
    if (o.kind === "monster") parts.push(`${UNITS[o.u].icon} <b>${UNITS[o.u].name}</b> — ${crowdLabel(o.n).toLowerCase()}`);
    else if (o.kind === "town") parts.push(`${FACTIONS[o.faction].town} <b>${esc(o.name)}</b> — ${FACTIONS[o.faction].name}, ${owner}${o.owner === null && o.garrison.some(Boolean) ? ", под охраной" : ""}`);
    else if (o.kind === "mine") parts.push(`${MINES[o.res].icon} <b>${MINES[o.res].name}</b> (+${MINES[o.res].daily} ${RES_ICON[o.res]} в день) — ${owner}`);
    else if (o.kind === "res") parts.push(`${RES_ICON[o.res]} ${RES_NAME[o.res]}: ${o.amt}`);
    else if (o.kind === "chest") parts.push("🧰 Сундук: золото или опыт");
    else if (o.kind === "shrine") parts.push(`⛩️ Святыня: ${STAT_NAME[o.stat]} +1${o.visited.includes(mapView.sel) ? " (уже были)" : ""}`);
    else if (o.kind === "well") parts.push("⛲ Колодец: восполняет ману");
  }
  if (!parts.length) parts.push(TERRAIN[state.terrain[y * state.w + x]].name);
  return parts.join("<br>");
}

function info(html) {
  const el = $("info");
  el.innerHTML = html;
  el.classList.remove("hidden");
}

function onMapTap(x, y) {
  if (!state || myIdx < 0) return;
  const cell = occupancy(state).get(`${x},${y}`) || {};
  const sel = heroById(state, mapView.sel);
  // Свой герой: выбрать; выбранный — открыть (на клетке города — город).
  if (cell.hero && cell.hero.owner === myIdx) {
    if (sel?.id === cell.hero.id) {
      if (cell.obj?.kind === "town") openTown(cell.obj.id); else openHero(cell.hero.id);
    } else {
      mapView.sel = cell.hero.id; mapView.path = null; pathTarget = null;
      renderGame();
    }
    return;
  }
  if (cell.obj?.kind === "town" && cell.obj.owner === myIdx && !(sel && pathTarget && pathTarget[0] === x && pathTarget[1] === y) && (!sel || !myTurn())) {
    openTown(cell.obj.id);
    return;
  }
  if (!sel || !myTurn()) { info(describeTile(x, y)); return; }
  if (pathTarget && pathTarget[0] === x && pathTarget[1] === y) {
    act({ type: "move", hero: sel.id, x, y });
    mapView.path = null; pathTarget = null;
    $("info").classList.add("hidden");
    return;
  }
  const path = findPath(state, sel, x, y, state.players[myIdx].seen);
  if (!path) { mapView.path = null; pathTarget = null; mapView.dirty = true; info(describeTile(x, y) + '<br><span class="muted small">Туда не пройти</span>'); return; }
  mapView.path = path; pathTarget = [x, y]; mapView.dirty = true;
  const cost = path[path.length - 1].cost;
  const days = cost <= sel.mp ? "дойдёт сегодня" : `≈ ${1 + Math.ceil((cost - sel.mp) / HERO_MP)} дн.`;
  info(`${describeTile(x, y)}<br><span class="muted small">${days} — нажмите ещё раз, чтобы идти</span>`);
  WA?.HapticFeedback.selectionChanged();
}

// ---------- город ----------

function slotHtml(s, attr) {
  if (!s) return `<button class="slot empty" disabled></button>`;
  const u = UNITS[s.u];
  return `<button class="slot" ${attr} title="${u.name}">${u.icon}<small>${s.n}</small></button>`;
}

const costHtml = (c) => Object.entries(c).map(([k, v]) => `${RES_ICON[k]}${v}`).join(" ");
const recruitN = {};

function openTown(id) {
  const t = objById(state, id);
  if (!t || t.kind !== "town") return closeSheet();
  const mine = t.owner === myIdx;
  const f = FACTIONS[t.faction];
  const pl = state.players[myIdx];
  const hero = heroInTown(state, t);
  const can = mine && myTurn();
  let html = `<h3>${f.town} ${esc(t.name)}</h3><div class="muted small">${f.name} · доход ${t.built.hall3 ? 2000 : t.built.hall2 ? 1000 : 500} 💰 в день</div>`;
  if (!mine) {
    openSheet({ kind: "town", id }, html + `<p class="muted">Чужой город.</p>`);
    return;
  }
  // Найм.
  html += `<h4>Найм</h4>`;
  for (let tier = 1; tier <= 5; tier++) {
    if (!t.built[`dw${tier}`]) continue;
    const uid = f.units[tier - 1];
    const u = UNITS[uid];
    const stock = t.stock[tier] || 0;
    let maxN = stock;
    while (maxN > 0 && !canAfford(pl.res, costOf(uid, maxN))) maxN--;
    const k = `${id}:${tier}`;
    recruitN[k] = Math.min(recruitN[k] ?? maxN, maxN);
    const n = recruitN[k];
    html += `<div class="line"><div class="ic">${u.icon}</div><div class="grow"><b>${u.name}</b>
      <div class="cost">⚔${u.atk} 🛡${u.def} ❤${u.hp} 💥${u.dmg[0]}–${u.dmg[1]} 👟${u.spd}${u.shots ? " 🏹" : ""}${u.fly ? " 🪽" : ""}</div>
      <div class="cost">${costHtml(u.cost)} за шт. · есть ${stock}</div></div>
      <div><div class="stepper"><button data-rn="${k}" data-d="-1">−</button><span>${n}</span><button data-rn="${k}" data-d="1">+</button></div>
      <button class="btn small wide" data-rec="${tier}" ${!can || !n ? "disabled" : ""}>Нанять</button></div></div>`;
  }
  // Армия.
  html += `<h4>Гарнизон</h4><div class="slots">${t.garrison.map((s, i) => slotHtml(s, `data-tr="garrison" data-slot="${i}"`)).join("")}</div>`;
  if (hero && hero.owner === myIdx) html += `<h4>${FACTIONS[hero.faction].heroIcon} ${esc(hero.name)} <span class="muted">(нажмите на отряд — переложить)</span></h4><div class="slots">${hero.army.map((s, i) => slotHtml(s, `data-tr="hero" data-slot="${i}"`)).join("")}</div>`;
  else html += `<p class="muted small">Приведите героя в город — сможете передать ему войска.</p>`;
  // Постройки.
  const opts = buildOptions(state, t);
  html += `<h4>Постройки ${t.builtDay === state.day ? '<span class="muted">(сегодня уже строили)</span>' : ""}</h4>`;
  for (const o of opts) {
    html += `<div class="line"><div class="grow"><b>${esc(o.name)}</b><div class="cost">${esc(o.desc || "")}</div>
      <div class="cost">${costHtml(o.cost)}</div>${o.why && !o.ok ? `<div class="why">${esc(o.why)}</div>` : ""}</div>
      <button class="btn small" data-build="${o.id}" ${!can || !o.ok ? "disabled" : ""}>Строить</button></div>`;
  }
  const built = Object.keys(t.built).filter((b) => b !== "hall").map((b) => b === "dw1" ? f.dwellings[0] : buildingName(t.faction, b));
  html += `<div class="muted small" style="margin-top:8px">Построено: ${esc(built.join(", "))}</div>`;
  if (t.spells.length) html += `<div class="muted small">Заклинания гильдии: ${t.spells.map((s) => `${SPELLS[s].icon} ${SPELLS[s].name}`).join(", ")}</div>`;
  // Таверна.
  html += `<h4>Таверна</h4><div class="line"><div class="ic">🍺</div><div class="grow">Нанять героя<div class="cost">💰${HERO_COST} · героев ${heroesOf(state, myIdx).length}/${MAX_HEROES}</div></div>
    <button class="btn small" id="hire" ${!can || hero || heroesOf(state, myIdx).length >= MAX_HEROES || pl.res.gold < HERO_COST ? "disabled" : ""}>Нанять</button></div>`;
  // Рынок.
  if (t.built.market) {
    html += `<h4>Рынок</h4>`;
    for (const [r, rate] of Object.entries(MARKET)) {
      html += `<div class="line"><div class="ic">${RES_ICON[r]}</div><div class="grow">${RES_NAME[r]}<div class="cost">продать за ${rate.sell} · купить за ${rate.buy}</div></div>
        <button class="btn small" data-trade="sell" data-res="${r}" ${!can ? "disabled" : ""}>−5</button>
        <button class="btn small" data-trade="buy" data-res="${r}" ${!can ? "disabled" : ""}>+1</button></div>`;
    }
  }
  openSheet({ kind: "town", id }, html);
  const body = $("sheetBody");
  for (const b of body.querySelectorAll("[data-rn]")) b.onclick = () => {
    const k = b.dataset.rn;
    const tier = Number(k.split(":")[1]);
    const uid = f.units[tier - 1];
    let n = Math.max(0, (recruitN[k] || 0) + Number(b.dataset.d));
    if (n > (t.stock[tier] || 0) || !canAfford(pl.res, costOf(uid, n))) n = recruitN[k];
    recruitN[k] = n;
    openTown(id);
  };
  for (const b of body.querySelectorAll("[data-rec]")) b.onclick = () => {
    const tier = Number(b.dataset.rec);
    const n = recruitN[`${id}:${tier}`];
    delete recruitN[`${id}:${tier}`];
    act({ type: "recruit", town: id, tier, n });
  };
  for (const b of body.querySelectorAll("[data-tr]")) b.onclick = () => can && act({ type: "transfer", town: id, from: b.dataset.tr, slot: Number(b.dataset.slot) });
  for (const b of body.querySelectorAll("[data-build]")) b.onclick = () => act({ type: "build", town: id, id: b.dataset.build });
  for (const b of body.querySelectorAll("[data-trade]")) b.onclick = () => act({ type: "trade", town: id, dir: b.dataset.trade, res: b.dataset.res, n: b.dataset.trade === "sell" ? 5 : 1 });
  const hb = $("hire");
  if (hb) hb.onclick = () => act({ type: "hire", town: id });
}

// ---------- герой ----------

function openHero(id) {
  const h = heroById(state, id);
  if (!h) return closeSheet();
  const next = xpFor(h.level + 1);
  openSheet({ kind: "hero", id }, `<h3>${FACTIONS[h.faction].heroIcon} ${esc(h.name)}</h3>
    <div class="muted small">Уровень ${h.level} · опыт ${h.xp}/${next} · ход ${h.mp}/${HERO_MP} · мана ${h.mana}/${maxMana(h)}</div>
    <h4>Навыки</h4><div class="stats">
      <div><b>${h.atk}</b><span>Атака</span></div><div><b>${h.def}</b><span>Защита</span></div>
      <div><b>${h.power}</b><span>Сила</span></div><div><b>${h.know}</b><span>Знание</span></div></div>
    <h4>Армия</h4><div class="slots">${h.army.map((s) => slotHtml(s, "")).join("")}</div>
    <div class="muted small" style="margin-top:6px">${h.army.filter(Boolean).map((s) => `${UNITS[s.u].icon} ${UNITS[s.u].name} ×${s.n}`).join(" · ")}</div>
    <h4>Заклинания</h4>${h.spells.length ? h.spells.map((s) => `<div class="line"><div class="ic">${SPELLS[s].icon}</div><div class="grow"><b>${SPELLS[s].name}</b> · ${SPELLS[s].mana} маны<div class="cost">${SPELLS[s].desc}</div></div></div>`).join("")
      : '<p class="muted small">Нет. Постройте гильдию магов и зайдите героем в город.</p>'}`);
}

// ---------- сундук, итоги, конец ----------

function showChest() {
  const p = state.pending;
  openSheet({ kind: "chest" }, `<h3>🧰 Сундук</h3><p class="muted">Что взять?</p>
    <div class="choice"><button class="btn primary" id="chG">💰 ${p.gold} золота</button><button class="btn" id="chX">⭐ ${p.xp} опыта</button></div>`);
  $("sheetClose").classList.add("hidden");
  $("chG").onclick = () => { $("sheetClose").classList.remove("hidden"); closeSheet(); act({ type: "choose", opt: "gold" }); };
  $("chX").onclick = () => { $("sheetClose").classList.remove("hidden"); closeSheet(); act({ type: "choose", opt: "xp" }); };
}

function showBattleResult(e) {
  const mySide = e.attacker === myIdx ? 0 : 1;
  const won = e.winner === mySide;
  const list = (l) => l.list.map((x) => `${UNITS[x.u].icon} ${UNITS[x.u].name} ×${x.n}`).join("<br>") || "—";
  WA?.HapticFeedback.notificationOccurred(won ? "success" : "error");
  openSheet({ kind: "result" }, `<h3>${won ? "🏆 Победа!" : "☠️ Поражение"}</h3>
    <h4>Ваши потери</h4><div>${list(e.lost[mySide])}</div>
    <h4>Потери противника</h4><div>${list(e.lost[1 - mySide])}</div>
    ${won ? `<p class="muted small">Опыт героя: +${e.lost[1 - mySide].hp}</p>` : '<p class="muted small">Герой пал. Нанять нового можно в таверне города.</p>'}
    <button class="btn primary wide" id="resOk">Дальше</button>`);
  $("resOk").onclick = closeSheet;
}

function showGameOver() {
  const won = state.winner === myIdx;
  openSheet({ kind: "over" }, `<h3>${won ? "👑 Корона ваша!" : "Партия окончена"}</h3>
    <p>${state.winner !== null ? `Победитель — ${esc(state.players[state.winner].name)}, на ${state.day}-й день.` : "Победителя нет."}</p>
    <button class="btn primary wide" id="overOk">В лобби</button>`);
  $("overOk").onclick = goLobby;
}

// ---------- меню ----------

$("menuBtn").onclick = () => {
  const playing = room.status === "play" && myIdx >= 0 && state.players[myIdx].alive && !state.players[myIdx].ai;
  openSheet({ kind: "menu" }, `<h3>${esc(room.name)}</h3><div class="muted small">Код ${room.code} · ${SIZE_NAME[room.size]} карта</div>
    <h4>Игроки</h4>${state.players.map((p, i) => `<div class="line"><span class="dot" style="background:${p.color}"></span><div class="grow">${p.ai ? "🤖 " : ""}${esc(p.name)} ${i === state.turn ? "· ходит" : ""}</div>
      <span class="muted small">${p.alive ? `${FACTIONS[p.faction].icon} ${townsOf(state, i).length} 🏰 ${heroesOf(state, i).length} 🧍` : "выбыл"}</span></div>`).join("")}
    <div class="menu"><button class="btn" id="mChat">💬 Чат</button><button class="btn" id="mLog">📜 Журнал</button>
    <button class="btn" id="mLobby">🏠 В лобби</button>${playing ? '<button class="btn danger" id="mGive">🏳️ Сдаться</button>' : ""}</div>`);
  $("mChat").onclick = openChat;
  $("mLog").onclick = () => openSheet({ kind: "log" }, `<h3>Журнал</h3><div class="loglist">${state.log.slice().reverse().map((l) => `<div>День ${l.day}: ${esc(l.text)}</div>`).join("")}</div>`);
  $("mLobby").onclick = goLobby;
  const g = $("mGive");
  if (g) g.onclick = () => {
    const go = () => { send({ t: "leave", code: room.code }); room = null; state = null; closeSheet(); };
    if (WA) WA.showConfirm("Сдаться? Ваше место займёт компьютер.", (ok) => ok && go());
    else if (confirm("Сдаться? Ваше место займёт компьютер.")) go();
  };
};

function openChat() {
  openSheet({ kind: "chat" }, `<h3>Чат партии</h3><div class="chat">${chatHtml()}</div>`);
  bindChat();
}

// ================= бой =================

function battleSide() {
  const b = state?.battle;
  return b ? b.sides.findIndex((s) => s.player === myIdx && myIdx >= 0) : -1;
}

function renderBattle(events) {
  const b = state.battle;
  const side = battleSide();
  if (!b || side < 0) {
    if (inBattle) { inBattle = false; show("game"); cancelSpell(); }
    return;
  }
  if (!inBattle) { inBattle = true; closeSheet(); show("battle"); WA?.HapticFeedback.impactOccurred("heavy"); }
  battleView.setBattle(b, state, side, events.filter((e) => e.to));
  if (events.some((e) => e.dmg)) WA?.HapticFeedback.impactOccurred("light");
  const act0 = activeStack(b);
  const myMove = act0 && act0.side === side && !b.auto[side];
  battleView.hl = myMove && !spellMode ? moveRange(b, act0) : null;
  const name = (sd) => sd.player === null ? "Нейтралы" : state.players[sd.player].name;
  $("bTitle").textContent = `${name(b.sides[0])} ⚔ ${name(b.sides[1])}`;
  $("bRound").textContent = `Раунд ${b.round}`;
  $("bQueue").innerHTML = turnQueue(b).slice(0, 12).map((s, i) => `<div class="q ${i === 0 ? "now" : ""}" style="border-color:${b.sides[s.side].player === null ? "#6b6f76" : state.players[b.sides[s.side].player].color}">${UNITS[s.u].icon}<small>${s.n}</small></div>`).join("");
  const last = b.log.slice(-2).map((l) => `<div class="log">${esc(l)}</div>`).join("");
  let head = "";
  if (act0) {
    const u = UNITS[act0.u];
    head = myMove ? `Ходит <b>${u.name} ×${act0.n}</b> (скорость ${speedOf(act0)}${act0.shots ? `, выстрелов ${act0.shots}` : ""}). ${canShoot(b, act0) ? "Нажмите на врага — выстрел." : "Нажмите клетку или врага."}`
      : b.auto[side] && act0.side === side ? "Автобой…" : "Ход противника…";
  }
  $("bInfo").innerHTML = `<div>${head}</div>${last}`;
  const hero = b.sides[side].hero;
  $("bWait").disabled = !myMove || act0.waited;
  $("bDef").disabled = !myMove;
  $("bSpell").disabled = !myMove || !hero || b.sides[side].cast || !hero.spells.some((s) => hero.mana >= SPELLS[s].mana);
  $("bSpell").textContent = hero ? `✨ Магия ${hero.mana}` : "✨ Магия";
  $("bAuto").classList.toggle("on", !!b.auto[side]);
}

$("bWait").onclick = () => act({ type: "bwait" });
$("bDef").onclick = () => act({ type: "bdefend" });
$("bAuto").onclick = () => act({ type: "bauto", on: !state.battle.auto[battleSide()] });
$("bSpell").onclick = () => {
  const b = state.battle, side = battleSide();
  const hero = b.sides[side].hero;
  openSheet({ kind: "spells" }, `<h3>Заклинания</h3><div class="muted small">Мана ${hero.mana} · одно заклинание за раунд</div>
    ${hero.spells.map((s) => { const sp = SPELLS[s]; const p = hero.power;
      const extra = s === "firebolt" ? ` · ${10 + 10 * p} урона` : s === "lightning" ? ` · ${25 + 15 * p} урона` : s === "mend" ? ` · ${20 + 15 * p} ОЗ` : "";
      return `<div class="line"><div class="ic">${sp.icon}</div><div class="grow"><b>${sp.name}</b> · ${sp.mana} маны<div class="cost">${sp.desc}${extra}</div></div>
      <button class="btn small" data-sp="${s}" ${hero.mana < sp.mana ? "disabled" : ""}>Выбрать</button></div>`; }).join("")}`);
  for (const el of $("sheetBody").querySelectorAll("[data-sp]")) el.onclick = () => {
    spellMode = el.dataset.sp;
    closeSheet();
    const enemy = SPELLS[spellMode].target === "enemy";
    battleView.targets = new Set(b.stacks.filter((s) => s.n > 0 && (s.side !== side) === enemy).map((s) => s.id));
    battleView.hl = null;
    $("bInfo").innerHTML = `${SPELLS[spellMode].icon} Выберите цель: ${enemy ? "отряд врага" : "свой отряд"}. <span class="muted">(нажмите мимо — отмена)</span>`;
  };
};

function cancelSpell() {
  spellMode = null;
  battleView.targets = null;
  if (state?.battle) renderBattle([]);
}

function onBattleTap(x, y, px, py) {
  const b = state?.battle;
  const side = battleSide();
  if (!b || side < 0) return;
  const s = stackAt(b, x, y);
  if (spellMode) {
    if (s && battleView.targets?.has(s.id)) act({ type: "bcast", spell: spellMode, target: s.id });
    cancelSpell();
    return;
  }
  const a = activeStack(b);
  const myMove = a && a.side === side && !b.auto[side];
  if (s && (s.side !== side || !myMove)) {
    if (myMove && s.side !== side) {
      if (canShoot(b, a)) return act({ type: "bshoot", target: s.id });
      const range = moveRange(b, a);
      const spots = neighbors(s.x, s.y).filter(([nx, ny]) => (nx === a.x && ny === a.y) || range.has(`${nx},${ny}`));
      if (!spots.length) return toast("Не дотянуться", true);
      // Сторона удара — та, ближе к которой нажали.
      spots.sort((p, q) => {
        const [pcx, pcy] = battleView.center(p[0], p[1]), [qcx, qcy] = battleView.center(q[0], q[1]);
        return Math.hypot(pcx - px, pcy - py) - Math.hypot(qcx - px, qcy - py);
      });
      return act({ type: "battack", target: s.id, x: spots[0][0], y: spots[0][1] });
    }
  }
  if (s) {
    const u = UNITS[s.u];
    const dmg = a && a.side === side && s.side !== side ? ` · ваш удар ≈ ${expectedDamage(b, a, s, canShoot(b, a))}` : "";
    $("bInfo").innerHTML = `<b>${u.name} ×${s.n}</b> — ⚔${u.atk} 🛡${u.def} ❤${s.hp}/${u.hp} 👟${speedOf(s)}${s.shots ? ` 🏹${s.shots}` : ""}${dmg}`;
    return;
  }
  if (myMove && battleView.hl?.has(`${x},${y}`)) act({ type: "bmove", x, y });
}

// Отладка вне WYX: состояние и действия из консоли и автотестов.
if (!WA?.initData) window.shards = { get state() { return state; }, get me() { return myIdx; }, act, send, battleView };

connect();
