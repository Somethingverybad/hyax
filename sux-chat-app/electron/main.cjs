const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const isDev = !app.isPackaged;

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 500,
    height: 700,
    minWidth: 450,
    minHeight: 600,
    maxWidth: 550,
    maxHeight: 800,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    transparent: true,
    roundedCorners: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: isDev, // Отключаем webSecurity только в dev режиме
    },
  });

  // ВСЕГДА используем localhost:5143 для API запросов
  if (isDev) {
    // Development: подключаемся к dev серверу
    mainWindow.loadURL('http://localhost:5143');
  } else {
    // Production: запускаем встроенный сервер на порту 5143
    startProductionServer();
    mainWindow.loadURL('http://localhost:5143');
  }

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.show();
  });

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }
}

// Функция для запуска сервера в production
function startProductionServer() {
  if (isDev) return; // Только для production
  
  const express = require('express');
  const path = require('path');

  const appExpress = express();
  const distPath = path.join(__dirname, '../dist');

  // Обслуживаем статические файлы
  appExpress.use(express.static(distPath));

  // Обработчик для всех GET запросов (SPA routing)
  appExpress.get(/^((?!\.).)*$/, (req, res) => {
    // Пропускаем API запросы
    if (req.path.startsWith('/api/')) {
      return res.status(404).send('Not found');
    }
    
    // Все остальные запросы отправляем на index.html
    res.sendFile(path.join(distPath, 'index.html'), (err) => {
      if (err) {
        console.error('Error sending index.html:', err);
        res.status(500).send('Error loading application');
      }
    });
  });

  // Запускаем сервер на порту 5143
  const server = appExpress.listen(5143, () => {
    console.log('Production server running on http://localhost:5143');
  }).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log('Port 5143 busy, trying 5144...');
      appExpress.listen(5144, () => {
        console.log('Production server running on http://localhost:5144');
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.loadURL('http://localhost:5144');
        }
      });
    } else {
      console.error('Server error:', err);
    }
  });

  // Обработка graceful shutdown
  process.on('SIGTERM', () => {
    server.close(() => {
      console.log('Server stopped');
    });
  });
}

// Обработчики для управления окном
ipcMain.on('minimize-window', () => {
  if (mainWindow) {
    mainWindow.minimize();
  }
});

ipcMain.on('close-window', () => {
  if (mainWindow) {
    mainWindow.close();
  }
});

ipcMain.on('start-drag', () => {
  if (mainWindow) {
    mainWindow.moveTop();
    mainWindow.setIgnoreMouseEvents(false);
  }
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});