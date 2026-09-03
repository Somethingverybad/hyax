const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
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
});
