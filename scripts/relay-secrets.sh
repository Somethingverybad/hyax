#!/bin/zsh
# Секреты ретранслятора перевода (запускать с мака, один раз или при смене ключа).
# 1) Новый токен ретранслятора.
# 2) Ключ OpenRouter — с сервера WYX сразу на нидерландский сервер (на экран не выводится),
#    там же токен; контейнер wyx-relay пересоздаётся.
# 3) На сервере WYX: копия .env, ключ OpenRouter убирается, добавляются адрес
#    ретранслятора, токен и путь к его сертификату; права .env — только владельцу.
# После этого контейнер api надо пересоздать (docker compose up -d api + nginx -s reload).
set -e
TOKEN=$(openssl rand -hex 32)
ENV=/home/home-restored/home/hyax/.env

ssh diwatch "grep '^OPEN_ROUTER_API_KEY=' $ENV | head -1 | cut -d= -f2- | tr -d '\r\n'" \
  | ssh -i ~/.ssh/id_ed25519 root@crystal "umask 077; k=\$(cat); test -n \"\$k\" || { echo 'ключ OpenRouter не найден в .env WYX'; exit 1; }; printf 'RELAY_TOKEN=%s\nOPENROUTER_KEY=%s\n' $TOKEN \"\$k\" > /opt/wyx-relay/.env; /opt/wyx-relay/run.sh"

ssh diwatch "cp $ENV $ENV.bak-relay && chmod 600 $ENV.bak-relay && sed -i '/^OPEN_ROUTER_API_KEY=/d;/^OPENROUTER_BASE_URL=/d;/^OPENROUTER_RELAY_/d' $ENV && printf 'OPENROUTER_BASE_URL=https://148.253.213.224:8743/api/v1\nOPENROUTER_RELAY_TOKEN=%s\nOPENROUTER_RELAY_CA=/app/certs/wyx-relay.pem\n' $TOKEN >> $ENV && chmod 600 $ENV && echo 'WYX: настройки ретранслятора записаны'"
