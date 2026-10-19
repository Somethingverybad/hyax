// Десктопная обёртка hyax. Та же веб-сборка (dist/), что и в мобильном
// приложении, в окне Electron. API и WebSocket ходят на боевой сервер по
// абсолютным URL, поэтому никакого локального бэкенда здесь нет.
const { app, BrowserWindow, Menu, Tray, nativeImage, screen, clipboard, ipcMain, dialog, protocol, net, session, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { autoUpdater } = require('electron-updater');
const ota = require('./ota.cjs');

// Каталог данных переименование не задело: Electron берёт его из поля name в
// package.json (hyax-messenger), а не из productName, — проверено на сборке
// 272. Закреплять путь не нужно, и попытка закрепить его на «ХУЯКС» уводила
// приложение в пустой профиль: такого каталога никогда не существовало.

// Журнал main-процесса: ~/Library/Logs/hyax-messenger/main.log (mac),
// %APPDATA%/hyax-messenger/logs (win), ~/.config/hyax-messenger/logs (linux).
// Упакованное приложение не пишет в консоль, а падение при старте или ошибку
// автообновления иначе не увидеть.
const logFile = (() => {
  try { app.setAppLogsPath(); return path.join(app.getPath('logs'), 'main.log'); }
  catch { try { return path.join(app.getPath('userData'), 'main.log'); } catch { return path.join(require('os').tmpdir(), 'hyax-main.log'); } }
})();
const logLine = (...parts) => {
  const line = `${new Date().toISOString()} ${parts.map((x) => (x instanceof Error ? (x.stack || x.message) : typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}\n`;
  try { if (logFile) { fs.mkdirSync(path.dirname(logFile), { recursive: true }); fs.appendFileSync(logFile, line); } } catch {}
};
process.on('uncaughtException', (e) => { logLine('uncaughtException', e); });
process.on('unhandledRejection', (e) => { logLine('unhandledRejection', e); });
logLine('start', { version: app.getVersion(), packaged: app.isPackaged, platform: process.platform, argv: process.argv.slice(1) });

// HYAX_FORCE_PROD=1 — прогнать продакшен-режим (app://, dist/) dev-бинарником
// Electron; HYAX_DEBUG_PORT — порт DevTools-протокола для проверки без GUI.
// Упакованное приложение флаги командной строки не принимает.
const isDev = !app.isPackaged && !process.env.HYAX_FORCE_PROD;

// Мессенджер должен пищать о сообщении, даже когда окно не в фокусе. Chromium
// же считает неактивное окно фоновым и душит ему таймеры и рендер — звук
// уведомления копится и высыпается пачкой, когда снова кликнешь в приложение.
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
if (process.env.HYAX_DEBUG_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.HYAX_DEBUG_PORT);
}
const DEV_URL = 'http://localhost:5143';
const DIST = path.join(__dirname, '../dist');
// На macOS и Windows иконку окна даёт сам бандл (.icns/.ico), на Linux её
// нужно указать явно — иначе в панели задач висит стандартный Electron.
const LINUX_ICON = path.join(__dirname, '../assets/icons/512x512.png');

// Собственная схема app:// вместо file:// и локального http-сервера:
// это «безопасный контекст» (getUserMedia для звонков работает), у приложения
// стабильный origin для localStorage, и не нужно занимать порт.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

function serveDist() {
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    let rel = decodeURIComponent(pathname).replace(/^\/+/, '');
    // Веб-часть — встроенная или пришедшая по воздуху (electron/ota.cjs).
    const base = ota.root();
    let full = path.join(base, rel);
    // SPA: любой маршрут без файла на диске — это index.html.
    if (!rel || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
      full = path.join(base, 'index.html');
    }
    return net.fetch(pathToFileURL(full).toString());
  });
}

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 420,
    minHeight: 600,
    show: false,
    backgroundColor: '#0a0a0a',
    title: 'WYX',
    ...(process.platform === 'linux' ? { icon: LINUX_ICON } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      // Звук уведомлений/аудио-стикеров играем из JS без клика пользователя.
      autoplayPolicy: 'no-user-gesture-required',
      // Та же история, что и с ключами выше, но для конкретного окна.
      backgroundThrottling: false,
      // Консоль разработчика — только в dev-запуске; в релизе выключена
      // целиком (ни F12, ни Cmd/Ctrl+Shift+I, ни пункт меню).
      devTools: isDev,
    },
  });

  mainWindow.loadURL(isDev ? DEV_URL : 'app://hyax/');
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });

  // Внешние ссылки — в системный браузер, а не в новое окно приложения.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  attachContextMenu(mainWindow);

  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
}

