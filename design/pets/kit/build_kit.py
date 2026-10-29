"""Набор для авторов питомцев (Студия → Питомцы): архив с исходниками кота и просмотрщик.

    python3 design/pets/kit/build_kit.py

Кладёт в backend/media/pets/ (nginx отдаёт как /media/pets/):
  wyx-pet-kit-r<REV>.zip — пак кота, генератор, просмотрщик, гайд, формат пака;
  viewer-r<REV>.html     — тот же просмотрщик, его открывают прямо из Студии.

Гайд пишется один раз — в nginx/apk-page/studio.html между <!-- pet-guide:start -->
и <!-- pet-guide:end -->; отсюда он уходит в архив отдельной страницей.
CDN кэширует /media/ по пути, поэтому номер — в имени файла: изменили кота или
гайд — поднимите REV; ссылки в Студии скрипт поправит сам.

Собранное в git не лежит (backend/media/pets/ в .gitignore): это сборка, на сервер
её кладут копированием в backend/media/pets/, а studio.html — в backend/media/apk/.
"""
import json
import os
import re
import zipfile

REV = 1
HERE = os.path.dirname(os.path.abspath(__file__))
PETS = os.path.dirname(HERE)
ROOT = os.path.dirname(os.path.dirname(PETS))
CAT = os.path.join(ROOT, "sux-chat-app/public/pets/cat")
LOTTIE = os.path.join(ROOT, "sux-chat-app/node_modules/lottie-web/build/player/lottie.min.js")
STUDIO = os.path.join(ROOT, "nginx/apk-page/studio.html")
OUT = os.path.join(ROOT, "backend/media/pets")


def read(p, mode="r"):
    with open(p, mode, **({} if "b" in mode else {"encoding": "utf-8"})) as f:
        return f.read()


def script_safe(text):
    """Вставка внутрь <script>: не дать строке «</script>» закрыть тег раньше времени."""
    return text.replace("</", "<\\/")


def viewer():
    man = json.loads(read(os.path.join(CAT, "manifest.json")))
    files, sizes = {}, {}
    for meta in man["poses"].values():
        for f in [meta["file"], *meta.get("files", {}).values()]:
            files[f] = json.loads(read(os.path.join(CAT, f)))
            sizes[f] = os.path.getsize(os.path.join(CAT, f))
    pack = json.dumps({"manifest": man, "files": files, "sizes": sizes}, ensure_ascii=False, separators=(",", ":"))
    html = read(os.path.join(HERE, "viewer.html"))
    return (html.replace("/*LOTTIE*/", script_safe(read(LOTTIE)))
                .replace("/*LOOK*/", script_safe(read(os.path.join(PETS, "tools/look.js"))))
                .replace("/*PACK*/", script_safe(pack)))


def guide():
    studio = read(STUDIO)
    m = re.search(r"<!-- pet-guide:start -->(.*?)<!-- pet-guide:end -->", studio, re.S)
    if not m:
        raise SystemExit("В studio.html нет блока <!-- pet-guide:start --> … <!-- pet-guide:end -->")
    return f"""<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Как сделать питомца для WYX</title>
<style>
body{{margin:0;background:#f6f4f0;color:#1f2024;font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:24px 16px}}
.guide{{max-width:820px;margin:0 auto;background:#fff;border-radius:16px;padding:8px 24px 24px}}
h1{{max-width:820px;margin:0 auto 12px;font-size:24px}} h3{{font-size:18px;margin:22px 0 8px}}
code{{background:#f0ede7;border-radius:6px;padding:1px 6px;font-size:13px}}
pre{{background:#f0ede7;border-radius:12px;padding:12px;overflow-x:auto;font-size:13px}}
table{{width:100%;border-collapse:collapse;font-size:14px}} th,td{{text-align:left;padding:7px 8px;border-bottom:1px solid #e6e1d8;vertical-align:top}} th{{color:#6f7078}}
</style></head><body><h1>Как сделать питомца для WYX</h1>{m.group(1)}</body></html>"""


README = """Набор автора питомца WYX

  GUIDE.html   — гайд: как нарисовать своего питомца (начните с него)
  viewer.html  — просмотрщик: откройте в браузере → «Открыть папку пака»;
                 показывает позы на пузыре, пол, окрасы, украшения и проверяет пак
  cat/         — готовый пак кота: manifest.json и 12 поз Lottie — основа для своего
  FORMAT.md    — справочник по формату пака (все поля манифеста)
  generator/   — как кот собран кодом: python3 generator/cat/make_cat.py моя-папка
"""


def main():
    os.makedirs(OUT, exist_ok=True)
    view = viewer()
    with open(os.path.join(OUT, f"viewer-r{REV}.html"), "w", encoding="utf-8") as f:
        f.write(view)
    zpath = os.path.join(OUT, f"wyx-pet-kit-r{REV}.zip")
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        base = "wyx-pet-kit/"
        z.writestr(base + "README.txt", README)
        z.writestr(base + "GUIDE.html", guide())
        z.writestr(base + "viewer.html", view)
        z.writestr(base + "FORMAT.md", read(os.path.join(PETS, "README.md")))
        for f in sorted(os.listdir(CAT)):
            z.write(os.path.join(CAT, f), base + "cat/" + f)
        z.write(os.path.join(PETS, "kit.py"), base + "generator/kit.py")
        z.write(os.path.join(PETS, "cat/make_cat.py"), base + "generator/cat/make_cat.py")
    # Ссылки Студии — на эту версию.
    studio = read(STUDIO)
    fixed = re.sub(r"/media/pets/wyx-pet-kit-r\d+\.zip", f"/media/pets/wyx-pet-kit-r{REV}.zip", studio)
    fixed = re.sub(r"/media/pets/viewer-r\d+\.html", f"/media/pets/viewer-r{REV}.html", fixed)
    if fixed != studio:
        with open(STUDIO, "w", encoding="utf-8") as f:
            f.write(fixed)
    print(f"→ {zpath} ({os.path.getsize(zpath) // 1024} КБ), viewer-r{REV}.html ({len(view.encode()) // 1024} КБ)")


if __name__ == "__main__":
    main()
