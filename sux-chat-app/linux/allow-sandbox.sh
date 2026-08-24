#!/bin/bash
# Разрешает песочнице Chromium запускаться у портативных сборок (AppImage,
# tar.gz).
#
# Ubuntu 24.04 и новее запрещают непривилегированные user namespaces всем, у
# кого нет профиля AppArmor (kernel.apparmor_restrict_unprivileged_userns=1).
# Chromium тогда откатывается на setuid-хелпер chrome-sandbox, а тот внутри
# AppImage лежит в read-only squashfs и root'ом принадлежать не может — отсюда
# «The SUID sandbox helper binary was found, but is not configured correctly».
#
# deb-пакет ставит такой профиль сам (postinst), портативным сборкам его надо
# положить руками — один раз:
#
#   sudo ./linux/allow-sandbox.sh                    # только AppImage
#   sudo ./linux/allow-sandbox.sh /путь/к/распакованной/папке
#
# Профиль ничего не запрещает: он существует ровно затем, чтобы у приложения
# был не «unconfined», а имя, которому разрешён userns. Ровно так же устроены
# системные профили Discord, Brave и 1Password в /etc/apparmor.d/.
set -e

PROFILE_NAME="hyax-portable"
PROFILE_PATH="/etc/apparmor.d/$PROFILE_NAME"

# Каталог монтирования AppImage каждый раз новый: /tmp/.mount_hyax-1XXXXXX/
APPIMAGE_PATH='/tmp/.mount_hyax*/hyax'
LOCAL_BIN=""

if [ -n "$1" ]; then
    DIR=$(realpath "$1")
    [ -d "$DIR" ] || { echo "❌ Нет такой папки: $1"; exit 1; }
    [ -x "$DIR/hyax" ] || { echo "❌ В $DIR нет исполняемого hyax"; exit 1; }
    LOCAL_BIN="$DIR/hyax"
fi

if [ "$(id -u)" -ne 0 ]; then
    echo "❌ Нужен root: sudo $0 $*"
    exit 1
fi

if ! apparmor_status --enabled > /dev/null 2>&1; then
    echo "ℹ️  AppArmor выключен — профиль не нужен, приложение и так запустится."
    exit 0
fi

# Одна привязка на профиль: перечислять несколько путей через {a,b} парсер
# AppArmor в строке profile не умеет — на распакованную папку заводим второй.
cat > "$PROFILE_PATH" <<PROFILE
# Профиль ничего не ограничивает и нужен только чтобы дать приложению имя
# вместо метки "unconfined" — иначе ему не разрешён userns.
abi <abi/4.0>,
include <tunables/global>

profile $PROFILE_NAME $APPIMAGE_PATH flags=(unconfined) {
  userns,
  @{exec_path} mr,

  # Site-specific additions and overrides. See local/README for details.
  include if exists <local/$PROFILE_NAME>
}
PROFILE

if [ -n "$LOCAL_BIN" ]; then
    cat >> "$PROFILE_PATH" <<PROFILE

profile $PROFILE_NAME-local $LOCAL_BIN flags=(unconfined) {
  userns,
  @{exec_path} mr,

  include if exists <local/$PROFILE_NAME-local>
}
PROFILE
fi

if ! apparmor_parser --skip-kernel-load --debug "$PROFILE_PATH" > /dev/null 2>&1; then
    rm -f "$PROFILE_PATH"
    echo "❌ Эта версия AppArmor профиль не понимает — попробуй deb-пакет."
    exit 1
fi

apparmor_parser --replace --write-cache --skip-read-cache "$PROFILE_PATH"

echo "✅ Профиль установлен: $PROFILE_PATH"
echo "   AppImage: $APPIMAGE_PATH"
[ -n "$LOCAL_BIN" ] && echo "   Папка:    $LOCAL_BIN"
echo ""
echo "Запускай приложение как обычно — песочница Chromium остаётся включённой."
