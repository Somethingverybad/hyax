# Фоновые уведомления в PWA

## Что было реализовано

Для решения проблемы с уведомлениями, когда приложение свернуто или переключено, были добавлены следующие механизмы:

### 1. Service Worker с Background Sync
- **Файл**: `public/sw-custom.js`
- **Функции**:
  - Обработка кликов по уведомлениям (`notificationclick`)
  - Background Sync для периодической проверки сообщений
  - Periodic Background Sync (если поддерживается браузером)
  - Обработка сообщений от клиента для показа уведомлений

### 2. Обновления в Chat.tsx
- Уведомления показываются через Service Worker, когда приложение в фоне
- Регистрация Background Sync для периодической проверки
- Обработчик `visibilitychange` для переподключения WebSocket при возвращении в приложение

### 3. Обновления в main.tsx
- Обработка сообщений от Service Worker
- Регистрация Service Worker при загрузке приложения

## Как это работает

1. **Когда приложение активно**:
   - WebSocket соединение работает нормально
   - Уведомления показываются через обычный Notification API

2. **Когда приложение свернуто**:
   - WebSocket может быть приостановлен браузером
   - Service Worker продолжает работать в фоне
   - Background Sync периодически проверяет новые сообщения через API
   - Уведомления показываются через Service Worker

3. **Когда приложение возвращается в фокус**:
   - WebSocket переподключается автоматически
   - Данные обновляются

## Требования

- PWA должно быть установлено (Add to Home Screen)
- Разрешение на уведомления должно быть предоставлено
- Браузер должен поддерживать Service Worker и Background Sync

## Ограничения

- Background Sync работает только в установленных PWA
- Periodic Background Sync требует Chrome 80+ или Edge 80+
- На iOS требуется iOS 16.4+ для фоновых уведомлений в PWA

## Отладка

1. Проверьте Service Worker:
   - Chrome DevTools → Application → Service Workers
   - Убедитесь, что Service Worker активен

2. Проверьте Background Sync:
   - Chrome DevTools → Application → Background Sync
   - Должна быть зарегистрирована задача `check-messages`

3. Проверьте уведомления:
   - Chrome DevTools → Application → Notifications
   - Убедитесь, что разрешение предоставлено
