// «Герои по сети»: машина игрока живёт на сервере (bots/retro-cloud), сюда идёт
// только экран по VNC (noVNC рисует в #screen), обратно — касания и клавиши.
// Комната — общая локальная сеть машин: хозяин создаёт, остальные входят по коду.
// Использует тот же экран #machine, что и эмулятор в браузере (app.js), но свои
// обработчики: app.js без запущенной машины (emu == null) ничего не шлёт.

import RFB from "./novnc/core/rfb.js";

const $ = (id) => document.getElementById(id);
const WA = window.WYX?.WebApp;
const store = { get: (k) => { try { return JSON.parse(localStorage.getItem("retro." + k)); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem("retro." + k, JSON.stringify(v)); } catch { /* нет памяти */ } } };
// Адрес сервиса: по умолчанию crystal через milf.hyax.ru; для проверки можно подменить в localStorage (retro.cloudWs).
const CLOUD_WS = store.get("cloudWs") || "wss://milf.hyax.ru/retro-cloud/ws";

let ws = null, rfb = null, size = { w: 1280, h: 1024 }, view = { x: 0, y: 0, w: 0, h: 0, k: 1 }, sizeWatch = null, fitTimer = null;
let mouseMode = store.get("mouse") || "rel"; // как в app.js: rel — тачпад, abs — указатель
const send = (o) => ws?.readyState === 1 && ws.send(JSON.stringify(o));
const toast = (text, ms = 2800) => { const t = $("toast"); t.textContent = text; t.classList.remove("hidden"); clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.add("hidden"), ms); };

// ---------- карточка на экране подготовки ----------
export function renderCloudCard() {
  const card = $("cloud"); if (!card) return;
  const last = store.get("cloudRoom") || "";
  card.innerHTML = `
    <div class="row"><div class="grow"><b>🌐 Герои по сети</b><div class="muted small">Машина на сервере, ничего качать не надо. Общая сеть с друзьями по коду комнаты — в игре выбирайте TCP/IP.</div></div></div>
    <div class="row" style="margin-top:10px"><input id="cloudRoom" class="grow" inputmode="numeric" maxlength="4" placeholder="код комнаты" value="${last}" style="min-width:0">
      <button class="btn small" id="cloudJoin">Войти</button><button class="btn small primary" id="cloudCreate">Создать</button></div>
    <p class="muted small" id="cloudNote" style="margin:8px 0 0"></p>`;
  card.classList.remove("hidden");
  $("cloudCreate").onclick = () => connect("");
  $("cloudJoin").onclick = () => { const c = $("cloudRoom").value.trim(); if (!/^\d{4}$/.test(c)) return toast("Код комнаты — четыре цифры"); connect(c); };
}

// ---------- канал для noVNC поверх нашего WebSocket ----------
function makeChannel(sock, onText) {
  // Приветствие VNC приходит раньше, чем noVNC навесит свой onmessage (он делает это
  // на следующем тике после конструктора) — двоичные кадры до того копим и отдаём потом.
  let handler = null; const pending = [];
  const ch = {
    binaryType: "arraybuffer", protocol: "", onopen: null, onclose: null, onerror: null,
    get onmessage() { return handler; },
    // Отдаём накопленное не сразу: noVNC вешает onmessage в attach(), а состояние
    // рукопожатия выставляет чуть позже (_socketOpen) — иначе «Unknown init state».
    set onmessage(fn) { handler = fn; if (fn && pending.length) setTimeout(() => { while (pending.length && handler) handler(pending.shift()); }, 0); },
    get readyState() { return ["connecting", "open", "closing", "closed"][sock.readyState]; },
    send: (d) => sock.send(d), close: () => sock.close(),
  };
  sock.onmessage = (e) => {
    if (typeof e.data === "string") { let m; try { m = JSON.parse(e.data); } catch { return; } onText(m); return; }
    if (handler) handler(e); else pending.push(e);
  };
  sock.onclose = (e) => ch.onclose?.(e);
  sock.onerror = (e) => ch.onerror?.(e);
  return ch;
}

