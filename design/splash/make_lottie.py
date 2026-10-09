"""Lottie-заставка WhoYaX: сборка логотипа по мотивам ролика r2-proxy.

    python design/splash/make_lottie.py  →  sux-chat-app/public/splash.json

Геометрия «X» — из Figma (иконка «в 3 тоньше», 1024×1024): две таблетки
196.8×893.6 с радиусом 98.4, повёрнутые на ±45°, градиент сверху вниз от
#C7F964 к #345C54; подложка — скруглённый квадрат #345C54 (радиус 250).
Надпись «WhoYaX» — контуры Inter SemiBold, чтобы не зависеть от шрифтов
устройства. Фон прозрачный — заставка ложится на фон темы.

Сценарий (30 к/с):
  0–9     таблетка проявляется в центре
  9–30    расходится на две полосы, они поворачиваются в «X»
  24–48   под «X» вырастает подложка (с лёгким перелётом)
  48–72   буквы разъезжаются из центра — «WhoYaX»
  72–100  салатовая точка прыгает по W → Y → X
  100–118 h, o, a гаснут, W Y X съезжаются в «WYX»
  118–140 держим финальный кадр

Метки (markers, cm = "haptic:<сила>") — моменты виброотклика: index.html
дёргает Haptics, когда анимация проходит кадр метки.
"""
import json
import os

from fontTools.pens.recordingPen import RecordingPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FONT = os.path.join(ROOT, "sux-chat-app/node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2")
OUT = os.path.join(ROOT, "sux-chat-app/public/splash.json")

W = H = 768
FR = 30
OP = 140
CX, CY = 384, 330            # центр иконки
ICON = 316                   # сторона подложки
K = ICON / 1024              # масштаб из макета Figma
BAR_W, BAR_H, BAR_R = 196.8 * K, 893.6 * K, 98.4 * K
TEAL = (0x34 / 255, 0x5C / 255, 0x54 / 255)
LIME = (0xC7 / 255, 0xF9 / 255, 0x64 / 255)
TEXT_Y = CY + ICON / 2 + 34  # верх надписи (место под прыгающую точку)
TEXT_W = 321                 # ширина надписи «WhoYaX»
CAP_H = 0.23 * ICON          # высота заглавных — как в ролике
SQ_R = 0.32 * ICON           # скругление подложки (на глаз ≈20% от стороны)

EASE_OUT = {"i": {"x": [0.2], "y": [1]}, "o": {"x": [0.35], "y": [0]}}
EASE_IO = {"i": {"x": [0.45], "y": [1]}, "o": {"x": [0.55], "y": [0]}}
BACK = {"i": {"x": [0.3], "y": [1.35]}, "o": {"x": [0.4], "y": [0]}}  # с перелётом


def static(v):
    return {"a": 0, "k": v}


def anim(*keys, ease=EASE_OUT):
    """keys: (кадр, значение) — значение число или список."""
    out = []
    for i, (t, v) in enumerate(keys):
        k = {"t": t, "s": v if isinstance(v, list) else [v]}
        if i < len(keys) - 1:
            k.update(ease)
        out.append(k)
    return {"a": 1, "k": out}


def transform(p=None, r=None, s=None, o=None, a=None):
    return {
        "o": o or static(100), "r": r or static(0),
        "p": p or static([CX, CY, 0]), "a": a or static([0, 0, 0]),
        "s": s or static([100, 100, 100]),
    }


def group(items, name):
    return {"ty": "gr", "nm": name, "it": items + [{
        "ty": "tr", "p": static([0, 0]), "a": static([0, 0]), "s": static([100, 100]),
        "r": static(0), "o": static(100), "sk": static(0), "sa": static(0),
    }]}


def layer(ind, name, shapes, ks):
    return {"ddd": 0, "ind": ind, "ty": 4, "nm": name, "sr": 1, "ks": ks, "ao": 0,
            "shapes": shapes, "ip": 0, "op": OP, "st": 0, "bm": 0}


def grad(c0, c1, a1=1.0, h=BAR_H):
    g = {"ty": "gf", "nm": "grad", "o": static(100), "r": 1, "bm": 0, "t": 1,
         "s": static([0, -h / 2]), "e": static([0, h / 2]),
         "g": {"p": 2, "k": static([0, *c0, 1, *c1])}}
    if a1 < 1:
        g["g"]["k"] = static([0, *c0, 1, *c1, 0, 1, 1, a1])
    return g


