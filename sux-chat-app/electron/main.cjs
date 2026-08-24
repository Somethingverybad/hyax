// Десктопная обёртка hyax. Та же веб-сборка (dist/), что и в мобильном
// приложении, в окне Electron. API и WebSocket ходят на боевой сервер по
// абсолютным URL, поэтому никакого локального бэкенда здесь нет.
const { app, BrowserWindow, ipcMain, dialog, protocol, net, session, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

// HYAX_FORCE_PROD=1 — прогнать продакшен-режим (app://, dist/) dev-бинарником
// Electron; HYAX_DEBUG_PORT — порт DevTools-протокола для проверки без GUI.
// Упакованное приложение флаги командной строки не принимает.
const isDev = !app.isPackaged && !process.env.HYAX_FORCE_PROD;
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

  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
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
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', focusMainWindow);

  app.whenReady().then(() => {
    if (!isDev) serveDist();
    allowMediaPermissions();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else focusMainWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
