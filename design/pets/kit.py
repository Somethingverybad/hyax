"""Общий набор для паков питомцев WYX: примитивы Lottie, ритмы и эффекты.

Генераторы зверей (design/pets/<вид>/make_<вид>.py) собирают позы из этих
кусков. Формат пака — design/pets/README.md.
"""
import json
import os

W, H, FR = 200, 240, 30
SW = 5.0      # контур
SW2 = 3.2     # детали лица
EASE = {"i": {"x": [0.42], "y": [1]}, "o": {"x": [0.58], "y": [0]}}
LIN = {"i": {"x": [1], "y": [1]}, "o": {"x": [0], "y": [0]}}


def rgb(h, a=1.0):
    h = h.lstrip("#")
    return [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)] + [a]


# ---------- примитивы Lottie ----------
def st(v):
    return {"a": 0, "k": v}


def kf(keys, ease=EASE):
    """keys: [(кадр, значение)] — значение число, список или путь (dict)."""
    out = []
    for i, (t, v) in enumerate(keys):
        s = [v] if isinstance(v, (int, float, dict)) else v
        k = {"t": t, "s": s}
        if i < len(keys) - 1:
            k.update(ease)
        out.append(k)
    return {"a": 1, "k": out}


def smooth(points, closed=True, tension=0.38):
    """Точки → гладкий путь Lottie (касательные по соседям, как Catmull-Rom)."""
    n = len(points)
    vi, vo = [], []
    for j, (x, y) in enumerate(points):
        if not closed and (j == 0 or j == n - 1):
            vi.append([0, 0]); vo.append([0, 0]); continue
        px, py = points[(j - 1) % n]
        nx, ny = points[(j + 1) % n]
        tx, ty = (nx - px) * tension / 2, (ny - py) * tension / 2
        vi.append([-tx, -ty]); vo.append([tx, ty])
    return {"i": vi, "o": vo, "v": [list(p) for p in points], "c": closed}


def poly(points, closed=False):
    return {"i": [[0, 0]] * len(points), "o": [[0, 0]] * len(points), "v": [list(p) for p in points], "c": closed}


def sh(path):
    return {"ty": "sh", "ks": kf(path) if isinstance(path, list) else st(path)}


def el(cx, cy, w, h):
    return {"ty": "el", "p": st([cx, cy]), "s": st([w, h])}


def fill(c):
    return {"ty": "fl", "c": st(c), "o": st(100), "r": 1, "bm": 0}


def stroke(c, w=SW):
    return {"ty": "st", "c": st(c), "o": st(100), "w": st(w), "lc": 2, "lj": 2, "bm": 0}


def tr(p=None, a=None, s=None, r=None, o=None):
    def prop(v, d):
        if v is None:
            return st(d)
        return v if isinstance(v, dict) else st(v)
    return {"ty": "tr", "p": prop(p, [0, 0]), "a": prop(a, [0, 0]), "s": prop(s, [100, 100]),
            "r": prop(r, 0), "o": prop(o, 100), "sk": st(0), "sa": st(0)}


def gr(name, items, fl=None, stc=None, sw=SW, t=None):
    """Группа: фигуры, затем контур (поверх) и заливка, затем трансформ."""
    it = list(items)
    if stc is not None:
        it.append(stroke(stc, sw))
    if fl is not None:
        it.append(fill(fl))
    it.append(t or tr())
    return {"ty": "gr", "nm": name, "it": it}


def stack(name, groups_bottom_first, t=None):
    """Группа из групп; на вход — снизу вверх (в Lottie первым идёт верхний)."""
    return {"ty": "gr", "nm": name, "it": list(reversed(groups_bottom_first)) + [t or tr()]}


def pivot(cx, cy, r=None, s=None, p=None, o=None):
    """Трансформ с центром вращения/масштаба в (cx, cy)."""
    if p is None:
        p = [cx, cy]
    elif isinstance(p, dict):
        pass
    return tr(p=p, a=[cx, cy], r=r, s=s, o=o)


def loop(n, *pairs, ease=EASE):
    """Ключи для зацикленной анимации: pairs — (доля 0..1, значение), первый = последний."""
    return kf([(round(f * n), v) for f, v in pairs], ease)


def doc(name, n, groups_bottom_first):
    layer = {"ddd": 0, "ind": 1, "ty": 4, "nm": name, "sr": 1,
             "ks": {"o": st(100), "r": st(0), "p": st([0, 0, 0]), "a": st([0, 0, 0]), "s": st([100, 100, 100])},
             "ao": 0, "shapes": list(reversed(groups_bottom_first)), "ip": 0, "op": n, "st": 0, "bm": 0}
    return {"v": "5.7.4", "fr": FR, "ip": 0, "op": n, "w": W, "h": H, "nm": name, "ddd": 0, "assets": [], "layers": [layer]}


def mirror(points, cx=100):
    return [(2 * cx - x, y) for x, y in points]


def shift(points, dx=0, dy=0, k=1.0, cx=100, cy=100):
    return [(cx + (x - cx) * k + dx, cy + (y - cy) * k + dy) for x, y in points]


# ---------- ритмы и эффекты ----------
def blink_keys(n, at=0.78, dur=6):
    a = round(at * n)
    return kf([(0, [100, 100]), (a, [100, 100]), (a + dur // 2, [100, 10]), (a + dur, [100, 100]), (n, [100, 100])], LIN)


def breathe(n, amount=1.8):
    return loop(n, (0, [100, 100]), (0.5, [100, 100 + amount]), (1, [100, 100]))


def heart(cx, cy, s=1.0):
    pts = [(0, 3), (-6, -3), (-6, -8), (-3, -10), (0, -7), (3, -10), (6, -8), (6, -3)]
    return sh(smooth([(cx + x * s, cy + y * s) for x, y in pts], tension=0.35))


def rising(name, item_fn, x, y, n, start, dx=6, dy=-40, fl=None, stc=None, sw=SW2):
    f0 = start
    f1 = min(n, start + n // 2)
    o = kf([(0, 0), (f0, 0), (f0 + 3, 100), (f1 - 4, 100), (f1, 0), (n, 0)], LIN)
    p = kf([(0, [x, y]), (f0, [x, y]), (f1, [x + dx, y + dy]), (n, [x + dx, y + dy])], LIN)
    s = kf([(0, [60, 60]), (f0, [60, 60]), (f0 + 6, [100, 100]), (n, [100, 100])], LIN)
    return gr(name, [item_fn()], fl=fl, stc=stc, sw=sw, t=tr(p=p, a=[0, 0], s=s, o=o))


def z_letter(s=1.0):
    return sh(poly([(0, 0), (8 * s, 0), (0, 8 * s), (8 * s, 8 * s)]))


# ---------- запись пака ----------
def write_pack(out, poses, manifest):
    """poses: {ключ: (функция позы, мета)} → <ключ>.json; manifest.json с перечнем поз."""
    os.makedirs(out, exist_ok=True)
    listed = {}
    for key, (fn, meta) in poses.items():
        data = fn()
        name = f"{key}.json"
        with open(os.path.join(out, name), "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        listed[key] = {"file": name, **meta}
    with open(os.path.join(out, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump({**manifest, "poses": listed}, f, ensure_ascii=False, indent=2)
    print("→", out, ", ".join(listed))
