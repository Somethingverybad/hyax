# 🔍 Отладка бэкенда для profiles/undefined

## ✅ Что добавлено на бэкенде

### 1. Логирование в ProfileViewSet.retrieve()
Теперь каждый запрос к `/api/profiles/{id}/` логируется:
```python
🔍 [ProfileViewSet.retrieve] Запрос профиля: pk=..., user=..., authenticated=...
✅ [ProfileViewSet.retrieve] Профиль найден: id=..., username=...
❌ [ProfileViewSet.retrieve] Ошибка: ...
```

### 2. Обработка "undefined"
Если приходит запрос к `/api/profiles/undefined/`, вместо 404 будет:
- **400 Bad Request** с подробным сообщением
- Подсказка использовать `/api/profiles/current/` или `/api/profiles/me/`

### 3. Логирование в get_current_user_profile()
Эндпоинт `/api/profiles/current/` теперь логирует:
```python
👤 [get_current_user_profile] Запрос от пользователя: ...
✅ [get_current_user_profile] Отправка профиля: id=..., username=...
❌ [get_current_user_profile] Профиль не найден для пользователя: ...
```

### 4. Логирование в ProfileViewSet.me()
Эндпоинт `/api/profiles/me/` (альтернативный) тоже логирует все операции.

## 🚀 Как проверить

### Шаг 1: Перезапустите PWA (если еще не сделали)
```bash
cd /home/hyax
docker-compose restart pwa
```

### Шаг 2: Откройте логи бэкенда в реальном времени
```bash
docker-compose logs -f api
```

### Шаг 3: Откройте приложение и войдите

В логах API вы должны увидеть:

#### ✅ Правильная последовательность:
```
👤 [get_current_user_profile] Запрос от пользователя: loh
✅ [get_current_user_profile] Отправка профиля: id=abc-123, username=loh
```

#### ❌ Если есть проблема с undefined:
```
🔍 [ProfileViewSet.retrieve] Запрос профиля: pk=undefined, user=loh, authenticated=True
❌ [ProfileViewSet.retrieve] Получен некорректный ID: 'undefined'
```

Это покажет **откуда** идет запрос с undefined!

## 🔍 Диагностика

### Сценарий 1: Запросы к undefined до входа в систему
```
🔍 [ProfileViewSet.retrieve] pk=undefined, user=AnonymousUser, authenticated=False
```
**Причина**: Компонент пытается загрузить профиль до аутентификации.
**Решение**: Проверить порядок загрузки компонентов во фронтенде.

### Сценарий 2: Запросы к undefined после входа
```
👤 [get_current_user_profile] Отправка профиля: id=abc-123, username=loh
🔍 [ProfileViewSet.retrieve] pk=undefined, user=loh, authenticated=True
```
**Причина**: `/api/profiles/current/` работает, но что-то на фронтенде все равно отправляет undefined.
**Решение**: Проверить stack trace в консоли браузера - откуда идет запрос.

### Сценарий 3: /api/profiles/current/ не возвращает id
```
👤 [get_current_user_profile] Запрос от пользователя: loh
❌ [get_current_user_profile] Профиль не найден для пользователя: loh
```
**Причина**: У Django User нет связанного Profile.
**Решение**: Проверить, создается ли Profile при регистрации пользователя.

## 📊 Следующие шаги

1. **Запустите логи**: `docker-compose logs -f api`
2. **Откройте приложение** с Ctrl+Shift+R
3. **Войдите в систему**
4. **Наблюдайте логи API** - скопируйте все логи с момента входа
5. **Скопируйте логи браузера** (консоль F12)
6. **Отправьте оба лога** для полного анализа

## 🎯 Что мы узнаем

Благодаря логированию на бэкенде мы точно увидим:
- ✅ Возвращает ли `/api/profiles/current/` поле `id`
- ✅ Приходят ли запросы к `undefined` после успешной аутентификации
- ✅ Какой пользователь делает запрос (authenticated vs AnonymousUser)
- ✅ Точное место в коде, где происходит ошибка

Это позволит **точно** определить источник проблемы! 🎯
