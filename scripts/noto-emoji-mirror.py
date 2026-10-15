#!/usr/bin/env python3
"""Зеркало анимированных эмодзи Google Noto (Noto Emoji Animation, CC BY 4.0).

Клиент берёт эмодзи только с нашего сервера (/media/noto/<код>/…), чтобы
реакции и сообщения не ломались, когда Google недоступен. Скрипт качает для
каждого эмодзи из каталога анимацию (lottie.json) и статичную картинку
(emoji.svg), рядом кладёт .gz для gzip_static, в конце — index.json со списком
кодов. Уже скачанное пропускает, поэтому его можно просто запустить ещё раз,
когда Google добавит новые эмодзи.

Запуск на сервере (пишет в media, которое раздаёт nginx):
  ssh diwatch 'python3 - /home/home-restored/home/hyax/backend/media/noto' < scripts/noto-emoji-mirror.py
Уже скачанное после правки normalize(): тот же запуск с --fix.
Список кодов для клиента — sux-chat-app/src/lib/notoEmojiList.ts — тот же
каталог; при обновлении зеркала обновить и его (см. --client-list).
"""
import gzip
import json
import os
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

API = "https://googlefonts.github.io/noto-emoji-animation/data/api.json"
ASSET = "https://fonts.gstatic.com/s/e/notoemoji/latest/{cp}/{name}"
FILES = ("lottie.json", "emoji.svg")
# Ревизия анимаций (как REV в sux-chat-app/src/lib/notoEmoji.ts). Клиент берёт
# lottie.r<REV>.json — жёсткую ссылку на lottie.json: CDN кэширует медиа по
# пути, без учёта ?query, поэтому исправленный файл нужен под новым именем.
REV = "2"


def get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "wyx-noto-mirror/1"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def normalize(body: bytes) -> bytes:
    """Слой с режимом наложения, под которым в его композиции ничего нет,
    в After Effects рисуется как обычный. Браузеры же смешивают его с фоном
    страницы: у 🎉 конус на белом становился синим (WebKit), на тёмной теме
    съехал бы и в Chromium. Таким слоям ставим обычный режим — без потерь."""
    d = json.loads(body)
    changed = False
    comps = [d.get("layers") or []] + [a.get("layers") or [] for a in d.get("assets") or []]
    for layers in comps:
        for i, layer in enumerate(layers):
            if not layer.get("bm"):
                continue
            below = [x for x in layers[i + 1:] if not x.get("td") and x.get("ty") != 3 and not x.get("hd")]
            if not below:
                layer["bm"] = 0
                changed = True
    return json.dumps(d, separators=(",", ":"), ensure_ascii=False).encode() if changed else body


def save(path: str, body: bytes) -> None:
    tmp = path + ".part"
    with open(tmp, "wb") as f:
        f.write(body)
    os.replace(tmp, path)
    with gzip.open(path + ".gz", "wb", compresslevel=9) as f:
        f.write(body)


def link_rev(dest: str, cp: str) -> None:
    src = os.path.join(dest, cp, "lottie.json")
    dst = os.path.join(dest, cp, f"lottie.r{REV}.json")
    if not os.path.exists(src):
        return
    if os.path.exists(dst):
        if os.path.samefile(src, dst):
            return
        os.remove(dst)
    os.link(src, dst)


def fetch(dest: str, cp: str) -> tuple[str, int, str]:
    d = os.path.join(dest, cp)
    os.makedirs(d, exist_ok=True)
    got = 0
    for name in FILES:
        path = os.path.join(d, name)
        if os.path.exists(path) and os.path.getsize(path) > 0:
            continue
        try:
            body = get(ASSET.format(cp=cp, name=name))
        except Exception as e:  # noqa: BLE001 — один битый файл не останавливает зеркало
            return cp, got, f"{name}: {e}"
        if name == "lottie.json":
            body = normalize(body)
        save(path, body)
        got += len(body)
    return cp, got, ""


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    catalog = json.loads(get(API))
    cps = sorted({i["codepoint"] for i in catalog["icons"]})
    if "--client-list" in sys.argv:
        print(" ".join(cps))
        return
    dest = args[0] if args else "noto"
    os.makedirs(dest, exist_ok=True)
    if "--fix" in sys.argv:
        # Прогнать нормализацию по уже скачанному (после правки normalize).
        fixed = 0
        for cp in cps:
            path = os.path.join(dest, cp, "lottie.json")
            if not os.path.exists(path):
                continue
            body = open(path, "rb").read()
            new = normalize(body)
            if new is not body:
                save(path, new)
                fixed += 1
        for cp in cps:
            link_rev(dest, cp)
        print(f"нормализовано файлов: {fixed}, ссылки lottie.r{REV}.json обновлены")
        return
    total, errors = 0, []
    with ThreadPoolExecutor(max_workers=8) as pool:
        for cp, got, err in pool.map(lambda c: fetch(dest, c), cps):
            total += got
            if err:
                errors.append(f"{cp} {err}")
    for cp in cps:
        link_rev(dest, cp)
    ok = [c for c in cps if all(os.path.exists(os.path.join(dest, c, n)) for n in FILES)]
    with open(os.path.join(dest, "index.json"), "w") as f:
        json.dump({"source": "Noto Emoji Animation (Google), CC BY 4.0", "codepoints": ok}, f)
    print(f"каталог {len(cps)}, на месте {len(ok)}, скачано {total // 1024} КБ, ошибок {len(errors)}")
    for e in errors[:20]:
        print("  ", e)


if __name__ == "__main__":
    main()
