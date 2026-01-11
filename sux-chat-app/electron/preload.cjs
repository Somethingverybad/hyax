const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  closeWindow: () => ipcRenderer.send('close-window'),
  startDrag: () => ipcRenderer.send('start-drag'),
  saveFile: (fileUrl, fileName) => ipcRenderer.invoke('save-file', fileUrl, fileName),
});