#!/bin/bash
# Скрипт для определения локального IP-адреса

echo "🔍 Определение локального IP-адреса..."
echo ""

IP=""

# macOS
if command -v ipconfig &> /dev/null; then
    IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
fi

# Linux: адрес интерфейса, через который уходит трафик наружу. ifconfig
# (net-tools) в современных дистрибутивах не стоит из коробки, поэтому сначала
# спрашиваем iproute2 и только потом откатываемся на старые команды.
if [ -z "$IP" ] && command -v ip &> /dev/null; then
    IP=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") print $(i + 1)}' | head -1)
fi

if [ -z "$IP" ] && command -v hostname &> /dev/null; then
    IP=$(hostname -I 2>/dev/null | awk '{print $1}')
fi

if [ -z "$IP" ] && command -v ifconfig &> /dev/null; then
    IP=$(ifconfig 2>/dev/null | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -1)
fi

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
