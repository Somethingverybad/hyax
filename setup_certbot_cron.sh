#!/bin/bash
# ===============================
# setup_certbot_cron.sh
# Добавляет задачу в crontab для обновления Let's Encrypt сертификатов через Docker Compose
# ===============================

# Путь к docker-compose.yml
PROJECT_PATH="/home/sux-chat"
LOG_FILE="$PROJECT_PATH/certbot_renew.log"

# У cron нищий PATH, поэтому команду compose раскрываем в абсолютный путь прямо
# сейчас. docker-compose v1 в новых системах не ставится — там плагин
# «docker compose», проверяем оба варианта.
if docker compose version &> /dev/null; then
    COMPOSE="$(command -v docker) compose"
elif command -v docker-compose &> /dev/null; then
    COMPOSE="$(command -v docker-compose)"
else
    echo "❌ Не найден ни «docker compose», ни «docker-compose»"
    exit 1
fi

# Команда, которая будет выполняться cron'ом
CRON_CMD="cd $PROJECT_PATH && $COMPOSE run --rm certbot certbot renew --webroot --webroot-path=/var/www/certbot --quiet && $COMPOSE exec nginx nginx -s reload >> $LOG_FILE 2>&1"

# Строка для crontab (запуск каждые 12 часов)
CRON_JOB="0 */12 * * * $CRON_CMD"

# Проверяем, есть ли уже такая строка в crontab
(crontab -l 2>/dev/null | grep -F "$CRON_CMD") >/dev/null

if [ $? -eq 0 ]; then
    echo "✅ Задача для обновления сертификатов уже есть в crontab."
else
    # Добавляем новую задачу
    (crontab -l 2>/dev/null; echo "$CRON_JOB") | crontab -
    echo "✅ Добавлена новая cron-задача для обновления сертификатов:"
    echo "$CRON_JOB"
fi

# Показываем текущие задачи
echo
echo "📋 Текущие задачи в crontab:"
crontab -l
