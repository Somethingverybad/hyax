const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  platform: process.platform,
  // Свои уведомления (Windows/Linux): окно-тост от main; клик → open-chat.
  notify: (payload) => ipcRenderer.invoke('notify', payload),
  onOpenChat: (cb) => { const h = (_e, chatId) => cb(chatId); ipcRenderer.on('open-chat', h); return () => ipcRenderer.removeListener('open-chat', h); },
  closeWindow: () => ipcRenderer.send('close-window'),
  saveFile: (fileUrl, fileName) => ipcRenderer.invoke('save-file', fileUrl, fileName),
  // Обновление изнутри: качаем установщик и запускаем его.
  installUpdate: (url, fileName) => ipcRenderer.invoke('install-update', url, fileName),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  // Обновление внутри приложения (electron-updater): проверить, скачать,
  // перезапуститься с установкой; onUpdate — подписка на состояние.
  checkUpdate: () => ipcRenderer.invoke('update-check'),
  downloadUpdate: () => ipcRenderer.invoke('update-download'),
  applyUpdate: () => ipcRenderer.send('update-apply'),
  onUpdate: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('update-state', handler);
    return () => ipcRenderer.removeListener('update-state', handler);
  },
  appVersion: () => ipcRenderer.invoke('app-version'),
  // Обновление веб-части по воздуху (electron/ota.cjs): «жив» и сведения.
  otaReady: () => ipcRenderer.send('ota-ready'),
  otaInfo: () => ipcRenderer.invoke('ota-info'),
  // Применить скачанный бандл сейчас (перезагрузка окна, без перезапуска).
  otaApply: () => ipcRenderer.invoke('ota-apply'),
  // Как установлено на Linux: appimage | deb | other; иначе native.
  installKind: () => ipcRenderer.invoke('install-kind'),
  // Язык интерфейса (ru | en | ko) — для трея, меню и диалогов main-процесса.
  setLang: (l) => ipcRenderer.send('set-lang', l),
  // Мини-плеер поверх окон, меню Dock и кнопки превью на панели задач
  // (electron/playerWidget.cjs): состояние плеера туда, команды обратно.
  playerState: (s) => ipcRenderer.send('player-state', s),
  onPlayerCmd: (cb) => { const h = (_e, c) => cb(c); ipcRenderer.on('player-cmd', h); return () => ipcRenderer.removeListener('player-cmd', h); },
  setPlayerWidget: (on) => ipcRenderer.send('player-widget', !!on),
  playerWidgetEnabled: () => ipcRenderer.invoke('player-widget-enabled'),
  // ⌘/Ctrl+Shift+Y или пункт трея — перевести текст из буфера обмена.
  onTranslateClipboard: (cb) => { const h = (_e, text) => cb(text); ipcRenderer.on('translate-clipboard', h); return () => ipcRenderer.removeListener('translate-clipboard', h); },
});