const ERRORS = { no_wyx: WA?.initData ? "Сервер не принял данные запуска: проверьте токен бота на сервере" : "Откройте из WYX", denied: "Ваш аккаунт не в списке допуска", no_room: "Такой комнаты нет", busy: "Сервер занят: все машины заняты, попробуйте позже", vm_failed: "Машина не запустилась" };

function connect(room) {
  if (!WA?.initData && !store.get("cloudDevInit")) return toast("Герои по сети открываются только из WYX");
  disconnect();
  $("setup").classList.add("hidden"); $("machine").classList.remove("hidden");
  $("status").textContent = room ? `Вхожу в комнату ${room}…` : "Создаю комнату…";
  for (const id of ["filesBtn", "saveBtn", "soundBtn"]) $(id).classList.add("hidden");
  $("screen").querySelector("canvas").style.display = "none";
  $("screen").querySelector(".text").textContent = "";
  $("touch").style.cursor = mouseMode === "rel" ? "none" : "default";

  ws = new WebSocket(CLOUD_WS);
  ws.binaryType = "arraybuffer";
  ws.onopen = () => ws.send(JSON.stringify({ t: "hello", initData: WA?.initData || store.get("cloudDevInit"), room }));
  const ch = makeChannel(ws, (m) => {
    if (m.t === "ready") {
      size = { w: m.w, h: m.h };
      store.set("cloudRoom", m.room);
      $("status").textContent = `Комната ${m.room}`;
      rfb = new RFB($("screen"), ch, { shared: true });
      rfb.viewOnly = true; rfb.scaleViewport = false; rfb.showDotCursor = false; rfb.background = "#000";
      rfb.addEventListener("connect", () => { $("status").textContent = `Комната ${m.room} · подключено`; requestAnimationFrame(fit); showHint(); });
      // Надёжнее наблюдателя: раз в полсекунды сверяем размер холста с масштабом (дёшево).
      clearInterval(fitTimer); fitTimer = setInterval(fit, 500);
      rfb.addEventListener("desktopname", () => setTimeout(fit, 100));
      // Размер экрана машины известен только когда noVNC выставит размер своего холста
      // (новый холст — 300×150, по нему нельзя считать масштаб): следим за атрибутами.
      const cv = $("screen").querySelector(":scope > div > canvas");
      if (cv) { sizeWatch?.disconnect(); sizeWatch = new MutationObserver(() => requestAnimationFrame(fit)); sizeWatch.observe(cv, { attributes: true, attributeFilter: ["width", "height"] }); }
      rfb.addEventListener("disconnect", () => { if (ws) { $("status").textContent = "Связь с машиной потеряна"; } });
      // noVNC кладёт свой холст внутрь #screen; наш слой #touch остаётся сверху.
      const inner = $("screen").querySelector(":scope > div:not(.text)"); if (inner) inner.style.position = "relative";
    } else if (m.t === "room") {
      const names = m.players.map((p) => "@" + p.username).join(", ");
      $("status").textContent = `Комната ${m.code} · ${names}`;
    } else if (m.t === "error") {
      toast(ERRORS[m.m] || `Ошибка: ${m.m}`, 5000);
      leave();
    }
  });
  ws.onclose = () => { if (ws) { $("status").textContent = "Отключено"; } };
}

function disconnect() {
  clearInterval(fitTimer); fitTimer = null;
  if (locked()) document.exitPointerLock();
  try { rfb?.disconnect(); } catch { /* уже */ }
  rfb = null;
  if (ws) { const s = ws; ws = null; try { s.close(); } catch { /* уже */ } }
}
function leave() {
  disconnect();
  $("machine").classList.add("hidden"); $("setup").classList.remove("hidden");
  for (const id of ["filesBtn", "saveBtn", "soundBtn"]) $(id).classList.remove("hidden");
  const old = $("screen").querySelector(":scope > div:not(.text)"); if (old) old.remove();
}
export const cloudActive = () => !!ws;