// Меню приложения. В релизе — без «Инструментов разработчика»: на macOS
// оставляем стандартные роли (без них не работают Cmd+C/V и прочие),
// на Windows/Linux строки меню нет вовсе — у приложения свой интерфейс.
function installAppMenu() {
  if (isDev) return; // стандартное меню Electron со всеми пунктами
  if (process.platform !== 'darwin') { Menu.setApplicationMenu(null); return; }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    { label: tr('Вид'), submenu: [
      { role: 'reload' }, { type: 'separator' },
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' },
      { role: 'togglefullscreen' },
    ] },
    { role: 'windowMenu' },
  ]));
}

// Своего контекстного меню Chromium в Electron не показывает: без этого правая
// кнопка мыши в поле ввода не умеет ни скопировать, ни вставить. На пузырях
// сообщений меню рисует само приложение (там срабатывает preventDefault), так
// что сюда доходит только то, для чего нужно системное меню.
function attachContextMenu(win) {
  win.webContents.on('context-menu', (_event, params) => {
    const flags = params.editFlags;
    const items = [];

    if (params.isEditable) {
      items.push(
        { label: tr('Отменить'), role: 'undo', enabled: flags.canUndo },
        { label: tr('Повторить'), role: 'redo', enabled: flags.canRedo },
        { type: 'separator' },
        { label: tr('Вырезать'), role: 'cut', enabled: flags.canCut },
        { label: tr('Копировать'), role: 'copy', enabled: flags.canCopy },
        { label: tr('Вставить'), role: 'paste', enabled: flags.canPaste },
        { type: 'separator' },
        { label: tr('Выделить всё'), role: 'selectAll' }
      );
    } else if (params.selectionText) {
      items.push({ label: tr('Копировать'), role: 'copy' });
    }

    if (params.linkURL) {
      if (items.length) items.push({ type: 'separator' });
      items.push({
        label: tr('Копировать ссылку'),
        click: () => clipboard.writeText(params.linkURL),
      });
    }

    if (params.mediaType === 'image' && params.srcURL) {
      if (items.length) items.push({ type: 'separator' });
      items.push({
        label: tr('Копировать картинку'),
        click: () => win.webContents.copyImageAt(params.x, params.y),
      });
    }

    if (!items.length) return;
    Menu.buildFromTemplate(items).popup({ window: win });
  });
}

