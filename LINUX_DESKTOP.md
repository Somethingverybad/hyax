# Десктоп под Linux

Та же сборка Electron, что на macOS и Windows (`sux-chat-app/electron/main.cjs`),
просто упакованная в линуксовые форматы. Никакого локального бэкенда — приложение
ходит на боевой сервер по абсолютным URL.

## Сборка

```bash
cd sux-chat-app
npm install
npm run dist:linux          # AppImage + deb + tar.gz разом
```

Отдельные форматы, если нужен только один:

```bash
npm run dist:linux:appimage
npm run dist:linux:deb
```

Готовые файлы кладутся в `sux-chat-app/release/`:

| Файл | Что это |
| --- | --- |
| `hyax-<версия>-x86_64.AppImage` | портативный запуск одним файлом |
| `hyax-<версия>-amd64.deb` | пакет для Debian/Ubuntu, ставится в систему |
| `hyax-<версия>-x64.tar.gz` | распакуй и запусти, ничего ставить не нужно |

Собирать надо на Linux: electron-builder кладёт в пакет линуксовый бинарник
Electron и дёргает `fpm`, кросс-сборка с macOS/Windows без Docker не поедет.

## Дев-режим

```bash
cd sux-chat-app
npm run dev
```

Поднимает Vite на 5143 и окно Electron поверх него: правки в `src/` долетают
в открытое окно без перезапуска. Бэкенд при этом боевой (`https://huyax.e-tree.su/api`),
локально ничего поднимать не надо.

Правки в `electron/main.cjs` горячей заменой не подхватываются — это главный
процесс, его надо перезапустить (Ctrl+C и заново `npm run dev`).

Запускает окно `electron/dev.cjs`, а не `electron` напрямую, потому что
окружение приходится чинить: расширения VS Code выставляют
`ELECTRON_RUN_AS_NODE=1`, и из терминала редактора Electron стартовал как
обычный Node. Там же на Linux добавляется `--no-sandbox` — в деве окно грузит
localhost со своим же кодом, и возиться с профилем AppArmor незачем. Пакетов
для раздачи это не касается, они собираются с включённой песочницей.

## Установка

**deb** — обычный путь для Ubuntu/Debian:

```bash
sudo apt install ./release/hyax-1.0.0-amd64.deb
```

Приложение уезжает в `/opt/ХУЯКС`, в `/usr/bin/hyax` появляется ссылка, в меню —
пункт «ХУЯКС». postinst сам ставит профиль AppArmor (нужен Ubuntu 24.04+) и
права на `chrome-sandbox`, так что песочница Chromium остаётся включённой.

**tar.gz** — когда ставить в систему не хочется:

```bash
tar -xzf release/hyax-1.0.0-x64.tar.gz
./hyax-1.0.0-x64/hyax
```

**AppImage** — один файл, но на Ubuntu 24.04+ требует одну настройку:

```bash
chmod +x release/hyax-1.0.0-x86_64.AppImage
./release/hyax-1.0.0-x86_64.AppImage
```

Скорее всего оно упадёт вот так:

```
FATAL:setuid_sandbox_host.cc(158)] The SUID sandbox helper binary was found,
but is not configured correctly. ... /tmp/.mount_hyax-XXXX/chrome-sandbox
is owned by root and has mode 4755.
```

chmod'ом это не лечится: каталог `/tmp/.mount_*` — read-only squashfs, файл там
root'у принадлежать не может, и к следующему запуску каталог всё равно другой.

Причина глубже. С Ubuntu 24.04 ядру запрещены непривилегированные user
namespaces для всех, у кого нет профиля AppArmor (`kernel.apparmor_restrict_unprivileged_userns=1`).
Песочница Chromium сначала пробует namespace, не может — и откатывается на
setuid-хелпер, которого в AppImage быть не может. Отсюда и падение.
deb-пакет от этого не страдает: его postinst кладёт профиль в `/etc/apparmor.d/`.

Портативным сборкам такой профиль надо положить руками, один раз:

```bash
sudo ./sux-chat-app/linux/allow-sandbox.sh                        # для AppImage
sudo ./sux-chat-app/linux/allow-sandbox.sh путь/к/распакованной   # для tar.gz
```

Профиль ничего не ограничивает — он нужен ровно затем, чтобы у приложения было
имя вместо метки «unconfined», и этому имени был разрешён userns. Точно так же
в системе лежат профили Discord, Brave и 1Password.

Если ставить профиль не хочется — можно выключить песочницу совсем, но это
заметно хуже с точки зрения безопасности:

```bash
./release/hyax-1.0.0-x86_64.AppImage --no-sandbox
```

Отдельная беда AppImage: ему нужен FUSE 2. Если видишь «Cannot mount AppImage,
please check your FUSE setup» — запускай с `--appimage-extract-and-run` либо
бери deb или tar.gz.

## Что сделано именно под Linux

- Иконки: `sux-chat-app/assets/icons/` (16…512 px, из `design/icons/icon-dark.png`).
  На Linux иконку окна бандл не отдаёт, поэтому она ещё и указана явно в
  `BrowserWindow` — иначе в панели задач висел бы дефолтный Electron.
- Ярлык `.desktop`: категории `Network;InstantMessaging;Chat`, `StartupWMClass=hyax-messenger`
  (именно такой WM_CLASS выставляет Electron), чтобы окно склеивалось с иконкой в доке.
- Зависимости deb перечислены вручную: у electron-builder по умолчанию `gconf2` и
  `libappindicator1`, которых в современных Ubuntu уже нет, и пакет бы не поставился.
- Один экземпляр приложения: второй запуск поднимает уже открытое окно, а не
  вторую копию с тем же localStorage и сокетом.
- Уведомления: в баннер передаётся иконка (`public/notification-icon.png`) — libnotify
  сам иконку приложения не подставляет, без неё баннер был бы пустой.
- Отключён троттлинг фонового окна (`backgroundThrottling: false` плюс три ключа
  Chromium). Мессенджер должен пищать о сообщении, когда окно не в фокусе, а
  Chromium душит неактивному окну таймеры и рендер: звук не играл вовсе и
  высыпался пачкой, когда снова кликнешь в приложение. Замер со свёрнутым окном:
  до фикса звук на 4-й секунде не проигрывался, после — уходит в звуковую карту
  вовремя.
- `linux/allow-sandbox.sh` — профиль AppArmor для портативных сборок (см. выше).

## Мелочи, о которые легко споткнуться

- Настройки и сессия лежат в `~/.config/hyax-messenger` (имя из `package.json`,
  а не из `productName`) — при переустановке deb они не теряются.
- Из терминала VS Code приложение молча падает: расширения выставляют
  `ELECTRON_RUN_AS_NODE=1`, и бинарник стартует как обычный Node. Запускать так:
  `env -u ELECTRON_RUN_AS_NODE ./hyax`.
- Микрофон и камера для звонков разрешаются в главном процессе, системного
  запроса на Linux нет — но PipeWire/PulseAudio должен быть живой.
- `HYAX_DEBUG_PORT=9333 ./hyax` открывает DevTools-протокол на порту — удобно
  проверять сборку без GUI: `curl -s http://127.0.0.1:9333/json/list`.
