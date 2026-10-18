#!/usr/bin/env python3
"""Публикация веб-бандла для обновления по воздуху (sux-chat-app/src/lib/ota.ts).

Собирает sux-chat-app (vite), пакует dist в zip и кладёт в публичный бакет:
    hyax-public/ota/wyx-<сборка>-<sha8>.zip   — архив, имя не меняется никогда
    hyax-public/ota/manifest.json             — что ставить (без кэша)
    hyax-public/ota/history/<сборка>.json      — копия манифеста для отката
Телефоны со сборкой, где есть плагин, скачают бандл при проверке и применят
при следующем холодном запуске.

Только веб-часть. Правки нативного кода, плагинов и capacitor.config требуют
новой сборки — и подъёма min_native в sux-chat-app/ota-min-native.json, если
веб-код начинает на них опираться: старые сборки такой бандл не возьмут.

Запуск (boto3 и ключи — те же, что у ~/hyax-deploy-s3.sh):
    ~/.hyax-venv/bin/python scripts/ota-publish.py                # сборка + выкладка
    ~/.hyax-venv/bin/python scripts/ota-publish.py --channel test # тестовый канал
    ~/.hyax-venv/bin/python scripts/ota-publish.py --dry-run      # только собрать и упаковать
    ~/.hyax-venv/bin/python scripts/ota-publish.py --point 735    # откатить манифест на сборку 735
Сборка должна быть из закоммиченного кода: номер бандла — число коммитов, и
два разных бандла с одним номером телефон не различит (--force — всё равно).
"""
import argparse
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import urllib.request
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, "sux-chat-app")
DIST = os.path.join(APP, "dist")
BUCKET = "hyax-public"
PREFIX = "ota/"
PUBLIC = "https://storage.yandexcloud.net/hyax-public/ota/"
OUT = "/tmp/hyax-ota"


def sh(cmd, cwd=ROOT, env=None):
    return subprocess.run(cmd, cwd=cwd, env=env, check=True, capture_output=True, text=True).stdout.strip()


