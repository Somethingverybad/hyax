# Страница загрузок Бупня

Опубликована 18.11.2026: https://nemilf.hyax.ru/bypen/.
Статический HTML без внешних библиотек и шрифтов; stump.svg взят из design/stump.svg
отдельного репозитория bypen. Палитра совпадает с приложением.

## Размещение

Сервер NL: root@2a13:d201:1:df::1, существующий ключ ~/.ssh/id_ed25519,
ProxyJump Administrator@194.164.245.54. Исходники страницы размещены
в /home/vpn/web/bypen/{index.html,stump.svg}; этот каталог уже примонтирован
в контейнер vpn-web как /etc/nginx/vpn:ro. Менять compose не потребовалось.

Маршруты из location.conf добавлены только в server nemilf.hyax.ru
файла /home/vpn/web/nginx.conf. /bypen перенаправляет на /bypen/.
Другие домены и VPN-маршруты не менялись. Перед изменением сделана копия:
/home/vpn/web/nginx.conf.before-bypen-20261118-164121.

Для изменения HTML достаточно атомарно заменить index.html в каталоге страницы;
reload не требуется. При изменении конфигурации проверить nginx -t с
`-c /etc/nginx/vpn/nginx.conf` в vpn-web, затем сделать плавный reload этого
контейнера nginx. Не перезапускать vpn-front, vpn-web или 3x-ui.

## Установщики

Объекты находятся в hyax-public/installers/bypen/ (обновлено 23.11.2026, версия 0.1.21):

- Android: bypen-{arm64-v8a,armeabi-v7a,x86_64}-21.apk (выкладка — android/scripts/publish.sh в bypen).
- macOS: bypen-mac-0.1.21.zip (ios/scripts/publish-mac.sh), постоянная ссылка bypen-mac.zip.
- Windows: bypen-windows-x64-0.1.21.zip, Linux: bypen-linux-x64-0.1.21.tar.gz (desktop/scripts/publish.sh),
  постоянные bypen-windows-x64.zip / bypen-linux-x64.tar.gz.
- SHA256SUMS-desktop — суммы трёх архивов для компьютеров.

После новой выкладки поменять номера в index.html и залить его (см. «Размещение»):
`scp -J Administrator@194.164.245.54 index.html root@[2a13:d201:1:df::1]:/home/vpn/web/bypen/index.html.new`, затем `mv` на месте.