// ---------- экран ----------
function fit() {
  if (!rfb) return;
  const stage = $("stage"), scr = $("screen");
  const cv = scr.querySelector(":scope > div > canvas"); // холст noVNC (не «div canvas»: #screen сам div, и так нашёлся бы наш скрытый холст)
  if (!cv || cv.width <= 1 || (cv.width === 300 && cv.height === 150)) return; // ещё не получил размер от сервера
  size = { w: cv.width, h: cv.height };
  const w = size.w, h = size.h;
  const k = Math.min(stage.clientWidth / w, stage.clientHeight / h);
  const x = (stage.clientWidth - w * k) / 2, y = (stage.clientHeight - h * k) / 2;
  const t = `translate(${x}px, ${y}px) scale(${k})`;
  if (scr.style.transform !== t) scr.style.transform = t;
  view = { x, y, w: w * k, h: h * k, k };
}
addEventListener("resize", () => requestAnimationFrame(fit));

function showHint() {
  if (store.get("cloudHinted")) return;
  store.set("cloudHinted", 1);
  const h = $("hint");
  h.textContent = mouseMode === "abs" ? "Указатель: коснитесь — клик там же, удержите — правая кнопка." : "Тачпад: водите пальцем — курсор едет, коснитесь — клик, двумя пальцами — правая. 🖱️ — сменить режим.";
  h.classList.remove("hidden");
  setTimeout(() => h.classList.add("hidden"), 7000);
}

// ---------- мышь ----------
// Точка экрана машины под пальцем (в пикселях экрана Windows).
function at(e) {
  const r = $("stage").getBoundingClientRect();
  return { x: Math.max(0, Math.min(size.w - 1, (e.clientX - r.left - view.x) / view.k)), y: Math.max(0, Math.min(size.h - 1, (e.clientY - r.top - view.y) / view.k)) };
}
const touch = $("touch");
const fingers = new Map();
let gesture = null, lastTapAt = 0;
const btn = (b, down) => send({ t: "btn", b, down });
const click = (b) => send({ t: "click", b });
// Сдвиги копим и шлём раз в кадр: иначе на каждое движение мыши — сообщение.
let relAcc = { dx: 0, dy: 0 }, relRaf = 0;
function sendRel(dx, dy) {
  relAcc.dx += dx; relAcc.dy += dy;
  if (relRaf) return;
  relRaf = requestAnimationFrame(() => { relRaf = 0; const a = relAcc; relAcc = { dx: 0, dy: 0 }; if (a.dx || a.dy) send({ t: "rel", dx: a.dx, dy: a.dy }); });
}
// Захват указателя на компьютере (режим «тачпад»): курсор не выходит из окна,
// отпустить — Ctrl+G или Cmd+G (Esc тоже отпускает, так устроен браузер).
const locked = () => document.pointerLockElement === touch;
function lockPointer() {
  if (locked() || !touch.requestPointerLock) return;
  try { const r = touch.requestPointerLock({ unadjustedMovement: true }); r?.catch?.(() => touch.requestPointerLock()); } catch { try { touch.requestPointerLock(); } catch { /* не дают */ } }
}
document.addEventListener("pointerlockchange", () => { if (locked()) toast("Указатель захвачен. Отпустить: Ctrl+G или Cmd+G", 3500); });
document.addEventListener("pointerlockerror", () => { if (!lockPointer.warned) { lockPointer.warned = true; toast("Захват мыши не разрешён в этом окне — курсор может выходить за экран", 4000); } });

