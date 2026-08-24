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

echo "🔧 Настройка функционала профилей..."

# Применяем миграции
echo "📦 Применение миграций для профилей..."
$COMPOSE exec api python3 manage.py migrate

# Создаем директорию для аватаров
echo "📁 Создание директории для аватаров..."
$COMPOSE exec api mkdir -p /app/media/avatars

# Перезапускаем контейнеры
echo "🔄 Перезапуск контейнеров..."
$COMPOSE restart api pwa

echo "✅ Настройка профилей завершена!"
echo ""
echo "📝 Теперь:"
echo "1. Откройте приложение в браузере"
echo "2. Нажмите Ctrl+Shift+R для полной перезагрузки"
echo "3. Войдите в систему"
echo "4. Проверьте консоль браузера на логи '👤 Профиль получен:'"
echo "5. Если увидите '❌ Профиль не содержит ID!', сообщите мне"
