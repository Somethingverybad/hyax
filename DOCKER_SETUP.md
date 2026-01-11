# Настройка Docker для PWA

## Быстрый старт

1. Убедитесь, что Docker и Docker Compose установлены
2. Создайте сеть Docker (если еще не создана):
   ```bash
   docker network create sux_chat_network
   ```
3. Запустите все сервисы:
   ```bash
   docker-compose up --build
   ```

## Структура сервисов

- **nginx** - Основной веб-сервер, проксирует запросы к API и PWA
- **api** - Django бэкенд (порт 8000)
- **pwa** - PWA фронтенд (порт 80 внутри контейнера)
- **db** - PostgreSQL база данных
- **certbot** - SSL сертификаты

## Настройка переменных окружения

Создайте файл `.env` в корне проекта:

```env
# Database
POSTGRES_DB=sux_chat
POSTGRES_USER=sux_user
POSTGRES_PASSWORD=your_secure_password

# Django
DJANGO_SECRET_KEY=your-secret-key-here
DEBUG=False
```

## Порты

- `80` - HTTP (основной доступ, работает без SSL)
- `443` - HTTPS (раскомментируйте в docker-compose.yml после настройки SSL)

## Подключение с других устройств в локальной сети

Для подключения с других устройств (телефон, планшет, другой компьютер) в той же Wi-Fi сети:

1. **Узнайте IP-адрес вашего компьютера:**
   ```bash
   ./get_local_ip.sh
   ```
   Или вручную:
   ```bash
   # macOS
   ipconfig getifaddr en0
   
   # Linux
   hostname -I | awk '{print $1}'
   ```

2. **Откройте на другом устройстве:**
   ```
   http://ВАШ_IP_АДРЕС
   ```
   Например: `http://192.168.1.100`

3. **Настройте CORS** (см. `LOCAL_NETWORK_SETUP.md` для подробностей)

**Подробная инструкция:** См. `LOCAL_NETWORK_SETUP.md`

## Настройка SSL (опционально)

Для продакшена рекомендуется использовать HTTPS. Для этого:

1. Убедитесь, что домен указывает на ваш сервер
2. Раскомментируйте блок HTTPS в `nginx/conf.d/sux.conf`
3. Раскомментируйте порт 443 в `docker-compose.yml`
4. Получите сертификаты:
   ```bash
   docker-compose run --rm certbot certonly --webroot --webroot-path=/var/www/certbot -d sux.cardiokit.beget.tech
   ```
5. Перезапустите nginx:
   ```bash
   docker-compose restart nginx
   ```

**Для локальной разработки SSL не требуется** - все работает через HTTP на порту 80.

## Локальная разработка PWA

Если вы хотите разрабатывать PWA локально (без Docker):

1. Создайте `.env` файл в `sux-chat-pwa/`:
   ```
   VITE_API_URL=http://localhost:8000/api
   ```

2. Убедитесь, что бэкенд запущен на порту 8000

3. Запустите PWA:
   ```bash
   cd sux-chat-pwa
   npm install
   npm run dev
   ```

## Пересборка после изменений

После изменения кода PWA или бэкенда:

```bash
docker-compose up --build
```

Или только PWA:

```bash
docker-compose build pwa
docker-compose up -d pwa
```

## Проверка работы

1. Откройте `https://sux.cardiokit.beget.tech` (или `http://localhost` если настроено)
2. PWA должно загрузиться
3. API запросы должны работать через `/api/`

## Решение проблем

### "Failed to fetch" при регистрации

1. Проверьте, что бэкенд запущен: `docker-compose ps`
2. Проверьте логи: `docker-compose logs api`
3. Убедитесь, что CORS настроен правильно в `backend/sux_chat/settings.py`
4. Проверьте, что API_URL в PWA указывает на правильный адрес

### PWA не загружается

1. Проверьте логи nginx: `docker-compose logs nginx`
2. Проверьте логи PWA: `docker-compose logs pwa`
3. Убедитесь, что PWA контейнер собран: `docker-compose build pwa`

### Проблемы с SSL

Если SSL сертификаты не работают:

```bash
docker-compose run --rm certbot certonly --webroot --webroot-path=/var/www/certbot -d sux.cardiokit.beget.tech
```