touch.addEventListener("pointerdown", (e) => {
  if (!ws) return;
  if (e.pointerType === "mouse") {
    const b = e.button === 2 ? "right" : e.button === 1 ? "middle" : "left";
    if (mouseMode === "abs") { const p = at(e); send({ t: "move", x: p.x, y: p.y }); }
    else lockPointer(); // захват, если рамка разрешает; без него мышь всё равно работает, пока курсор в окне
    btn(b, true); return;
  }
  fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (fingers.size === 2 && gesture) { gesture.two = true; clearTimeout(gesture.timer); return; }
  if (fingers.size > 1) return;
  gesture = { start: performance.now(), x: e.clientX, y: e.clientY, moved: 0, drag: false, long: false, two: false };
  if (mouseMode === "abs") {
    const p = at(e); send({ t: "move", x: p.x, y: p.y });
    gesture.timer = setTimeout(() => { if (gesture && gesture.moved < 10) { gesture.long = true; btn("right", true); WA?.HapticFeedback.impactOccurred("light"); } }, 500);
  } else if (performance.now() - lastTapAt < 300) { gesture.drag = true; btn("left", true); }
});
touch.addEventListener("pointermove", (e) => {
  if (!ws) return;
  if (e.pointerType === "mouse") {
    if (mouseMode === "abs") { if (e.buttons) { const p = at(e); send({ t: "move", x: p.x, y: p.y }); } }
    else sendRel(e.movementX / view.k, e.movementY / view.k);
    return;
  }
  const f = fingers.get(e.pointerId);
  if (!f || !gesture) return;
  const dx = e.clientX - f.x, dy = e.clientY - f.y;
  f.x = e.clientX; f.y = e.clientY;
  gesture.moved = Math.max(gesture.moved, Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y));
  if (gesture.two) return;
  if (mouseMode === "abs") {
    const p = at(e); send({ t: "move", x: p.x, y: p.y });
    if (gesture.moved >= 10 && !gesture.drag && !gesture.long) { clearTimeout(gesture.timer); gesture.drag = true; btn("left", true); }
  } else {
    const k = (1 / view.k) * (0.8 + Math.min(1.2, Math.hypot(dx, dy) / 25));
    sendRel(dx * k, dy * k);
  }
});
function endPointer(e) {
  if (!ws) return;
  if (e.pointerType === "mouse") { btn(e.button === 2 ? "right" : e.button === 1 ? "middle" : "left", false); return; }
  fingers.delete(e.pointerId);
  if (!gesture || fingers.size) return;
  const g = gesture; gesture = null; clearTimeout(g.timer);
  if (g.two) { if (g.moved < 15) click("right"); return; }
  if (g.long) { btn("right", false); return; }
  if (g.drag) { btn("left", false); return; }
  if (g.moved < 10 && performance.now() - g.start < 400) { click("left"); lastTapAt = performance.now(); }
}
touch.addEventListener("pointerup", endPointer);
touch.addEventListener("pointercancel", endPointer);
touch.addEventListener("wheel", (e) => { if (!ws) return; e.preventDefault(); const b = e.deltaY > 0 ? "wheel-down" : "wheel-up"; btn(b, true); btn(b, false); }, { passive: false });

$("mouseBtn").addEventListener("click", () => {
  if (!ws) return; // режим уже переключил app.js, нам — только прочитать
  mouseMode = store.get("mouse") || mouseMode;
  $("touch").style.cursor = mouseMode === "rel" ? "none" : "default";
});

