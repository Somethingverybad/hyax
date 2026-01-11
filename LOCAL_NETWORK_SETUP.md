# Подключение с других устройств в локальной сети

## Быстрый старт

1. **Узнайте IP-адрес вашего компьютера:**
   ```bash
   # macOS/Linux
   ifconfig | grep "inet " | grep -v 127.0.0.1
   
   # Или проще
   ipconfig getifaddr en0  # macOS для Wi-Fi
   ```

2. **Убедитесь, что Docker контейнеры запущены:**
   ```bash
   docker-compose up -d
   ```

3. **Откройте приложение на другом устройстве:**
   - Откройте браузер
   - Введите: `http://ВАШ_IP_АДРЕС`
   - Например: `http://192.168.1.100`

## Настройка CORS для локальной сети

Для работы с других устройств нужно добавить IP-адреса в настройки CORS:

### 1. Узнайте IP-адрес вашего компьютера

```bash
# macOS
ifconfig en0 | grep "inet " | awk '{print $2}'

# Linux
ip addr show | grep "inet " | grep -v 127.0.0.1
```

Обычно это что-то вроде: `192.168.1.xxx` или `192.168.0.xxx`

### 2. Обновите настройки Django

Откройте `backend/sux_chat/settings.py` и добавьте ваш IP в `CORS_ALLOWED_ORIGINS`:

```python
CORS_ALLOWED_ORIGINS = [
    "https://sux.cardiokit.beget.tech",
    "http://sux.cardiokit.beget.tech",
    "http://localhost:5143",
    "http://localhost:5173",
    "http://localhost:5174",
    "http://95.214.63.151:8080",
    f"http://ВАШ_IP_АДРЕС",  # Добавьте ваш IP
    f"http://ВАШ_IP_АДРЕС:80",  # С портом
]
```

Или проще - для разработки можно временно разрешить все:

```python
# ВРЕМЕННО для локальной разработки
CORS_ALLOW_ALL_ORIGINS = True  # Измените на True
CORS_ALLOW_CREDENTIALS = True
```

### 3. Обновите ALLOWED_HOSTS

Также добавьте IP в `ALLOWED_HOSTS`:

```python
ALLOWED_HOSTS = [
    "sux.cardiokit.beget.tech", 
    "localhost", 
    "127.0.0.1", 
    "95.214.63.151",
    "ВАШ_IP_АДРЕС",  # Добавьте ваш IP
]
```

Или для разработки:

```python
ALLOWED_HOSTS = ["*"]  # ВРЕМЕННО для локальной разработки
```

### 4. Перезапустите контейнеры

```bash
docker-compose restart api
```

## Настройка Firewall (если нужно)

### macOS

1. Откройте "Системные настройки" → "Защита и безопасность" → "Файрвол"
2. Нажмите "Параметры файрвола"
3. Убедитесь, что порт 80 разрешен, или временно отключите файрвол

Или через терминал:

```bash
# Разрешить входящие подключения на порт 80
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add /System/Library/PrivateFrameworks/Apple80211.framework/Resources/airport
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --unblockapp /System/Library/PrivateFrameworks/Apple80211.framework/Resources/airport
```

Или проще - разрешить Docker:

```bash
# Разрешить Docker через файрвол
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add /usr/local/bin/docker
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --unblockapp /usr/local/bin/docker
```

### Linux

```bash
# Ubuntu/Debian
sudo ufw allow 80/tcp
sudo ufw reload
```

## Проверка подключения

1. **На компьютере, где запущен Docker:**
   ```bash
   # Проверьте, что порт 80 прослушивается
   lsof -i :80
   # или
   netstat -an | grep 80
   ```

2. **На другом устройстве:**
   - Убедитесь, что оба устройства в одной Wi-Fi сети
   - Откройте браузер
   - Введите: `http://IP_АДРЕС_ХОСТА`
   - Например: `http://192.168.1.100`

## Автоматическое определение IP

Создайте простой скрипт для определения IP:

```bash
#!/bin/bash
# get_ip.sh
IP=$(ifconfig | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -1)
echo "Ваш IP-адрес: $IP"
echo "Откройте в браузере: http://$IP"
```

Или для macOS:

```bash
IP=$(ipconfig getifaddr en0)
echo "Ваш IP-адрес: $IP"
echo "Откройте в браузере: http://$IP"
```

## Устранение проблем

### "Connection refused" или таймаут

1. Проверьте, что Docker контейнеры запущены:
   ```bash
   docker-compose ps
   ```

2. Проверьте, что порт 80 проброшен:
   ```bash
   docker-compose port nginx 80
   ```

3. Проверьте логи nginx:
   ```bash
   docker-compose logs nginx
   ```

### CORS ошибки

1. Убедитесь, что IP добавлен в `CORS_ALLOWED_ORIGINS`
2. Перезапустите API контейнер: `docker-compose restart api`
3. Проверьте логи: `docker-compose logs api`

### Страница не загружается

1. Проверьте, что оба устройства в одной сети
2. Проверьте файрвол на хост-машине
3. Попробуйте ping: `ping IP_АДРЕС_ХОСТА` с другого устройства

## Безопасность

⚠️ **Важно для продакшена:**

- Не используйте `CORS_ALLOW_ALL_ORIGINS = True` в продакшене
- Не используйте `ALLOWED_HOSTS = ["*"]` в продакшене
- Всегда указывайте конкретные IP-адреса или домены
- Используйте HTTPS в продакшене

Для локальной разработки это допустимо, но перед деплоем обязательно замените на конкретные значения.
