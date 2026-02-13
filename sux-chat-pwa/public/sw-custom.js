// Custom Service Worker для обработки уведомлений и фоновых задач

// Обработка клика по уведомлению
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked:', event.notification.data);
  
  event.notification.close();
  
  const data = event.notification.data;
  const targetUrl = data?.url || '/chat';
  
  // Открываем/фокусируем окно приложения
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Ищем любое открытое окно приложения
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        const clientUrl = new URL(client.url);
        const isAppUrl = clientUrl.origin === self.location.origin;
        
        if (isAppUrl && 'focus' in client) {
          // Отправляем сообщение для открытия нужного чата
          if (data && data.chatId) {
            client.postMessage({
              type: 'NOTIFICATION_CLICK',
              data: { chatId: data.chatId }
            });
          }
          
          // Если нужно, навигируем на страницу чата
          if (client.url !== targetUrl && 'navigate' in client) {
            client.navigate(targetUrl);
          }
          
          return client.focus();
        }
      }
      
      // Если окно не открыто, открываем новое с правильным URL
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

// Background Sync для отправки сообщений в фоне
self.addEventListener('sync', (event) => {
  console.log('[SW] Background sync:', event.tag);
  
  if (event.tag === 'sync-messages') {
    event.waitUntil(
      // Здесь можно добавить логику синхронизации сообщений
      // Например, отправка отложенных сообщений
      Promise.resolve()
    );
  }
});

// Periodic Background Sync для периодической проверки новых сообщений
// Это позволяет проверять сообщения даже когда браузер закрыт
self.addEventListener('periodicsync', (event) => {
  console.log('[SW] Periodic sync:', event.tag);
  
  if (event.tag === 'check-messages') {
    event.waitUntil(
      // Запрашиваем токен у клиента, так как Service Worker не имеет доступа к localStorage
      clients.matchAll().then(clients => {
        if (clients.length > 0) {
          // Отправляем запрос клиенту для получения токена и проверки сообщений
          clients.forEach(client => {
            client.postMessage({
              type: 'CHECK_MESSAGES_REQUEST',
              timestamp: Date.now()
            });
          });
          console.log('[SW] Отправлен запрос на проверку сообщений клиентам:', clients.length);
        } else {
          console.log('[SW] Нет активных клиентов для проверки сообщений');
        }
      })
      .catch(error => {
        console.error('[SW] Periodic sync error:', error);
      })
    );
  }
});

// Background Sync для синхронизации при возврате онлайн
self.addEventListener('sync', (event) => {
  console.log('[SW] Background sync:', event.tag);
  
  if (event.tag === 'sync-messages') {
    event.waitUntil(
      clients.matchAll().then(clients => {
        if (clients.length > 0) {
          clients.forEach(client => {
            client.postMessage({
              type: 'SYNC_MESSAGES_REQUEST',
              timestamp: Date.now()
            });
          });
          console.log('[SW] Отправлен запрос на синхронизацию сообщений');
        }
      })
      .catch(error => {
        console.error('[SW] Background sync error:', error);
      })
    );
  }
});

// Обработка сообщений от клиента
self.addEventListener('message', (event) => {
  console.log('[SW] Message from client:', event.data);
  
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    const { title, options } = event.data;
    event.waitUntil(
      self.registration.showNotification(title, options)
    );
  }
});

// Установка Service Worker
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker');
  self.skipWaiting();
});

// Активация Service Worker
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker');
  event.waitUntil(
    clients.claim().then(() => {
      console.log('[SW] Service worker activated and claimed clients');
    })
  );
});