// ---------- клавиатура ----------
const mods = new Set();
function tapKey(k) {
  const held = [...mods]; mods.clear();
  for (const b of document.querySelectorAll("[data-mod]")) b.classList.remove("on");
  send({ t: "tap", k: [...held, k].join("-") });
  WA?.HapticFeedback.selectionChanged();
}
for (const b of document.querySelectorAll("[data-k]")) b.addEventListener("click", () => { if (ws) tapKey(b.dataset.k); });
for (const b of document.querySelectorAll("[data-mod]")) b.addEventListener("click", () => { if (!ws) return; const m = b.dataset.mod; if (mods.has(m)) mods.delete(m); else mods.add(m); });
const kbd = $("kbd");
kbd.addEventListener("beforeinput", (e) => {
  if (!ws) return;
  if (e.inputType === "insertText" && e.data) send({ t: "text", s: e.data });
  else if (e.inputType === "deleteContentBackward") send({ t: "tap", k: "bksp" });
  else if (e.inputType === "insertLineBreak") send({ t: "tap", k: "enter" });
});
kbd.addEventListener("keydown", (e) => { if (!ws) return; if (e.key === "Enter") send({ t: "tap", k: "enter" }); else if (e.key === "Escape") send({ t: "tap", k: "esc" }); });
// Физическая клавиатура (компьютер): коды браузера → qcode QEMU.
const CODES = { Enter: "ret", Escape: "esc", Backspace: "backspace", Tab: "tab", Space: "spc", Delete: "delete", Insert: "insert", Home: "home", End: "end", PageUp: "pgup", PageDown: "pgdn",
  ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down", ControlLeft: "ctrl", ControlRight: "ctrl_r", AltLeft: "alt", AltRight: "alt_r", ShiftLeft: "shift", ShiftRight: "shift_r",
  CapsLock: "caps_lock", Minus: "minus", Equal: "equal", BracketLeft: "bracket_left", BracketRight: "bracket_right", Semicolon: "semicolon", Quote: "apostrophe", Backquote: "grave_accent", Backslash: "backslash", Comma: "comma", Period: "dot", Slash: "slash" };
function qcode(e) {
  if (CODES[e.code]) return CODES[e.code];
  let m = /^Key([A-Z])$/.exec(e.code); if (m) return m[1].toLowerCase();
  m = /^Digit(\d)$/.exec(e.code); if (m) return m[1];
  m = /^F(\d{1,2})$/.exec(e.code); if (m) return "f" + m[1];
  return null;
}
addEventListener("keydown", (e) => {
  if (!ws || document.activeElement === kbd) return;
  if ((e.ctrlKey || e.metaKey) && e.code === "KeyG") { e.preventDefault(); if (locked()) document.exitPointerLock(); else lockPointer(); return; }
  const q = qcode(e); if (q) { e.preventDefault(); send({ t: "key", k: q, down: true }); }
});
addEventListener("keyup", (e) => { if (!ws || document.activeElement === kbd) return; const q = qcode(e); if (q) { e.preventDefault(); send({ t: "key", k: q, down: false }); } });

// ---------- выход ----------
// ⏏ в облачном режиме — просто отключиться: машина на сервере живёт ещё 10 минут и усыпляется.
$("powerOff").addEventListener("click", () => {
  if (!ws) return;
  const sheet = $("askSheet"), ok = $("askOk"), no = $("askNo");
  $("askText").textContent = "Выйти? Машина на сервере подождёт вас 10 минут и уснёт — потом продолжите с того же места. «Выключить» — завершить Windows и погасить машину.";
  ok.textContent = "Выйти"; no.textContent = "Выключить";
  sheet.classList.remove("hidden");
  const done = () => { sheet.classList.add("hidden"); ok.onclick = no.onclick = null; ok.textContent = "Да"; no.textContent = "Отмена"; };
  ok.onclick = () => { done(); leave(); };
  no.onclick = () => { done(); send({ t: "tap", k: "ctrl-esc" }); setTimeout(() => send({ t: "tap", k: "u" }), 1500); setTimeout(() => send({ t: "tap", k: "s" }), 3000); setTimeout(() => send({ t: "tap", k: "ret" }), 3500); setTimeout(() => send({ t: "poweroff" }), 40000); toast("Выключаю Windows… секунд через сорок машина погаснет.", 6000); setTimeout(leave, 41000); };
}, true);
addEventListener("pagehide", () => disconnect());

renderCloudCard();
