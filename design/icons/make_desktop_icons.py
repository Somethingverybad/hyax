"""Иконки десктопа из иконки iOS (мятная, 1024×1024, квадрат без скругления).

    python design/icons/make_desktop_icons.py

→ sux-chat-app/assets/icon.icns   macOS: скруглённый квадрат 824 на холсте 1024
                                  с полями и мягкой тенью — по сетке Apple, как
                                  у остальных приложений в Dock
→ sux-chat-app/assets/icon.ico    Windows: 16…256, скруглённый квадрат во весь размер
→ sux-chat-app/assets/icons/*.png Linux: те же размеры, что и раньше

Нужны Pillow и iconutil (есть в macOS).
"""
import os
import shutil
import subprocess
import tempfile

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
APP = os.path.join(ROOT, "sux-chat-app")
SRC = os.path.join(APP, "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png")
SS = 4  # сглаживание краёв: маска рисуется вчетверо крупнее


def rounded(img, radius):
    w, h = img.size
    mask = Image.new("L", (w * SS, h * SS), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, w * SS - 1, h * SS - 1), radius=radius * SS, fill=255)
    out = img.convert("RGBA")
    out.putalpha(mask.resize((w, h), Image.LANCZOS))
    return out


def mac_icon(src):
    """Сетка Apple для иконок macOS: тело 824×824 в холсте 1024, радиус ≈185, тень вниз."""
    canvas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    body = rounded(src.resize((824, 824), Image.LANCZOS), 185)
    shadow = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    shadow_mask = Image.new("L", (1024, 1024), 0)
    shadow_mask.paste(body.getchannel("A"), (100, 112))
    shadow.putalpha(shadow_mask.filter(ImageFilter.GaussianBlur(14)).point(lambda a: a * 0.32))
    canvas.alpha_composite(shadow)
    canvas.alpha_composite(body, (100, 100))
    return canvas


def main():
    src = Image.open(SRC).convert("RGBA")

    # macOS: iconset → icns
    mac = mac_icon(src)
    tmp = tempfile.mkdtemp()
    iconset = os.path.join(tmp, "icon.iconset")
    os.makedirs(iconset)
    for s in (16, 32, 128, 256, 512):
        mac.resize((s, s), Image.LANCZOS).save(os.path.join(iconset, f"icon_{s}x{s}.png"))
        mac.resize((s * 2, s * 2), Image.LANCZOS).save(os.path.join(iconset, f"icon_{s}x{s}@2x.png"))
    subprocess.run(["iconutil", "-c", "icns", iconset, "-o", os.path.join(APP, "assets/icon.icns")], check=True)
    shutil.rmtree(tmp)

    # Windows и Linux: скруглённый квадрат во весь размер (радиус ~22%).
    flat = rounded(src, 226)
    sizes = (16, 24, 32, 48, 64, 128, 256, 512)
    for s in sizes:
        flat.resize((s, s), Image.LANCZOS).save(os.path.join(APP, f"assets/icons/{s}x{s}.png"))
    flat.resize((256, 256), Image.LANCZOS).save(os.path.join(APP, "assets/icon.ico"),
                                                 sizes=[(s, s) for s in sizes if s <= 256])
    print("ok: icon.icns, icon.ico, icons/*.png")


if __name__ == "__main__":
    main()
