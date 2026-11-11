#!/bin/sh
# Копия базы WYX в закрытое хранилище — раз в час из cron пользователя diwatch-deploy:
#   17 * * * * /home/home-restored/home/hyax/scripts/db-backup.sh >> /home/home-restored/home/hyax/backups-db.log 2>&1
# Дамп сначала целиком во временный файл: если pg_dump упал на середине, в
# хранилище ничего не уходит (оборванный дамп хуже, чем никакого). Хранение и
# чистка старых — chat/management/commands/backup_db.py (7 дней).
set -eu
T=$(mktemp /tmp/hyax-db-XXXXXX)
trap 'rm -f "$T"' EXIT
docker exec sux_chat_db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -Z 6' > "$T"
docker exec -i sux_chat_api python manage.py backup_db < "$T"
