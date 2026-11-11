#!/bin/sh
# Восстановление базы WYX из копии в хранилище (scripts/db-backup.sh).
#
#   scripts/db-restore.sh                # последняя копия → в базу контейнера sux_chat_db
#   scripts/db-restore.sh <ключ>         # конкретная (ключи: manage.py backup_db --list)
#   scripts/db-restore.sh latest <контейнер postgres>  # в другой контейнер (проверка)
#
# Новый сервер: docker compose up -d db redis api (api — только чтобы было чем
# скачать: у него ключи хранилища), затем этот скрипт, затем остальное.
# pg_restore --clean --if-exists: существующие таблицы заменяются содержимым копии.
set -eu
KEY=${1:-latest}
DB=${2:-sux_chat_db}
T=$(mktemp /tmp/hyax-restore-XXXXXX)
trap 'rm -f "$T"' EXIT
docker exec sux_chat_api python manage.py backup_db --fetch "$KEY" > "$T"
echo "копия: $(wc -c < "$T") байт"
docker exec -i "$DB" sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' < "$T"
echo "восстановлено в $DB"
