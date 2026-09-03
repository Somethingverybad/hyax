// Десктопная обёртка hyax. Та же веб-сборка (dist/), что и в мобильном
// приложении, в окне Electron. API и WebSocket ходят на боевой сервер по
// абсолютным URL, поэтому никакого локального бэкенда здесь нет.
const { app, BrowserWindow, Menu, clipboard, ipcMain, dialog, protocol, net, session, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { autoUpdater } = require('electron-updater');

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
    let full = path.join(DIST, rel);
    // SPA: любой маршрут без файла на диске — это index.html.
    if (!rel || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
      full = path.join(DIST, 'index.html');
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
    title: 'ХУЯКС',
    ...(process.platform === 'linux' ? { icon: LINUX_ICON } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      // Звук уведомлений/аудио-стикеров играем из JS без клика пользователя.
      autoplayPolicy: 'no-user-gesture-required',
      // Та же история, что и с ключами выше, но для конкретного окна.
      backgroundThrottling: false,
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
        { label: 'Отменить', role: 'undo', enabled: flags.canUndo },
        { label: 'Повторить', role: 'redo', enabled: flags.canRedo },
        { type: 'separator' },
        { label: 'Вырезать', role: 'cut', enabled: flags.canCut },
        { label: 'Копировать', role: 'copy', enabled: flags.canCopy },
        { label: 'Вставить', role: 'paste', enabled: flags.canPaste },
        { type: 'separator' },
        { label: 'Выделить всё', role: 'selectAll' }
      );
    } else if (params.selectionText) {
      items.push({ label: 'Копировать', role: 'copy' });
    }

    if (params.linkURL) {
      if (items.length) items.push({ type: 'separator' });
      items.push({
        label: 'Копировать ссылку',
        click: () => clipboard.writeText(params.linkURL),
      });
    }

    if (params.mediaType === 'image' && params.srcURL) {
      if (items.length) items.push({ type: 'separator' });
      items.push({
        label: 'Копировать картинку',
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
  const allowed = new Set(['media', 'notifications', 'clipboard-read', 'clipboard-sanitized-write']);
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
      title: 'Сохранить файл',
      buttonLabel: 'Сохранить',
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

// Обновление изнутри: скачиваем установщик во временную папку и открываем его
// (mac — монтирует DMG, win — запускает NSIS-инсталлятор, linux — AppImage).
ipcMain.handle('install-update', async (_e, url, fileName) => {
  try {
    const resp = await net.fetch(url);
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
    const tmp = path.join(app.getPath('temp'), fileName || 'hyax-update');
    fs.writeFileSync(tmp, Buffer.from(await resp.arrayBuffer()));
    if (process.platform === 'linux') { try { fs.chmodSync(tmp, 0o755); } catch {} }
    await shell.openPath(tmp);
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
autoUpdater.on('error', (err) => sendUpdate({ state: 'error', message: String((err && err.message) || err) }));

const updaterEnabled = () => app.isPackaged || !!process.env.HYAX_UPDATE_URL;
ipcMain.handle('update-check', async () => {
  if (!updaterEnabled()) return { ok: false, reason: 'dev' };
  try {
    const r = await autoUpdater.checkForUpdates();
    return { ok: true, version: r && r.updateInfo ? r.updateInfo.version : null };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
ipcMain.handle('update-download', async () => {
  try { await autoUpdater.downloadUpdate(); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});
// Перезапуск с установкой: на Windows тихий NSIS, на mac подмена бандла, на
// Linux замена AppImage. Откладываем на тик, чтобы ответ IPC успел уйти.
ipcMain.on('update-apply', () => { setImmediate(() => autoUpdater.quitAndInstall(false, true)); });
// Плюс проверка раз в час: приложение на десктопе живёт неделями.
setInterval(() => { if (updaterEnabled()) autoUpdater.checkForUpdates().catch(() => {}); }, 60 * 60 * 1000);

ipcMain.handle('app-version', () => app.getVersion());
ipcMain.on('minimize-window', () => mainWindow?.minimize());
ipcMain.on('close-window', () => mainWindow?.close());

function focusMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// Второй запуск (двойной клик по ярлыку, автозапуск) поднимает уже открытое
// окно вместо второй копии приложения с тем же localStorage и сокетом.
const gotLock = app.requestSingleInstanceLock();
logLine('singleInstanceLock', gotLock);
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', focusMainWindow);

  app.whenReady().then(() => {
    logLine('ready');
    if (!isDev) serveDist();
    allowMediaPermissions();
    createWindow();

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
