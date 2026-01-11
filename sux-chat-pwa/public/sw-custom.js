// Кастомные обработчики для Service Worker
// Этот файл будет добавлен в Service Worker через vite-plugin-pwa

// Обработчик кликов по уведомлениям
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked:', event.notification);
  event.notification.close();
  
  const data = event.notification.data || {};
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Ищем открытое окно приложения
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          if (data.chatId) {
            return client.focus().then(() => {
              client.postMessage({ 
                type: 'NOTIFICATION_CLICK', 
                data: data 
              });
            });
          }
          return client.focus();
        }
      }
      // Если окно не найдено, открываем новое
      if (clients.openWindow) {
        const url = data.chatId ? `/chat?chatId=${data.chatId}` : '/chat';
        return clients.openWindow(url);
      }
    })
  );
});

// Обработчик закрытия уведомлений
self.addEventListener('notificationclose', (event) => {
  console.log('[SW] Notification closed:', event.notification);
});

// Background Sync для периодической проверки новых сообщений
self.addEventListener('sync', (event) => {
  console.log('[SW] Background sync event:', event.tag);
  
  if (event.tag === 'check-messages') {
    event.waitUntil(checkNewMessages());
  }
});

// Периодическая проверка новых сообщений
async function checkNewMessages() {
  try {
    console.log('[SW] Проверяем новые сообщения в фоне...');
    
    // Получаем токен из IndexedDB или отправляем сообщение клиенту
    const clients = await self.clients.matchAll({ type: 'window' });
    
    if (clients.length > 0) {
      // Отправляем сообщение клиенту для проверки новых сообщений
      clients.forEach(client => {
        client.postMessage({ 
          type: 'CHECK_MESSAGES',
          timestamp: Date.now()
        });
      });
    }
  } catch (error) {
    console.error('[SW] Ошибка при проверке сообщений:', error);
  }
}

// Обработчик сообщений от клиента
self.addEventListener('message', (event) => {
  console.log('[SW] Получено сообщение от клиента:', event.data);
  
  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    const { title, options } = event.data;
    event.waitUntil(
      self.registration.showNotification(title, options)
    );
  }
  
  if (event.data && event.data.type === 'REGISTER_BACKGROUND_SYNC') {
    // Регистрируем периодическую синхронизацию
    if ('sync' in self.registration) {
      self.registration.sync.register('check-messages').then(() => {
        console.log('[SW] Background sync зарегистрирован');
      }).catch(err => {
        console.error('[SW] Ошибка регистрации background sync:', err);
      });
    }
  }
});

// Periodic Background Sync (если поддерживается)
if ('periodicSync' in self.registration) {
  self.addEventListener('periodicsync', (event) => {
    if (event.tag === 'check-messages-periodic') {
      event.waitUntil(checkNewMessages());
    }
  });
}
