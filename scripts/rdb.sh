#!/bin/zsh
# Удалённый Samsung (Samsung Remote Test Lab) через adb.
#
# RDB (Remote Debug Bridge) — утилита Samsung, бинарник ~93 МБ, в git не лежит:
# скачать с https://developer.samsung.com/remote-test-lab (RDB for macOS) и
# положить в ~/tools/rdb/rdb. adb — из Android SDK (~/Library/Android/sdk).
#
# Порядок:
#   1. В браузере: Remote Test Lab → выбрать устройство → Start → в окне
#      устройства меню «Test → Remote Debug Bridge» (нужен запущенный RDB).
#   2. Здесь: scripts/rdb.sh  — запускает RDB, ждёт устройство, подключает adb.
#   3. Дальше обычный adb: adb install, adb shell input keyevent 26 (экран), …
#      Устройство с RTL без аккаунта Google: пуши (FCM) не приходят.
# scripts/rdb.sh stop — остановить RDB.
set -e
RDB=${RDB:-$HOME/tools/rdb/rdb}
ADB_DIR=${ADB_DIR:-$HOME/Library/Android/sdk/platform-tools}
export PATH="$ADB_DIR:$PATH"
[[ -x $RDB ]] || { echo "Нет $RDB — скачай RDB с developer.samsung.com/remote-test-lab и положи туда"; exit 1; }
command -v adb >/dev/null || { echo "Нет adb в $ADB_DIR"; exit 1; }

if [[ $1 == stop ]]; then pkill -f "$RDB" && echo "RDB остановлен" || echo "RDB не запущен"; exit 0; fi

if pgrep -f "$RDB" >/dev/null; then echo "RDB уже запущен"; else
  nohup "$RDB" > /tmp/rdb.log 2>&1 &
  sleep 2; pgrep -f "$RDB" >/dev/null || { echo "RDB не запустился:"; tail -5 /tmp/rdb.log; exit 1; }
  echo "RDB запущен (лог /tmp/rdb.log)"
fi
echo "Теперь в окне устройства Remote Test Lab: Test → Remote Debug Bridge. Жду устройство…"
port=""
for i in {1..120}; do
  port=$(lsof -nP -a -p "$(pgrep -f "$RDB" | head -1)" -iTCP -sTCP:LISTEN 2>/dev/null | awk 'NR>1{split($9,a,":"); if (a[2]!="8888") print a[2]}' | head -1)
  [[ -n $port ]] && break; sleep 2
done
[[ -n $port ]] || { echo "Устройство не подключилось за 4 минуты"; exit 1; }
adb connect "localhost:$port" | tail -1
adb -s "localhost:$port" wait-for-device
echo "Устройство: localhost:$port — $(adb -s localhost:$port shell getprop ro.product.model | tr -d '\r'), Android $(adb -s localhost:$port shell getprop ro.build.version.release | tr -d '\r')"
echo "export ANDROID_SERIAL=localhost:$port   # чтобы adb шёл на него по умолчанию"
