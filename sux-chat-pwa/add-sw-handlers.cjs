#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const swPath = path.join(__dirname, 'dist', 'sw.js');

if (!fs.existsSync(swPath)) {
  console.error('Service Worker file not found:', swPath);
  process.exit(1);
}

const handlers = `

// Обработчик кликов по уведомлениям
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked:', event.notification);
  event.notification.close();
  
  const data = event.notification.data || {};
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === self.location.origin && 'focus' in client) {
          if (data.chatId) {
            return client.focus().then(() => {
              client.postMessage({ type: 'NOTIFICATION_CLICK', data: data });
            });
          }
          return client.focus();
        }
      }
      if (clients.openWindow) {
        const url = data.url || '/chat';
        return clients.openWindow(url);
      }
    })
  );
});

// Обработчик закрытия уведомлений
self.addEventListener('notificationclose', (event) => {
  console.log('[SW] Notification closed:', event.notification);
});
`;

fs.appendFileSync(swPath, handlers);
console.log('Notification handlers added to Service Worker');