def mix(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


# Полосы «X»: концевые цвета градиента — как у макета на 100% длины.
BAR1_END = mix(LIME, TEAL, 0.75)
BAR2_END = mix(LIME, TEAL, 0.62)
LIME_TOP = mix(LIME, TEAL, 0.08)


def bar(ind, name, end_color, end_alpha, angle, dx):
    rect = {"ty": "rc", "nm": "pill", "d": 1, "s": static([BAR_W, BAR_H]), "p": static([0, 0]), "r": static(BAR_R)}
    ks = transform(
        p=anim((9, [CX, CY, 0]), (16, [CX + dx, CY, 0]), (30, [CX, CY, 0]), ease=EASE_IO),
        r=anim((12, 0), (30, angle), ease=EASE_IO),
        s=anim((0, [70, 70, 100]), (9, [100, 100, 100])),
        o=anim((0, 0), (6, 100)),
    )
    return layer(ind, name, [group([rect, grad(LIME_TOP, end_color, end_alpha)], name)], ks)


def backdrop(ind):
    rect = {"ty": "rc", "nm": "squircle", "d": 1, "s": static([ICON, ICON]), "p": static([0, 0]), "r": static(SQ_R)}
    fill = {"ty": "fl", "nm": "teal", "o": static(100), "c": static([*TEAL, 1]), "r": 1, "bm": 0}
    # Поднимается снизу и «обволакивает» уже собранный «X».
    ks = transform(
        p=anim((24, [CX, CY + ICON * 0.55, 0]), (46, [CX, CY, 0]), ease=EASE_OUT),
        s=anim((24, [45, 45, 100]), (48, [100, 100, 100]), ease=BACK),
        o=anim((24, 0), (30, 100)),
    )
    return layer(ind, "backdrop", [group([rect, fill], "backdrop")], ks)


# ---------- надпись ----------
def glyph_paths(font, text):
    gs = font.getGlyphSet()
    cmap = font.getBestCmap()
    upm = font["head"].unitsPerEm
    hmtx = font["hmtx"]
    x = 0
    out = []
    for ch in text:
        gn = cmap[ord(ch)]
        pen = RecordingPen()
        gs[gn].draw(pen)
        out.append((ch, x, pen.value))
        x += hmtx[gn][0]
    return out, x, upm


def contours(rec, scale, ox, oy):
    """Записанные сегменты → контуры Lottie (v, i, o — касательные относительно вершин)."""
    res = []
    cur = None
    pt = lambda p: [ox + p[0] * scale, oy - p[1] * scale]
    for op, args in rec:
        if op == "moveTo":
            cur = {"v": [pt(args[0])], "i": [[0, 0]], "o": [[0, 0]]}
        elif op == "lineTo":
            cur["v"].append(pt(args[0])); cur["i"].append([0, 0]); cur["o"].append([0, 0])
        elif op in ("qCurveTo", "curveTo"):
            pts = [pt(a) for a in args]
            if op == "qCurveTo":
                # TrueType: цепочка off-curve точек с неявными on-curve посередине.
                start = cur["v"][-1]
                offs, end = pts[:-1], pts[-1]
                segs = []
                for j, c in enumerate(offs):
                    e = end if j == len(offs) - 1 else [(c[0] + offs[j + 1][0]) / 2, (c[1] + offs[j + 1][1]) / 2]
                    segs.append((c, e))
                for c, e in segs:
                    s0 = cur["v"][-1]
                    c1 = [s0[0] + 2 / 3 * (c[0] - s0[0]), s0[1] + 2 / 3 * (c[1] - s0[1])]
                    c2 = [e[0] + 2 / 3 * (c[0] - e[0]), e[1] + 2 / 3 * (c[1] - e[1])]
                    cur["o"][-1] = [c1[0] - s0[0], c1[1] - s0[1]]
                    cur["v"].append(e); cur["i"].append([c2[0] - e[0], c2[1] - e[1]]); cur["o"].append([0, 0])
                _ = start
            else:
                c1, c2, e = pts
                s0 = cur["v"][-1]
                cur["o"][-1] = [c1[0] - s0[0], c1[1] - s0[1]]
                cur["v"].append(e); cur["i"].append([c2[0] - e[0], c2[1] - e[1]]); cur["o"].append([0, 0])
        elif op in ("closePath", "endPath"):
            if cur and len(cur["v"]) > 1:
                a, b = cur["v"][0], cur["v"][-1]
                if abs(a[0] - b[0]) < 1e-6 and abs(a[1] - b[1]) < 1e-6:
                    cur["i"][0] = cur["i"][-1]
                    cur["v"].pop(); cur["i"].pop(); cur["o"].pop()
                res.append({"i": cur["i"], "o": cur["o"], "v": cur["v"], "c": True})
            cur = None
    return res


def text_layers(start_ind):
    """Буквы «WhoYaX» и прыгающая точка. Возвращает (слои, метки отклика)."""
    font = TTFont(FONT)
    font = instantiateVariableFont(font, {"wght": 650})
    glyphs, adv, upm = glyph_paths(font, "WhoYaX")
    scale = CAP_H / font["OS/2"].sCapHeight
    hmtx, cmap = font["hmtx"], font.getBestCmap()
    width = lambda ch: hmtx[cmap[ord(ch)]][0] * scale
    # Ширину держим как в ролике: высокие буквы — плотнее трекинг.
    track = (TEXT_W - adv * scale) / (len(glyphs) - 1)
    base_y = TEXT_Y + CAP_H
    left = CX - TEXT_W / 2
    # Итоговое «WYX» — те же буквы, тот же трекинг, по центру.
    keep = "WYX"
    packed = sum(width(c) for c in keep) + track * (len(keep) - 1)
    wyx_x, x = {}, CX - packed / 2
    for c in keep:
        wyx_x[c] = x
        x += width(c) + track

    layers, centers = [], {}
    for n, (ch, gx, rec) in enumerate(glyphs):
        paths = contours(rec, scale, 0, 0)  # в координатах слоя: начало — точка привязки
        shapes = [{"ty": "sh", "nm": f"c{j}", "ks": static(p)} for j, p in enumerate(paths)]
        shapes.append({"ty": "fl", "nm": "letter", "o": static(100), "c": static([*TEAL, 1]), "r": 1, "bm": 0})
        x_final = left + gx * scale + n * track
        centers[ch] = x_final + width(ch) / 2
        start = 48 + n * 3
        # Разъезжаются от центра, но не из одной точки — иначе буквы на миг двоились.
        x_from = x_final + (CX - x_final) * 0.45
        if ch in keep:
            p = anim((start, [x_from, base_y + 6, 0]), (start + 14, [x_final, base_y, 0]),
                     (100, [x_final, base_y, 0]), (116, [wyx_x[ch], base_y, 0]), ease=EASE_IO)
            o = anim((start, 0), (start + 6, 100))
        else:
            # h, o, a гаснут и чуть уходят вниз — W, Y, X съезжаются на их место.
            p = anim((start, [x_from, base_y + 6, 0]), (start + 14, [x_final, base_y, 0]),
                     (100, [x_final, base_y, 0]), (110, [x_final, base_y + 10, 0]), ease=EASE_IO)
            o = anim((start, 0), (start + 6, 100), (100, 100), (108, 0))
        layers.append(layer(start_ind + n, f"letter {ch}", [group(shapes, ch)], transform(p=p, o=o)))

    # Точка: прыгает по W, Y, X и съезжает вместе с X.
    r = 6
    top = TEXT_Y - 11                  # над заглавными
    jump = 46                          # высота прыжка
    dot = {"ty": "el", "nm": "dot", "d": 1, "s": static([2 * r, 2 * r]), "p": static([0, 0])}
    fill = {"ty": "fl", "nm": "lime", "o": static(100), "c": static([*LIME, 1]), "r": 1, "bm": 0}
    wx, yx, xx = centers["W"], centers["Y"], centers["X"]
    arc = lambda a, b: [(a + b) / 2, top - jump, 0]
    keys = [
        (72, [wx, top - jump, 0]), (76, [wx, top, 0]),          # падает на W
        (81, arc(wx, yx)), (86, [yx, top, 0]),                   # прыжок на Y
        (92, arc(yx, xx)), (98, [xx, top, 0]),                   # прыжок на X
        (100, [xx, top, 0]), (116, [wyx_x["X"] + width("X") / 2, top, 0]),  # едет с X
    ]
    dot_ks = transform(
        p=anim(*keys, ease=EASE_IO),
        s=anim((72, [0, 0, 100]), (76, [100, 100, 100]), (77, [130, 70, 100]), (79, [100, 100, 100]),
               (86, [130, 70, 100]), (88, [100, 100, 100]), (98, [130, 70, 100]), (100, [100, 100, 100])),
        o=anim((72, 0), (74, 100)),
    )
    layers.insert(0, layer(start_ind + len(glyphs), "dot", [group([dot, fill], "dot")], dot_ks))
    markers = [
        {"tm": 30, "cm": "haptic:medium", "dr": 0},   # «X» собран
        {"tm": 46, "cm": "haptic:light", "dr": 0},    # подложка встала
        {"tm": 76, "cm": "haptic:light", "dr": 0},    # точка на W
        {"tm": 86, "cm": "haptic:light", "dr": 0},    # на Y
        {"tm": 98, "cm": "haptic:light", "dr": 0},    # на X
        {"tm": 116, "cm": "haptic:medium", "dr": 0},  # собралось «WYX»
    ]
    return layers, markers


def main():
    layers, markers = text_layers(1)
    n = len(layers)
    layers += [
        bar(n + 1, "bar 2", BAR2_END, 1 - 0.43 / 1.9066, -45, 26),
        bar(n + 2, "bar 1", BAR1_END, 1.0, 45, -26),
        backdrop(n + 3),
    ]
    doc = {"v": "5.7.4", "fr": FR, "ip": 0, "op": OP, "w": W, "h": H, "nm": "WhoYaX splash",
           "ddd": 0, "assets": [], "layers": layers, "markers": markers}
    with open(OUT, "w") as f:
        json.dump(doc, f, separators=(",", ":"))
    print(OUT, os.path.getsize(OUT), "bytes")


if __name__ == "__main__":
    main()
