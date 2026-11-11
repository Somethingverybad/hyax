# Сеть WYX — свой VPN-клиент для друзей

Зачем: с 11.11.2026 ТСПУ режет IPv4 нидерландского сервера, публичные клиенты банят
по названию, адреса — по списку. Свой клиент получает **подписанный список узлов** с
hyax.ru (его не заблокируют), сам выбирает живой узел и переключается, когда узел
умер; сервер видит здоровье узлов из отчётов клиентов и собственного пробника.

Серверная часть — `backend/chat/vpn.py` (узлы, доступы, подпись Ed25519, отчёты),
команды `vpn_probe` (пробник из Москвы), `vpn_seed`, `vpn_xui_sync` (панель 3x-ui),
`vpn_pubkey` (публичный ключ для клиента). Сами серверы xray — на crystal
(`/home/vpn/README.md` там), в Россию они смотрят через мост nemilf.hyax.ru.

## iOS (`ios/`)

Приложение `WYXNet` (SwiftUI) + расширение `WYXNetTunnel` (Packet Tunnel):
весь трафик → utun → hev-socks5-tunnel → локальный socks Xray → VLESS Reality/XHTTP.

- Вход — аккаунтом WYX (`POST /api/token/`), токены в связке ключей.
- `GET /api/vpn/profile/` → строка `payload` проверяется подписью (`App/Signature.swift`,
  ключ `Pinned.publicKey`; `nil` — отладка, принимается ключ сервера), сохраняется в
  App Group `group.com.hyax.wyxnet`; расширение читает её при старте и переключении.
- Живость — через сам туннель (`Tunnel/Health.swift`: SOCKS5 → HTTP 204): после старта
  раз в 3 с, потом раз в 20 с; 3 провала подряд — следующий узел. Ротация в простое —
  по настройке. События (узел, задержка, ошибка) → `events.jsonl` → `POST /api/vpn/report/`.
- Журнал для пользователя — `tunnel.log` + `xray.log` в App Group, экран «Журнал».

### Сборка

```sh
brew install xcodegen
cd wyxnet/ios
Vendor/fetch.sh                 # LibXray.xcframework и HevSocks5Tunnel.xcframework (~300 МБ)
xcodegen generate               # WYXNet.xcodeproj из project.yml (в git не кладём)
xcodebuild -project WYXNet.xcodeproj -scheme WYXNet -configuration Debug \
  -destination 'generic/platform=iOS' -derivedDataPath /tmp/wyx-dd \
  -allowProvisioningUpdates CURRENT_PROJECT_VERSION=$(git rev-list --count HEAD) build
xcrun devicectl device install app --device <id> /tmp/wyx-dd/Build/Products/Debug-iphoneos/WYXNet.app
```

Ядро и tun2socks линкуются как статические библиотеки из `Vendor/*.xcframework`
(оба несут `module.modulemap`, как xcframework Xcode их сталкивает). Xcode на /Volumes/Ext.
Команда BTQ69VVHX6, бандлы `com.hyax.wyxnet` и `com.hyax.wyxnet.tunnel`, возможности
Network Extensions + App Groups — автоподпись заводит сама.

### Перед TestFlight

1. `manage.py vpn_pubkey` на сервере → `Pinned.publicKey` в `App/Signature.swift`.
2. Значок — `scripts/gen-icon.swift` (временный).
3. Описание для Apple — без чужих брендов (см. память проекта).
