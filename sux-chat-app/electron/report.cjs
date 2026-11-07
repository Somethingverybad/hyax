// Отчёт об ошибке из оболочки — когда страница не отвечает или чёрная.
//
// Горячая клавиша ⌘/Ctrl+Shift+B живёт в самой странице (src/lib/bugHotkey),
// и при мёртвом окне не срабатывала (07.11: чёрное окно после обновления по
// воздуху, «отправка с клавиатуры не сработала»). Поэтому пункт меню
// «Отправить отчёт об ошибке…» (меню «Помощь» на Mac и меню трея):
//   1) страница жива — открывает своё обычное окно отчёта (window.__hyaxReport);
//   2) не ответила за 1,5 с — оболочка открывает маленькое окно со своей
//      страницей app://hyax/__report.html: тот же origin, значит, доступны
//      токены и сохранённый журнал страницы (localStorage, lib/crashGuard), а
//      от оболочки — её журнал и ошибки страницы, собранные здесь.
// Ошибки страницы (console.error, неудачные загрузки) пишутся и в main.log —
// тогда и откат обновления по воздуху объясняет себя сам.
const fs = require('fs');
const { BrowserWindow, ipcMain } = require('electron');

let logLine = () => {};
let logFile = '';
let getMain = () => null;
let otaInfo = () => ({});
let preload = '';
let lang = () => 'ru';

const pageErrors = [];
let errWindowAt = 0, errInWindow = 0;
/** Ошибка страницы: в кольцевой буфер для отчёта и в main.log (не больше 20 в минуту). */
function pageError(text) {
  const line = `${new Date().toISOString()} ${String(text).slice(0, 400)}`;
  pageErrors.push(line);
  if (pageErrors.length > 60) pageErrors.splice(0, pageErrors.length - 60);
  const now = Date.now();
  if (now - errWindowAt > 60000) { errWindowAt = now; errInWindow = 0; }
  if (++errInWindow <= 20) logLine('page', String(text).slice(0, 400));
}

/** Подписка на окно: ошибки консоли, неудачные загрузки. */
function attach(win) {
  const wc = win.webContents;
  wc.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 3) pageError(`console.error ${message}${sourceId ? ` (${String(sourceId).replace(/^app:\/\/hyax/, '')}:${line})` : ''}`);
  });
  wc.on('did-fail-load', (_e, code, desc, url, isMain) => {
    if (code === -3) return; // ERR_ABORTED — обычная отмена при переходе
    pageError(`did-fail-load ${code} ${desc} ${isMain ? 'main' : 'sub'} ${String(url).slice(0, 120)}`);
  });
  wc.on('preload-error', (_e, p, err) => pageError(`preload-error ${err && err.message}`));
}

function tail(file, lines) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    return text.split('\n').slice(-lines).join('\n');
  } catch { return ''; }
}

/** Сведения для аварийной страницы отчёта. */
function info() {
  const win = getMain();
  const wc = win && !win.isDestroyed() ? win.webContents : null;
  return {
    mainLog: tail(logFile, 300),
    pageErrors: pageErrors.slice(-40),
    ota: otaInfo(),
    window: wc ? { url: wc.getURL(), loading: wc.isLoading(), crashed: wc.isCrashed(), visible: win.isVisible() } : null,
    lang: lang(),
  };
}

const withTimeout = (p, ms, fallback) => Promise.race([p, new Promise((r) => setTimeout(() => r(fallback), ms))]);

let reportWin = null;
/** Пункт меню «Отправить отчёт об ошибке…». */
async function open() {
  const win = getMain();
  if (win && !win.isDestroyed() && !win.webContents.isCrashed()) {
    const res = await withTimeout(
      win.webContents.executeJavaScript('window.__hyaxReport ? (window.__hyaxReport(), "ok") : "none"', true).catch(() => 'err'),
      1500, 'timeout');
    logLine('report: страница', res);
    if (res === 'ok') { win.show(); win.focus(); return; }
  }
  if (reportWin && !reportWin.isDestroyed()) { reportWin.focus(); return; }
  reportWin = new BrowserWindow({
    width: 480, height: 520, resizable: true, minimizable: false, title: 'WYX',
    backgroundColor: '#111111',
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false },
  });
  reportWin.setMenuBarVisibility(false);
  reportWin.on('closed', () => { reportWin = null; });
  reportWin.loadURL(`app://hyax/__report.html?lang=${encodeURIComponent(lang())}`);
}

function reloadMain() {
  const win = getMain();
  if (win && !win.isDestroyed()) { logLine('report: перезагрузка окна из меню'); win.webContents.reload(); win.show(); }
}

function init(o) {
  logLine = o.log; logFile = o.logFile; getMain = o.getMain; otaInfo = o.otaInfo; preload = o.preload; lang = o.lang;
  ipcMain.handle('report-info', () => info());
  ipcMain.on('report-reload-main', () => reloadMain());
  ipcMain.on('report-sent', (_e, id) => logLine('report: отправлен из оболочки', id || ''));
}

