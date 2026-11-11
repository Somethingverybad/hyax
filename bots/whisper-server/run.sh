#!/bin/sh
# Нидерландский сервер (crystal): собрать образ и пересоздать контейнер.
#   /opt/wyx-whisper/app    — эта папка (rsync из репозитория)
#   /opt/wyx-whisper/.env   — WHISPER_TOKEN=… (600; тот же ключ — в .env API)
#   /opt/wyx-whisper/models — веса модели (качаются при первом старте)
# Сертификат — общий с ретранслятором перевода (/opt/wyx-relay/certs, копия
# с владельцем-пользователем контейнера: ключ там только для root), API
# сверяет его по backend/certs/wyx-relay.pem.
set -e
# ALLOW_FROM: 194.164.245.144 — основной сервер по IPv4 (из России с 11.11 недоступно);
# 172.17.0.1 — так выглядят ВСЕ соединения по IPv6: их пропускает docker-proxy моста
# без IPv6, адрес клиента теряется. Тогда остаются ключ (WHISPER_TOKEN) и TLS.
cd /opt/wyx-whisper
[ -s .env ] || { echo "нет /opt/wyx-whisper/.env (WHISPER_TOKEN)"; exit 1; }
mkdir -p models certs && chown 10045 models
install -m 644 /opt/wyx-relay/certs/cert.pem certs/cert.pem
install -o 10045 -m 600 /opt/wyx-relay/certs/key.pem certs/key.pem
docker build -q -t wyx-whisper app >/dev/null
docker rm -f wyx-whisper >/dev/null 2>&1 || true
docker run -d --name wyx-whisper --restart unless-stopped \
  -p 8745:8745 --env-file /opt/wyx-whisper/.env \
  -e ALLOW_FROM=194.164.245.144/32,172.17.0.1/32 -e WHISPER_MODEL=small -e WHISPER_THREADS=3 \
  -e TLS_CERT=/certs/cert.pem -e TLS_KEY=/certs/key.pem \
  -v /opt/wyx-whisper/certs:/certs:ro -v /opt/wyx-whisper/models:/models \
  --memory 1500m --cpus 3 --log-opt max-size=5m --log-opt max-file=2 \
  wyx-whisper >/dev/null
sleep 3
docker ps --filter name=wyx-whisper --format '{{.Names}} {{.Status}}'
