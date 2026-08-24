#!/bin/bash

# docker-compose v1 в новых системах не ставится — там плагин «docker compose».
# Берём то, что есть, иначе скрипт молча ничего не перезапустит.
if docker compose version &> /dev/null; then
    COMPOSE="docker compose"
elif command -v docker-compose &> /dev/null; then
    COMPOSE="docker-compose"
else
    echo "❌ Не найден ни «docker compose», ни «docker-compose»"
    exit 1
fi

echo "=== Применение голосовых сообщений ==="

# Переходим в директорию проекта
cd /home/hyax

echo ""
echo "1. Создание директории для голосовых файлов..."
mkdir -p backend/media/voice
chmod 777 backend/media/voice

echo ""
echo "2. Применение миграций..."
$COMPOSE exec api python manage.py migrate

echo ""
echo "3. Перезапуск контейнеров..."
$COMPOSE restart api pwa

echo ""
echo "✅ Готово!"
echo ""
echo "Теперь:"
echo "1. Откройте приложение в браузере"
echo "2. Нажмите Ctrl+Shift+R для жесткой перезагрузки"
echo "3. Кнопка микрофона (🎤) должна появиться рядом со стикерами"
echo ""
echo "Для записи голосового сообщения:"
echo "1. Нажмите на кнопку микрофона"
echo "2. Разрешите доступ к микрофону в браузере"
echo "3. Запись начнется автоматически"
echo ""
echo "Подробности: /home/hyax/VOICE_MESSAGES_README.md"
