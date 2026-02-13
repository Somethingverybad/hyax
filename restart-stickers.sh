#!/bin/bash

echo "=== Перезапуск PWA с поддержкой стикеров ==="

# Переходим в директорию проекта
cd /home/hyax

echo ""
echo "1. Пересборка PWA приложения..."
cd sux-chat-pwa
npm run build

if [ $? -ne 0 ]; then
    echo "❌ Ошибка при сборке PWA"
    exit 1
fi

echo ""
echo "2. Перезапуск контейнера PWA..."
cd /home/hyax
docker-compose restart pwa

if [ $? -ne 0 ]; then
    echo "❌ Ошибка при перезапуске контейнера PWA"
    exit 1
fi

echo ""
echo "✅ Готово!"
echo ""
echo "Теперь:"
echo "1. Откройте приложение в браузере"
echo "2. Нажмите Ctrl+Shift+R для жесткой перезагрузки"
echo "3. Кнопка стикеров (😊) должна появиться между кнопкой прикрепления (📎) и полем ввода"
echo ""
echo "Если кнопка не появилась, проверьте консоль браузера (F12) на наличие ошибок"