// Микрофон/камера для звонков и уведомления — разрешаем без лишних вопросов
// от Chromium (системный запрос macOS всё равно покажется один раз).
function allowMediaPermissions() {
  const allowed = new Set(['media', 'notifications', 'clipboard-read', 'clipboard-sanitized-write', 'geolocation']);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(allowed.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
}

// Сохранение вложений через системный диалог (preload: electronAPI.saveFile).
ipcMain.handle('save-file', async (_event, fileUrl, fileName) => {
  try {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: fileName,
      title: tr('Сохранить файл'),
      buttonLabel: tr('Сохранить'),
    });
    if (result.canceled || !result.filePath) return { success: false, canceled: true };
    const response = await net.fetch(fileUrl);
    if (!response.ok) return { success: false, error: `HTTP ${response.status}` };
    fs.writeFileSync(result.filePath, Buffer.from(await response.arrayBuffer()));
    return { success: true, path: result.filePath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Установка скачанного .deb: xdg-open на нём обычно ничего не делает (или
// открывает архиватор), а пользователь видел «установщик запущен». Ставим сами
// через pkexec — системный диалог пароля — и перезапускаемся. Код 126/127 —
// отменил или не прошёл авторизацию.
const installDeb = (file) => new Promise((resolve) => {
  const { spawn } = require('child_process');
  const script = 'dpkg -i "$1" || (apt-get -y -f install && dpkg -i "$1")';
  let p;
  try { p = spawn('pkexec', ['/bin/sh', '-c', script, 'sh', file], { stdio: 'ignore' }); }
  catch (e) { return resolve({ ok: false, error: `pkexec: ${e.message}`, file }); }
  p.on('error', (e) => resolve({ ok: false, error: `pkexec: ${e.message}`, file }));
  p.on('exit', (code) => {
    logLine('deb install exit', code);
    if (code === 0) {
      resolve({ ok: true, restart: true });
      setTimeout(() => { app.isQuitting = true; app.relaunch(); app.quit(); }, 500);
    } else {
      resolve({ ok: false, error: code === 126 || code === 127 ? 'cancelled' : `dpkg exit ${code}`, file });
    }
  });
});

// Обновление изнутри (запасной путь, когда electron-updater недоступен):
// скачиваем установщик во временную папку и открываем его (mac — монтирует
// DMG, win — запускает NSIS-инсталлятор, linux — AppImage или .deb через pkexec).
// Бакет недоступен (VPN, DNS, блокировки) — та же ссылка через наш домен:
// nginx /dl/ проксирует storage.yandexcloud.net/hyax-public/installers/.
const BUCKET = 'https://storage.yandexcloud.net/hyax-public/installers/';
const MIRROR = 'https://huyax.e-tree.su/dl/';
const mirrorUrl = (url) => (typeof url === 'string' && url.startsWith(BUCKET) ? MIRROR + url.slice(BUCKET.length) : null);
async function fetchWithMirror(url) {
  const attempt = async (u) => {
    const resp = await net.fetch(u, { signal: AbortSignal.timeout(20 * 60 * 1000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp;
  };
  try { return await attempt(url); }
  catch (e) {
    const m = mirrorUrl(url);
    if (!m) throw e;
    logLine('download via mirror', String(e.message || e));
    return attempt(m);
  }
}

ipcMain.handle('install-update', async (_e, url, fileName) => {
  try {
    const resp = await fetchWithMirror(url);
    const tmp = path.join(app.getPath('temp'), fileName || 'hyax-update');
    fs.writeFileSync(tmp, Buffer.from(await resp.arrayBuffer()));
    if (process.platform === 'linux') {
      try { fs.chmodSync(tmp, 0o755); } catch {}
      if (/\.deb$/i.test(tmp)) return await installDeb(tmp);
    }
    // openPath возвращает пустую строку при успехе и текст ошибки иначе —
    // раньше он игнорировался, и сбой выглядел как «установщик запущен».
    const err = await shell.openPath(tmp);
    if (err) { logLine('openPath failed', err); return { ok: false, error: err, file: tmp }; }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.on('open-external', (_e, url) => { if (/^https?:/.test(url)) shell.openExternal(url); });

// ===== Обновление внутри приложения (electron-updater) =====
// Фид — та же страница загрузок: electron-builder кладёт рядом с установщиками
// latest.yml / latest-mac.yml / latest-linux.yml с версией и sha512. Windows и
// Linux (AppImage) обновляются без подписи; на macOS Squirrel применяет
// обновление только к приложению, подписанному Developer ID — поэтому
// mac-сборка подписывается (build.mac в package.json), а ad-hoc-версии до 1.0.6
// получат ошибку и уйдут по старому пути: скачать DMG и открыть.
//
// HYAX_UPDATE_URL — подменить фид (локальная проверка обновления).
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.logger = { info: (m) => logLine('updater', m), warn: (m) => logLine('updater warn', m), error: (m) => logLine('updater error', m), debug: () => {} };
if (process.env.HYAX_UPDATE_URL) {
  autoUpdater.forceDevUpdateConfig = true;
  autoUpdater.setFeedURL({ provider: 'generic', url: process.env.HYAX_UPDATE_URL });
}
const sendUpdate = (payload) => { try { mainWindow?.webContents.send('update-state', payload); } catch {} };
autoUpdater.on('update-available', (info) => sendUpdate({
  state: 'available', version: info.version,
  notes: typeof info.releaseNotes === 'string' ? info.releaseNotes : '',
}));
autoUpdater.on('update-not-available', () => sendUpdate({ state: 'none' }));
autoUpdater.on('download-progress', (p) => sendUpdate({ state: 'downloading', percent: Math.round(p.percent || 0) }));
autoUpdater.on('update-downloaded', (info) => sendUpdate({ state: 'downloaded', version: info.version }));
autoUpdater.on('error', (err) => {
  // Установка сорвалась — снова «крестик в трей», а не выход.
  app.isQuitting = false;
  sendUpdate({ state: 'error', message: String((err && err.message) || err) });
});

const updaterEnabled = () => app.isPackaged || !!process.env.HYAX_UPDATE_URL;

// Как установлено приложение на Linux. AppImage апдейтер подменяет файл, на
// который указывает $APPIMAGE. Для .deb electron-builder кладёт в пакет
// resources/package-type, и electron-updater (с 6.x) по нему берёт DebUpdater:
// качает .deb из latest-linux.yml и ставит через pkexec dpkg -i. Старые deb без
// этого файла и tar.gz (где угодно в $HOME) апдейтер не осилит — у них
// запасной путь через манифест version.json (см. install-update). До 1.1.12
// апдейтер для deb не включали вовсе — думали, он умеет только AppImage.
const installKind = () => {
  if (process.platform !== 'linux') return 'native';
  if (process.env.APPIMAGE) return 'appimage';
  return /^\/(opt|usr)\//.test(process.execPath) ? 'deb' : 'other';
};
const updaterSupported = () => {
  const k = installKind();
  if (k === 'native' || k === 'appimage') return true;
  if (k === 'deb') { try { return fs.existsSync(path.join(process.resourcesPath, 'package-type')); } catch { return false; } }
  return false;
};
ipcMain.handle('install-kind', () => installKind());

// Фид и загрузка electron-updater: сначала бакет, при ошибке — зеркало на
// нашем домене (и дальше остаёмся на нём до перезапуска).
let feedOnMirror = false;
function switchFeedToMirror() {
  if (feedOnMirror || process.env.HYAX_UPDATE_URL) return false;
  feedOnMirror = true;
  autoUpdater.setFeedURL({ provider: 'generic', url: MIRROR });
  logLine('updater feed → mirror');
  return true;
}
ipcMain.handle('update-check', async () => {
  if (!updaterEnabled()) return { ok: false, reason: 'dev' };
  if (!updaterSupported()) return { ok: false, reason: installKind() };
  try {
    const r = await autoUpdater.checkForUpdates();
    return { ok: true, version: r && r.updateInfo ? r.updateInfo.version : null };
  } catch (e) {
    if (switchFeedToMirror()) {
      try { const r = await autoUpdater.checkForUpdates(); return { ok: true, version: r && r.updateInfo ? r.updateInfo.version : null }; }
      catch (e2) { return { ok: false, error: e2.message }; }
    }
    return { ok: false, error: e.message };
  }
});
ipcMain.handle('update-download', async () => {
  try { await autoUpdater.downloadUpdate(); return { ok: true }; }
  catch (e) {
    if (switchFeedToMirror()) {
      try { await autoUpdater.checkForUpdates(); await autoUpdater.downloadUpdate(); return { ok: true }; }
      catch (e2) { return { ok: false, error: e2.message }; }
    }
    return { ok: false, error: e.message };
  }
});
// Перезапуск с установкой: на Windows тихий NSIS, на mac подмена бандла, на
// Linux замена AppImage. Откладываем на тик, чтобы ответ IPC успел уйти.
// Флаг выхода — ДО quitAndInstall: на macOS Squirrel сначала закрывает окна и
// только потом шлёт before-quit, и «крестик — в трей» перехватывал закрытие:
// окно пряталось, выход отменялся, обновление не ставилось.
ipcMain.on('update-apply', () => {
  app.isQuitting = true;
  setImmediate(() => {
    try { autoUpdater.quitAndInstall(false, true); }
    catch (e) { app.isQuitting = false; logLine('quitAndInstall failed', e && e.message); sendUpdate({ state: 'error', message: String((e && e.message) || e) }); }
  });
});
try { require('electron').autoUpdater.on('before-quit-for-update', () => { app.isQuitting = true; }); } catch {}
// Плюс проверка раз в час: приложение на десктопе живёт неделями.
setInterval(() => { if (updaterEnabled() && updaterSupported()) autoUpdater.checkForUpdates().catch(() => {}); }, 60 * 60 * 1000);

ipcMain.handle('app-version', () => app.getVersion());
// Обновление по воздуху: интерфейс отрисовался — бандл жив; сведения — профилю и плашке.
ipcMain.on('ota-ready', () => { if (!isDev) ota.ready(); });
ipcMain.handle('ota-info', () => (isDev ? null : ota.info()));
ipcMain.handle('ota-apply', () => (isDev ? false : ota.applyNow(mainWindow)));
ipcMain.on('minimize-window', () => mainWindow?.minimize());
ipcMain.on('close-window', () => mainWindow?.close());

function focusMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// ---------------------------------------------------------------------------
// Трей: крестик окна прячет приложение в трей (как Telegram), оно продолжает
// получать сообщения и показывать уведомления. Выход — из меню трея или
// Cmd/Ctrl+Q. Настройка «сворачивать в трей» лежит в userData/settings.json.
// ---------------------------------------------------------------------------
const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');
function readSettings() { try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch { return {}; } }
function writeSettings(patch) { try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ ...readSettings(), ...patch })); } catch (e) { logLine('settings write failed', String(e)); } }
const trayEnabled = () => readSettings().minimizeToTray !== false;

// ---------------------------------------------------------------------------
// Язык оболочки (меню, контекстное меню, трей, диалоги, тосты) — тот же, что у
// интерфейса: веб-часть шлёт его через electronAPI.setLang при старте и при
// каждой смене (src/lib/i18n.ts). Храним в settings.json (поле lang), чтобы
// трей при следующем запуске сразу был на нужном языке; пока веб-часть его не
// прислала ни разу — язык системы. Ключ словаря — русская строка, как в
// src/lib/i18n.ts, но словарь свой: здесь «Отменить»/«Повторить» — это
// Undo/Redo в контекстном меню, а «Выйти» — выход из приложения, не из аккаунта.
// ---------------------------------------------------------------------------
const SHELL_LANGS = ['ru', 'en', 'ko'];
const SHELL_DICT = {
  ru: {},
  en: {
    'Вид': 'View',
    'Отменить': 'Undo',
    'Повторить': 'Redo',
    'Вырезать': 'Cut',
    'Копировать': 'Copy',
    'Вставить': 'Paste',
    'Выделить всё': 'Select all',
    'Копировать ссылку': 'Copy link',
    'Копировать картинку': 'Copy image',
    'Сохранить файл': 'Save file',
    'Сохранить': 'Save',
    'Открыть WYX': 'Open WYX',
    'Сворачивать в трей при закрытии': 'Minimize to tray on close',
    'Выйти': 'Quit',
  },
  ko: {
    'Вид': '보기',
    'Отменить': '실행 취소',
    'Повторить': '다시 실행',
    'Вырезать': '잘라내기',
    'Копировать': '복사',
    'Вставить': '붙여넣기',
    'Выделить всё': '모두 선택',
    'Копировать ссылку': '링크 복사',
    'Копировать картинку': '이미지 복사',
    'Сохранить файл': '파일 저장',
    'Сохранить': '저장',
    'Открыть WYX': 'WYX 열기',
    'Сворачивать в трей при закрытии': '닫을 때 트레이로 최소화',
    'Выйти': '종료',
  },
};
// app.getLocale() работает только после ready; раньше — без кэша и по-русски.
function systemLang() {
  let loc = '';
  try { loc = String(app.getLocale() || '').toLowerCase(); } catch {}
  return loc.startsWith('ko') ? 'ko' : loc.startsWith('en') ? 'en' : 'ru';
}
let shellLang = null;
function getShellLang() {
  if (shellLang) return shellLang;
  const saved = readSettings().lang;
  if (SHELL_LANGS.includes(saved)) return (shellLang = saved);
  if (!app.isReady()) return 'ru';
  return (shellLang = systemLang());
}
/** Перевод строки оболочки. Плейсхолдеры {name} подставляются из vars. */
function tr(s, vars) {
  let out = SHELL_DICT[getShellLang()][s] || s;
  if (vars) for (const k of Object.keys(vars)) out = out.split(`{${k}}`).join(String(vars[k]));
  return out;
}
ipcMain.on('set-lang', (_e, l) => {
  if (!SHELL_LANGS.includes(l)) return;
  const prev = getShellLang();
  if (readSettings().lang !== l) writeSettings({ lang: l });
  shellLang = l;
  if (l === prev) return;
  // Контекстное меню, диалоги и тосты строятся при каждом показе — они сами
  // возьмут новый язык; готовые меню приложения и трея пересобираем.
  installAppMenu();
  if (tray) tray.setContextMenu(buildTrayMenu());
});

let tray = null;
function trayIcon() {
  const p = path.join(__dirname, '../assets/icons', process.platform === 'darwin' ? '32x32.png' : '32x32.png');
  let img = nativeImage.createFromPath(p);
  if (process.platform === 'darwin') img = img.resize({ width: 18, height: 18 });
  return img;
}
function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: tr('Открыть WYX'), click: focusMainWindow },
    { type: 'separator' },
    { label: tr('Сворачивать в трей при закрытии'), type: 'checkbox', checked: trayEnabled(), click: (item) => writeSettings({ minimizeToTray: item.checked }) },
    { type: 'separator' },
    { label: tr('Выйти'), click: () => { app.isQuitting = true; app.quit(); } },
  ]);
}
function createTray() {
  if (tray) return;
  try {
    tray = new Tray(trayIcon());
    tray.setToolTip('WYX');
    tray.setContextMenu(buildTrayMenu());
    tray.on('click', focusMainWindow);
    tray.on('double-click', focusMainWindow);
  } catch (e) { logLine('tray failed', String(e)); }
}

// ---------------------------------------------------------------------------
// Свои уведомления на Windows и Linux (как у Telegram): маленькие окна в
// правом нижнем углу поверх всего, с именем, текстом и аватаром; клик открывает
// чат. На macOS — системный баннер, он там и так хорош (desktopNotify.ts).
// ---------------------------------------------------------------------------
const toasts = [];
const TOAST_W = 340, TOAST_H = 84, TOAST_GAP = 8, TOAST_TTL = 6000;
function layoutToasts() {
  const area = screen.getPrimaryDisplay().workArea;
  toasts.forEach((t, i) => {
    if (t.win.isDestroyed()) return;
    const y = area.y + area.height - (TOAST_H + TOAST_GAP) * (i + 1);
    t.win.setPosition(area.x + area.width - TOAST_W - 12, y, false);
  });
}
function removeToast(t) {
  const i = toasts.indexOf(t);
  if (i >= 0) toasts.splice(i, 1);
  clearTimeout(t.timer);
  if (!t.win.isDestroyed()) t.win.close();
  layoutToasts();
}
function toastHtml({ title, body, avatar }) {
  const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const initial = esc((title || '?').trim().slice(0, 1).toUpperCase());
  const av = avatar ? `<img src="${esc(avatar)}" onerror="this.replaceWith(document.createTextNode('${initial}'))">` : initial;
  // lang — чтобы Chromium брал для иероглифов шрифт нужного языка (ko — корейский).
  return `<!doctype html><html lang="${getShellLang()}"><head><meta charset="utf-8"><style>
    html,body{margin:0;background:transparent;overflow:hidden;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-user-select:none;user-select:none}
    .card{box-sizing:border-box;width:${TOAST_W}px;height:${TOAST_H}px;padding:12px 14px;display:flex;gap:12px;align-items:center;border-radius:14px;
      background:#1C2420;color:#fff;border:1px solid #37453D;box-shadow:0 8px 24px rgba(0,0,0,.35);cursor:pointer;animation:in .18s ease-out}
    @keyframes in{from{transform:translateY(12px);opacity:0}to{transform:none;opacity:1}}
    .av{width:44px;height:44px;border-radius:50%;flex:none;background:#345c54;color:#C7F964;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:18px;overflow:hidden}
    .av img{width:100%;height:100%;object-fit:cover}
    .t{min-width:0;flex:1}.n{font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .b{font-size:13px;color:#BDBDBD;margin-top:2px;line-height:1.3;max-height:34px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
    .x{position:absolute;right:10px;top:8px;color:#9AA59E;font-size:14px;line-height:1;padding:2px 4px}.x:hover{color:#fff}
    .w{position:absolute;right:12px;bottom:8px;font-size:10px;color:#9AA59E;letter-spacing:.08em}
  </style></head><body>
  <div class="card" onclick="window.__open()"><div class="av">${av}</div><div class="t"><div class="n">${esc(title)}</div><div class="b">${esc(body)}</div></div>
  <span class="x" onclick="event.stopPropagation();window.__close()">✕</span><span class="w">WYX</span></div>
  <script>const {ipcRenderer}=require('electron');window.__open=()=>ipcRenderer.send('toast-open');window.__close=()=>ipcRenderer.send('toast-close');</script>
  </body></html>`;
}
function showToast(payload) {
  if (!['win32', 'linux'].includes(process.platform)) return false;
  // Один чат — одно окно: новое сообщение заменяет прежнее, а не плодит стопку.
  const same = toasts.find((t) => t.chatId && t.chatId === payload.chatId);
  if (same) removeToast(same);
  while (toasts.length >= 3) removeToast(toasts[0]);
  const win = new BrowserWindow({
    width: TOAST_W, height: TOAST_H, frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true,
    resizable: false, movable: false, focusable: false, show: false, hasShadow: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false },
  });
  const t = { win, chatId: payload.chatId || '', timer: null };
  toasts.push(t);
  win.webContents.on('ipc-message', (_e, channel) => {
    if (channel === 'toast-open') { focusMainWindow(); if (t.chatId) mainWindow?.webContents.send('open-chat', t.chatId); removeToast(t); }
    else if (channel === 'toast-close') removeToast(t);
  });
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(toastHtml(payload)));
  win.once('ready-to-show', () => { layoutToasts(); win.showInactive(); });
  t.timer = setTimeout(() => removeToast(t), TOAST_TTL);
  return true;
}
ipcMain.handle('notify', (_e, payload) => showToast(payload || {}));
ipcMain.handle('toast-supported', () => ['win32', 'linux'].includes(process.platform));

// Второй запуск (двойной клик по ярлыку, автозапуск) поднимает уже открытое
// окно вместо второй копии приложения с тем же localStorage и сокетом.
const gotLock = app.requestSingleInstanceLock();
logLine('singleInstanceLock', gotLock);
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', focusMainWindow);

  app.whenReady().then(() => {
    installAppMenu();
    logLine('ready');
    // Обновление веб-части по воздуху: до первой страницы — решить, из какого
    // бандла её отдавать; проверка нового — в фоне.
    if (!isDev) { ota.init({ dist: DIST, log: logLine }); serveDist(); }
    allowMediaPermissions();
    createWindow();
    if (!isDev) { ota.watch(mainWindow); ota.startChecks(); }
    createTray();
    // Крестик — в трей, а не выход (если не выключено в меню трея).
    mainWindow?.on('close', (e) => {
      if (app.isQuitting || !trayEnabled()) return;
      e.preventDefault();
      mainWindow.hide();
    });
    app.on('before-quit', () => { app.isQuitting = true; });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else focusMainWindow();
    });
  });
}

app.on('will-quit', () => logLine('will-quit'));
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