def s3():
    import boto3
    env = {}
    with open(os.path.expanduser("~/.hyax-s3.env"), encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return boto3.client("s3", endpoint_url=env["S3_ENDPOINT_URL"], region_name=env.get("S3_REGION", "ru-central1"),
                        aws_access_key_id=env["S3_ACCESS_KEY_ID"], aws_secret_access_key=env["S3_SECRET_ACCESS_KEY"])


def put_json(c, key, data):
    body = (json.dumps(data, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    c.put_object(Bucket=BUCKET, Key=key, Body=body, ACL="public-read",
                 ContentType="application/json; charset=utf-8", CacheControl="no-cache, max-age=0")


def manifest_key(channel):
    return f"{PREFIX}manifest{'-' + channel if channel else ''}.json"


def history_key(channel, build):
    return f"{PREFIX}history/{channel + '-' if channel else ''}{build}.json"


def check_public(url, want_size=None):
    r = urllib.request.urlopen(urllib.request.Request(f"{url}?t={os.getpid()}", method="GET"), timeout=30)
    body = r.read()
    if want_size is not None and len(body) != want_size:
        raise SystemExit(f"✗ {url}: {len(body)} б вместо {want_size}")
    return body


def point(channel, build):
    """Манифест — на уже выложенный бандл (откат или возврат)."""
    c = s3()
    raw = c.get_object(Bucket=BUCKET, Key=history_key(channel, build))["Body"].read()
    m = json.loads(raw)
    put_json(c, manifest_key(channel), m)
    got = json.loads(check_public(PUBLIC + manifest_key(channel)[len(PREFIX):]))
    print(f"✓ манифест{' ' + channel if channel else ''} → {got['version']} ({got['url'].rsplit('/', 1)[-1]})")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--channel", default="", help="пусто — основной; test — тестовые сборки с VITE_OTA_CHANNEL=test")
    ap.add_argument("--dry-run", action="store_true", help="собрать и упаковать, ничего не выкладывать")
    ap.add_argument("--skip-build", action="store_true", help="взять готовый dist (собран с тем же каналом!)")
    ap.add_argument("--force", action="store_true", help="выкладывать и с незакоммиченными правками")
    ap.add_argument("--point", type=int, help="переключить манифест на ранее выложенную сборку")
    ap.add_argument("--test-build", type=int, help="только с --channel: номер сборки бандла вместо числа коммитов")
    a = ap.parse_args()
    if a.channel and not re.fullmatch(r"[a-z0-9-]{1,20}", a.channel):
        raise SystemExit("канал: латиница, цифры, дефис")

    if a.test_build and not a.channel:
        raise SystemExit("--test-build — только для тестового канала")
    if a.point:
        point(a.channel, a.point)
        return

    dirty = sh(["git", "status", "--porcelain", "--", "sux-chat-app/src", "sux-chat-app/public", "sux-chat-app/index.html",
                "sux-chat-app/package.json", "sux-chat-app/vite.config.ts"])
    if dirty and not a.force:
        raise SystemExit("есть незакоммиченные правки клиента — сначала коммит (или --force):\n" + dirty)

    build = a.test_build or int(sh(["git", "rev-list", "--count", "HEAD"]))
    version = re.search(r'APP_VERSION = "([^"]+)"', open(os.path.join(APP, "src/lib/appVersion.ts"), encoding="utf-8").read()).group(1)
    bundle = f"{version}-{build}"
    min_native = {k: v for k, v in json.load(open(os.path.join(APP, "ota-min-native.json"), encoding="utf-8")).items()
                  if k in ("ios", "android")}

    if not a.skip_build:
        env = {**os.environ, "VITE_OTA_CHANNEL": a.channel}
        env.pop("HYAX_TEST_BUILD", None)
        if a.test_build:
            env["HYAX_TEST_BUILD"] = str(a.test_build)
        env.pop("VITE_DISTRIBUTION", None)  # сборка для Play по воздуху не обновляется
        print(f"==> сборка {bundle}{' (канал ' + a.channel + ')' if a.channel else ''}")
        r = subprocess.run(["npm", "run", "build"], cwd=APP, env=env, capture_output=True, text=True)
        if r.returncode:
            raise SystemExit("✗ сборка не прошла:\n" + (r.stdout + r.stderr)[-1500:])
    index = open(os.path.join(DIST, "index.html"), encoding="utf-8").read()
    js = re.search(r'assets/index-[A-Za-z0-9_-]+\.js', index)
    if not js:
        raise SystemExit("в dist/index.html нет бандла")
    code = open(os.path.join(DIST, js.group(0)), encoding="utf-8").read()
    # Бандл должен знать свой номер — иначе после установки он не поймёт, что
    # это он, и будет качать себя снова.
    if f'"{build}"' not in code or f'"{version}"' not in code:
        raise SystemExit(f"в {js.group(0)} нет версии {version} или сборки {build} — dist собран не из этого коммита?")
    # Сборщик не склеивает адрес манифеста — ищем сам канал рядом с «manifest-».
    if a.channel and not re.search(r'manifest-.{0,80}"%s"|"%s".{0,80}manifest-' % (a.channel, a.channel), code):
        raise SystemExit(f"dist собран не для канала {a.channel} (VITE_OTA_CHANNEL)")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for base, _, files in os.walk(DIST):
            for f in sorted(files):
                if f == ".DS_Store":
                    continue
                path = os.path.join(base, f)
                z.write(path, os.path.relpath(path, DIST))
    data = buf.getvalue()
    sha = hashlib.sha256(data).hexdigest()
    name = f"wyx-{build}-{sha[:8]}.zip"
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, name), "wb") as f:
        f.write(data)
    m = {"version": bundle, "build": build, "url": PUBLIC + name, "sha256": sha,
         "min_native": min_native, "commit": sh(["git", "rev-parse", "--short", "HEAD"])}
    print(f"   {name}: {len(data) / 1e6:.2f} МБ, sha256 {sha[:12]}…, min_native {min_native}")
    if a.dry_run:
        print(f"   --dry-run: лежит в {OUT}, ничего не выложено")
        return

    c = s3()
    # Архив — неизменный: имя содержит хэш, кэшировать можно сколько угодно.
    c.put_object(Bucket=BUCKET, Key=PREFIX + name, Body=data, ACL="public-read", ContentType="application/zip",
                 CacheControl="public, max-age=31536000, immutable", Metadata={"sha256": sha})
    check_public(PUBLIC + name, len(data))
    put_json(c, history_key(a.channel, build), m)
    put_json(c, manifest_key(a.channel), m)
    got = json.loads(check_public(PUBLIC + manifest_key(a.channel)[len(PREFIX):]))
    if got.get("sha256") != sha:
        raise SystemExit("✗ манифест в бакете не тот, что выложен")
    print(f"✓ {bundle} выложен{' в канал ' + a.channel if a.channel else ''}: {PUBLIC}{manifest_key(a.channel)[len(PREFIX):]}")


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as e:
        sys.exit(f"✗ {' '.join(e.cmd)}: {(e.stderr or e.stdout or '').strip()[-500:]}")
