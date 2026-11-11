#!/bin/sh
# Готовые сборки ядра для iOS (в git не кладём, ~300 МБ):
#   LibXray          — Xray-core как xcframework (cgo-вариант), github.com/XTLS/libXray
#   HevSocks5Tunnel  — tun → socks5 (hev-socks5-tunnel), сборка из Tun2SocksKit
# Версии и контрольные суммы закреплены: обновлять осознанно, проверив на телефоне.
set -e
cd "$(dirname "$0")"

fetch() { # имя url sha256 путь_внутри_архива
  name=$1 url=$2 sha=$3 inner=$4
  if [ -d "$name.xcframework" ] && [ "$(cat "$name.xcframework/.src" 2>/dev/null)" = "$url" ]; then
    echo "$name уже на месте"; return
  fi
  curl -L -o "$name.zip" "$url"
  echo "$sha  $name.zip" | shasum -a 256 -c -
  rm -rf "$name.xcframework" tmp && mkdir tmp && unzip -q "$name.zip" -d tmp
  mv "tmp/$inner" "$name.xcframework" && rm -rf tmp "$name.zip"
  echo "$url" > "$name.xcframework/.src"
  echo "$name готов"
}

fetch LibXray https://github.com/XTLS/libXray/releases/download/v26.11.9/libxray-apple-cgo.zip \
  7c58346709f1856782a48d8f9926fb815c8ad1bbaf9e5d9dec4ee0cd1f41ed6f libxray-apple-cgo/LibXray.xcframework
fetch HevSocks5Tunnel https://github.com/EbrahimTahernejad/Tun2SocksKit/releases/download/5.16.0/HevSocks5Tunnel.xcframework.zip \
  44d3ad45296b24b7aaed3a2cc9cbbea1fc4a5ff180edcc378f5daa78c356233c HevSocks5Tunnel.xcframework
