#!/bin/bash
# Скрипт для определения локального IP-адреса

echo "🔍 Определение локального IP-адреса..."
echo ""

# macOS
if command -v ipconfig &> /dev/null; then
    IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
    if [ -n "$IP" ]; then
        echo "✅ Ваш локальный IP-адрес: $IP"
        echo ""
        echo "📱 На другом устройстве откройте в браузере:"
        echo "   http://$IP"
        echo ""
        echo "💡 Не забудьте добавить этот IP в CORS настройки!"
        exit 0
    fi
fi

# Linux/fallback
IP=$(ifconfig 2>/dev/null | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -1)
if [ -n "$IP" ]; then
    echo "✅ Ваш локальный IP-адрес: $IP"
    echo ""
    echo "📱 На другом устройстве откройте в браузере:"
    echo "   http://$IP"
    echo ""
    echo "💡 Не забудьте добавить этот IP в CORS настройки!"
else
    echo "❌ Не удалось определить IP-адрес"
    echo "Проверьте подключение к сети вручную"
fi
