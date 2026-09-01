const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  closeWindow: () => ipcRenderer.send('close-window'),
  saveFile: (fileUrl, fileName) => ipcRenderer.invoke('save-file', fileUrl, fileName),
  // Обновление изнутри: качаем установщик и запускаем его.
  installUpdate: (url, fileName) => ipcRenderer.invoke('install-update', url, fileName),
  openExternal: (url) => ipcRenderer.send('open-external', url),
});
