#!/bin/bash

echo "=== Применение голосовых сообщений ==="

# Переходим в директорию проекта
cd /home/hyax

echo ""
echo "1. Создание директории для голосовых файлов..."
mkdir -p backend/media/voice
chmod 777 backend/media/voice

echo ""
echo "2. Применение миграций..."
docker-compose exec api python manage.py migrate

echo ""
echo "3. Перезапуск контейнеров..."
docker-compose restart api pwa

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
