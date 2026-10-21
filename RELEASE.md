# Выкладка WYX — правила и порядок

Обновлено 2026-10-21. Короткая версия: **интерфейс — по воздуху, нативное —
сборкой.** Всё, что ниже, — как решать, что именно изменилось, и что при этом
запускать.

## 1. Что едет по воздуху, а что требует сборки

Приложение на телефонах и компьютерах — это нативная оболочка (Capacitor /
Electron) и веб-бандл внутри (React, CSS, JS, `index.html`, картинки из
`public/`). Бандл подменяется по воздуху (`lib/ota.ts`, Capgo-плагин без
сервиса Capgo); оболочку можно поменять только новой сборкой.

| Что изменилось | Как выкладывать |
|---|---|
| `sux-chat-app/src/**` — экраны, логика, CSS, переводы, `lib/*.ts` | **OTA** (+ сайт) |
| `sux-chat-app/public/**`, `index.html` (заставка, lottie) | **OTA** — применяется на холодном старте |
| `backend/**` | сервер: pull, миграции, restart |
| `nginx/apk-page/*.html`, `version.json` | сервер (копия в `backend/media/apk/`) |
| `sux-chat-app/android/**` — Java-плагины, `AndroidManifest.xml`, разрешения, службы, ресурсы `res/` | **сборка APK + AAB** |
| `sux-chat-app/ios/**` — Swift-плагины, `Info.plist`, entitlements, расширения, Podfile, pbxproj | **сборка iOS** (TestFlight) |
| `sux-chat-app/electron/*.cjs` — main, preload, виджет, OTA-загрузчик | **сборка десктопа** (Mac, Windows, Linux) |
| `capacitor.config.ts`, новый Capacitor-плагин в `package.json` | **сборка всех мобильных** |
| `package.json` зависимости только для веба | OTA |

Правило отличия: если в diff есть файлы вне `src/`, `public/`, `index.html`
и `backend/` — это сборка. Веб-код, который начинает *зависеть* от нового
нативного кода, должен его обнаруживать (`Capacitor.isPluginAvailable`,
`window.electronAPI?.x`) и жить без него, пока старые сборки в ходу. Если
без нативного кода бандл сломается — поднять `sux-chat-app/ota-min-native.json`,
и старые сборки его просто не получат.

Отдельно: **Google Play** и **App Store** принимают бандлы по воздуху (правила
обоих магазинов делают исключение для JavaScript в WebView), запрещено только
предлагать APK в обход Play — у Play-сборки этого нет (`PLAY_BUILD`).

## 2. Перед любой выкладкой

```
git status --short          # чужие незакоммиченные правки? → собирать из worktree
npx tsc --noEmit -p tsconfig.app.json          # в sux-chat-app
PYTHONPATH=.:$S/djtest DJANGO_SETTINGS_MODULE=testsettings SECRET_KEY=x \
  $S/djv/bin/python manage.py test chat        # в backend, если трогали бэкенд
git push                    # всё, что выкладывается, — закоммичено и запушено
```

Если в рабочей папке лежит чужая работа, **ничего не stash-ить и не
коммитить за других**: `git worktree add --detach <папка> HEAD`, симлинк
`node_modules`, и собирать оттуда. `ota-publish.py` сам откажется от грязного
`src`, а `~/hyax-deploy-web.sh` — нет, поэтому сайт из грязной папки не
выкладывать.

## 3. Сервер (бэкенд)

```
ssh diwatch 'cd /home/home-restored/home/hyax && git checkout -- sux-chat-app/package-lock.json; git pull --ff-only
  && docker exec sux_chat_api python manage.py check
  && docker exec sux_chat_api python manage.py makemigrations --check --dry-run
  && docker exec sux_chat_api python manage.py migrate --plan
  && docker exec sux_chat_api python manage.py migrate
  && docker restart sux_chat_api sux_chat_tg
  && cp nginx/apk-page/studio.html nginx/apk-page/bots.html backend/media/apk/'
```

После — вход тестовым аккаунтом `zz_da_a` через `POST /api/token/` и
`docker logs --since 2m sux_chat_api | grep -E "Traceback| 5[0-9][0-9] "`.
Миграции — только новые файлы; уже применённые не править (прерванная
выкладка могла их выполнить). Чужие проекты и Caddy на хосте не трогать.

## 4. Веб и OTA (самый частый случай)

1. Сайт: из чистой копии `npm run build`, проверить, что в бандле нет
   лишнего (`grep -c TranslatorHost dist/assets/index-*.js` и т. п.), затем
   `rsync -az --delete dist/ diwatch:/home/home-restored/home/hyax/web/`.
   Сверить `curl -s https://huyax.e-tree.su/ | grep -o 'assets/index-[^"]*\.js'`.