/** Страница аварийного отчёта — её отдаёт сама оболочка (не зависит от бандла). */
const REPORT_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>WYX</title>
<style>
  html,body{margin:0;height:100%;background:#111;color:#eee;font:14px/1.45 -apple-system,system-ui,sans-serif}
  .w{padding:18px;display:flex;flex-direction:column;gap:10px;height:100%;box-sizing:border-box}
  h1{font-size:17px;margin:0} p{margin:0;color:#aaa}
  textarea{flex:1;min-height:120px;resize:none;background:#1c1c1c;color:#eee;border:1px solid #333;border-radius:10px;padding:10px;font:inherit}
  .row{display:flex;gap:8px} button{flex:1;height:38px;border:0;border-radius:10px;font:inherit;font-weight:600;cursor:pointer}
  .send{background:#2fbf71;color:#fff} .rel{background:#2a2a2a;color:#eee} button:disabled{opacity:.5}
  #st{min-height:20px;color:#aaa}
</style></head><body><div class="w">
<h1 id="t"></h1><p id="h"></p>
<textarea id="d"></textarea>
<div id="st"></div>
<div class="row"><button class="rel" id="r"></button><button class="send" id="s"></button></div>
</div><script>
const L = { ru: {
  t: "Отправить отчёт об ошибке", h: "Окно WYX не отвечает. Отправим разработчику журнал приложения — можно написать, что случилось (необязательно).",
  p: "Что произошло?", s: "Отправить", r: "Перезагрузить окно", sending: "Отправляю…", ok: "Отправлено, спасибо!", noauth: "Не удалось: нужен вход в WYX.", fail: "Не удалось отправить: ", },
  en: { t: "Send a bug report", h: "The WYX window is not responding. We'll send the app log to the developer — you can describe what happened (optional).",
  p: "What happened?", s: "Send", r: "Reload window", sending: "Sending…", ok: "Sent, thank you!", noauth: "Failed: please sign in to WYX.", fail: "Failed to send: ", },
  ko: { t: "오류 보고 보내기", h: "WYX 창이 응답하지 않습니다. 앱 로그를 개발자에게 보낼게요 — 무슨 일이 있었는지 적어도 돼요(선택).",
  p: "무슨 일이 있었나요?", s: "보내기", r: "창 새로고침", sending: "보내는 중…", ok: "보냈어요, 고마워요!", noauth: "실패: WYX에 로그인해야 해요.", fail: "보내기 실패: ", } };
const lang = new URLSearchParams(location.search).get("lang");
const T = L[lang] || L.ru;
const $ = (id) => document.getElementById(id);
$("t").textContent = T.t; $("h").textContent = T.h; $("d").placeholder = T.p; $("s").textContent = T.s; $("r").textContent = T.r;
const ORIGINS = ["https://cdn.hyax.ru", "https://hyax.ru", "https://huyax.e-tree.su"];
async function post(origin, token, fd) {
  return fetch(origin + "/api/bugreports/", { method: "POST", headers: token ? { Authorization: "Bearer " + token } : {}, body: fd });
}
async function refresh(origin) {
  const rt = localStorage.getItem("refresh_token");
  if (!rt) return null;
  const r = await fetch(origin + "/api/token/refresh/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refresh: rt }) });
  if (!r.ok) return null;
  const j = await r.json();
  if (j.access) localStorage.setItem("access_token", j.access);
  return j.access || null;
}
$("r").onclick = () => window.electronAPI && window.electronAPI.reportReloadMain && window.electronAPI.reportReloadMain();
$("s").onclick = async () => {
  $("s").disabled = true; $("st").textContent = T.sending;
  let info = {};
  try { info = (window.electronAPI && window.electronAPI.reportInfo) ? await window.electronAPI.reportInfo() : {}; } catch (e) {}
  const page = localStorage.getItem("hyax:crashlog") || "";
  const log = (page ? "=== журнал страницы (последний сохранённый) ===\\n" + page + "\\n\\n" : "")
    + "=== ошибки страницы (оболочка) ===\\n" + (info.pageErrors || []).join("\\n")
    + "\\n\\n=== журнал оболочки (main.log) ===\\n" + (info.mainLog || "");
  const note = "Отчёт из меню компьютера: окно WYX не отвечало (электронная оболочка)";
  const text = $("d").value.trim();
  const fd = () => { const f = new FormData(); f.append("description", text ? text + "\\n\\n" + note : note); f.append("log", log);
    f.append("meta", JSON.stringify({ platform: "desktop", via: "shell-menu", ua: navigator.userAgent, ota: info.ota || null, window: info.window || null })); return f; };
  let token = localStorage.getItem("access_token");
  let lastErr = "";
  for (const origin of ORIGINS) {
    try {
      let r = await post(origin, token, fd());
      if (r.status === 401) { token = await refresh(origin); if (!token) { $("st").textContent = T.noauth; $("s").disabled = false; return; } r = await post(origin, token, fd()); }
      if (r.ok) { const j = await r.json().catch(() => ({})); $("st").textContent = T.ok; window.electronAPI && window.electronAPI.reportSent && window.electronAPI.reportSent(j.id); return; }
      lastErr = "HTTP " + r.status;
      if (r.status < 500) break;
    } catch (e) { lastErr = e && e.message || String(e); }
  }
  $("st").textContent = T.fail + lastErr; $("s").disabled = false;
};
</script></body></html>`;

module.exports = { init, attach, open, reloadMain, pageError, REPORT_HTML };
