# Альтернативы WebSocket для мессенджера

## Проблема с WebSocket
WebSocket соединения не работают из-за проблем с проксированием через Caddy/nginx.

## Доступные альтернативы

### 1. Server-Sent Events (SSE) ⭐ Рекомендуется
**Плюсы:**
- ✅ Работает через обычный HTTP (нет проблем с прокси)
- ✅ Автоматическое переподключение
- ✅ Простая реализация на клиенте
- ✅ Меньше проблем с файрволами и прокси

**Минусы:**
- ❌ Только сервер → клиент (односторонняя связь)
- ❌ Отправка сообщений через обычные HTTP POST запросы

**Использование:**
```typescript
import { SSEService } from './services/sse-service';

const sseService = new SSEService('/api/sse/user/123/', {
  onMessage: (data) => {
    console.log('Новое сообщение:', data);
  },
  onError: (error) => {
    console.error('Ошибка SSE:', error);
  },
});

sseService.connect(token);
```

**Backend реализация (Django):**
```python
from django.http import StreamingHttpResponse
import json

def sse_user_stream(request, user_id):
    def event_stream():
        # Отправляем keep-alive каждые 30 секунд
        yield f"data: {json.dumps({'type': 'ping'})}\n\n"
        
        # Здесь можно использовать Django Channels или Redis pub/sub
        # для получения новых сообщений
        while True:
            # Получаем новые сообщения
            message = get_new_message(user_id)  # Ваша логика
            if message:
                yield f"data: {json.dumps(message)}\n\n"
    
    response = StreamingHttpResponse(event_stream(), content_type='text/event-stream')
    response['Cache-Control'] = 'no-cache'
    response['X-Accel-Buffering'] = 'no'  # Отключаем буферизацию в nginx
    return response
```

### 2. HTTP Long Polling
**Плюсы:**
- ✅ Работает везде
- ✅ Простая реализация
- ✅ Нет проблем с прокси

**Минусы:**
- ❌ Больше нагрузка на сервер
- ❌ Небольшая задержка

**Использование:**
```typescript
import { LongPollingService } from './services/long-polling-service';

const pollingService = new LongPollingService('/api/poll/user/123/', {
  onMessage: (data) => {
    console.log('Новое сообщение:', data);
  },
  pollInterval: 2000, // 2 секунды между запросами
  timeout: 30000, // 30 секунд таймаут
});

pollingService.connect(token);
```

**Backend реализация (Django):**
```python
from django.http import JsonResponse
import time

def poll_user_messages(request, user_id):
    # Ждем до 30 секунд новых сообщений
    timeout = 30
    start_time = time.time()
    
    while time.time() - start_time < timeout:
        messages = get_new_messages(user_id)  # Ваша логика
        if messages:
            return JsonResponse(messages, safe=False)
        time.sleep(0.5)  # Проверяем каждые 0.5 секунды
    
    # Таймаут - возвращаем пустой ответ
    return JsonResponse([], safe=False)
```

### 3. HTTP Short Polling
**Плюсы:**
- ✅ Очень просто реализовать
- ✅ Работает везде

**Минусы:**
- ❌ Высокая нагрузка на сервер
- ❌ Задержки
- ❌ Неэффективно

**Использование:**
```typescript
// Просто периодические запросы
setInterval(async () => {
  const response = await fetch('/api/messages/latest/');
  const messages = await response.json();
  // Обработка сообщений
}, 2000); // Каждые 2 секунды
```

### 4. Socket.IO
**Плюсы:**
- ✅ Автоматический fallback на long polling
- ✅ Автоматическое переподключение
- ✅ Работает везде

**Минусы:**
- ❌ Дополнительная зависимость
- ❌ Больше трафика

**Использование:**
```typescript
import io from 'socket.io-client';

const socket = io('https://sux.cardiokit.beget.tech', {
  auth: { token },
  transports: ['polling', 'websocket'], // Начинает с polling
});

socket.on('new_message', (data) => {
  console.log('Новое сообщение:', data);
});
```

## Рекомендация

**Для вашего случая рекомендую комбинированный подход:**

1. **SSE для получения сообщений** - работает через HTTP, нет проблем с прокси
2. **Обычные HTTP POST запросы для отправки** - уже работают

Это даст вам:
- ✅ Real-time получение сообщений
- ✅ Надежность (работает везде)
- ✅ Простота реализации
- ✅ Меньше проблем с инфраструктурой

## Миграция с WebSocket на SSE

1. Замените `WebSocketService` на `SSEService` в компонентах
2. Добавьте SSE endpoint в Django backend
3. Оставьте HTTP POST для отправки сообщений (уже работает)

Пример замены в `Chat.tsx`:
```typescript
// Было:
const wsService = new WebSocketService(`${WS_URL}/user/${user.id}/`, {...});

// Стало:
const sseService = new SSEService(`/api/sse/user/${user.id}/`, {...});
```