2. По воздуху: `~/.hyax-venv/bin/python scripts/ota-publish.py` из той же
   копии. Номер бандла = число коммитов. Применяется на следующем холодном
   запуске или при уходе приложения в фон (если не идёт звонок, запись,
   загрузка, музыка).
3. Тестовый канал для отладочных сборок (`VITE_OTA_CHANNEL=test`):
   `--channel test --test-build N --force`, N больше прошлого.
4. Откат: `scripts/ota-publish.py --point <сборка>`.

`nginx/apk-page/version.json` при OTA **не трогать**: по нему обновляются
APK и установщики, иначе Android будет качать тот же APK по кругу.

## 5. Полная сборка (релиз на все платформы)

Порядок за один релиз, образец — `$S/rel/chain757.sh` в scratchpad сессии:

1. **Версия в трёх местах**: `sux-chat-app/package.json`,
   `src/lib/appVersion.ts`, `MARKETING_VERSION` + `CURRENT_PROJECT_VERSION`
   в `ios/App/App.xcodeproj/project.pbxproj`. Плюс `nginx/apk-page/version.json`
   (`version`, `build`, `notes`). Коммит `release X.Y.Z (сборка N, iOS M)`,
   где N = число коммитов после этого коммита.
2. **Сайт** — как в п. 4 (его же бандл уходит во все сборки).
3. **Android, витрина**: `npx cap sync android`, `./gradlew assembleRelease`,
   `~/hyax-sign-apk.sh app-release.apk hyax-N.apk` (ротация ключа — встаёт
   поверх старых), проверить `aapt2 dump badging`, положить в
   `/tmp/hyax-dist/hyax.apk`.
4. **Android, Google Play**: `scripts/play-release.sh --track alpha --notes … --notes-en …`
   (чистая копия → AAB → трек, заметки ≤500 знаков). Отдельная сборка с
   `VITE_DISTRIBUTION=play`; versionCode должен быть больше прошлого.
5. **Mac** (универсальный, заверение) и **Windows** (x64+arm64):
   `npx electron-builder --mac --universal` / `--win --x64 --arm64`,
   `APPLE_KEYCHAIN_PROFILE=hyax`. Если заверение виснет «In Progress» дольше
   получаса — не пересобирать: `xcrun notarytool submit <zip> --keychain-profile hyax --wait`
   заново, затем `stapler staple` и `electron-builder --prepackaged … -c.mac.notarize=false`.
   После `--prepackaged` проверить, что в `hyax-mac.zip` `WYX.app` лежит в
   корне (иначе переупаковать `ditto --keepParent`, пересчитать blockmap и
   sha512 в `latest-mac.yml`).
6. **Linux** — на сервере: `$S/rel/linux<N>.sh` (docker node:22, выгрузка в бакет).
7. **iOS**: `npx cap sync ios` (проверить на `[error]`), архив с
   `MARKETING_VERSION=<версия для TestFlight> CURRENT_PROJECT_VERSION=<M>`,
   сверить `index-*.js` в архиве с `dist/`, `-exportArchive` с
   `ExportOptions.plist` (upload). «No Accounts» / «Failed to Use Accounts» —
   в Xcode слетел Apple ID, войти заново в Settings → Accounts и повторить
   экспорт того же архива.
8. **Витрина**: `cd /tmp/hyax-dist && ~/hyax-deploy-s3.sh <файлы>` — льёт в
   бакет и обновляет `version.json` на сервере. Сверить sha256 APK с
   `https://huyax.e-tree.su/dl/hyax.apk`. Без Mac выкладывать можно — Mac
   остаётся на старом `latest-mac.yml`.
9. **OTA** того же коммита — для телефонов на старых сборках.

Релиз только части платформ (например, десктоп): версию поднять, а
`version.json` оставить прежним — иначе телефоны будут «обновляться» в никуда.

## 6. После выкладки

- Вход `zz_da_a` через API, 5xx в логах — нет.
- Сайт отдаёт новый `index-*.js`; манифест OTA показывает новую сборку.
- Витрина: `version.json` и sha256 APK.
- Чужие рабочие копии (`git worktree remove`), `/tmp/hyax-dist` и локальные
  `.pyc` подчистить; на системном диске держать ≥7 ГБ (`tmutil thinlocalsnapshots / 30000000000 1`).

## 7. Магазины

- **App Store Connect**: тексты, рейтинг, конфиденциальность, скриншоты —
  `APPSTORE.md`; скриншоты и баннеры — `design/appstore/`. Сборки в TestFlight
  идут с номером уже одобренной версии (сейчас 1.1.33), чтобы не ждать Beta
  App Review. Тексты для Apple — без чужих брендов, без «18+».
- **Google Play**: `GOOGLE_PLAY.md`; автовыкладка — `scripts/play-release.sh`.
- **Витрина** (`huyax.e-tree.su/apk`, wyx.su): APK, установщики, `version.json`.
