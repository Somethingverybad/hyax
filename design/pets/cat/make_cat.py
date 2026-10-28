"""Мистер Кот — пак питомца WYX: позы Lottie по концепту из design/pets/cat/concept-*.png.

    python design/pets/cat/make_cat.py  →  sux-chat-app/public/pets/cat/

Пак — по формату design/pets/README.md: manifest.json + по файлу Lottie на позу.
Холст 200×240, точка опоры (где кот касается верхнего края пузыря) — [100, 200]:
всё, что ниже 200, свешивается через край пузыря (лапы, хвост, одеяло).

Стиль концепта: белый кот, тёмный «живой» контур, чёрная бабочка под
подбородком и чёрный кончик хвоста. Кот собирается из одних и тех же частей
(голова, тело, уши, хвост), меняются только их положение и движение.
Все позы зациклены (первый кадр = последнему), 30 к/с.
"""
import json
import math
import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
OUT = os.path.join(ROOT, "sux-chat-app/public/pets/cat")
W, H, FR = 200, 240, 30
BASE = 200  # линия верхнего края пузыря


def rgb(h, a=1.0):
    h = h.lstrip("#")
    return [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)] + [a]


INK = rgb("#1E1E1E")
FUR = rgb("#FFFFFF")
PINK = rgb("#F3B9B4")
DUST = rgb("#B9B1A7")
DUST2 = rgb("#7A6C5E")
HEART = rgb("#FF5A6E")
BOWL = rgb("#E9776B")
KIBBLE = rgb("#B9855A")
BLANKET = rgb("#A9C2DE")
BLANKET2 = rgb("#86A6CB")
THERMO = rgb("#E5484D")
SW = 5.0      # контур
SW2 = 3.2     # детали лица
EASE = {"i": {"x": [0.42], "y": [1]}, "o": {"x": [0.58], "y": [0]}}
LIN = {"i": {"x": [1], "y": [1]}, "o": {"x": [0], "y": [0]}}


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


# ---------- части кота (вид спереди) ----------
HEAD = [(64, 86), (68, 66), (84, 56), (100, 54), (116, 56), (132, 66), (136, 86), (129, 103), (115, 112), (100, 114), (85, 112), (71, 103)]
EAR_L = [(68, 74), (71, 31), (95, 57)]
EAR_L_IN = [(75, 62), (75, 42), (88, 57)]
BODY_SIT = [(80, 110), (70, 130), (62, 166), (68, 192), (100, 201), (132, 192), (138, 166), (130, 130), (120, 110)]


def ear(points, inner, piv, r=None, name="ear"):
    return stack(name, [
        gr("ear-fill", [sh(smooth(points, tension=0.18))], fl=FUR, stc=INK),
        gr("ear-in", [sh(poly(inner))], stc=PINK, sw=SW2),
    ], t=pivot(*piv, r=r))


def ears(r_l=None, r_r=None, dy=0):
    l = shift(EAR_L, dy=dy); li = shift(EAR_L_IN, dy=dy)
    return [ear(l, li, (80, 66 + dy), r_l, "ear-l"), ear(mirror(l), mirror(li), (120, 66 + dy), r_r, "ear-r")]


def eyes(kind="open", dy=0, blink=None, n=90):
    """open — точки с бликом, closed — дужки сна, happy — ^ ^, sad — капли с бровками, half — щёлочки."""
    out = []
    for cx in (87, 113):
        y = 86 + dy
        if kind == "open" or kind == "sad":
            g = stack("eye", [
                gr("pupil", [el(cx, y, 9, 11)], fl=INK),
                gr("glint", [el(cx - 1.8, y - 2.4, 3, 3)], fl=FUR),
            ], t=pivot(cx, y, s=blink))
            out.append(g)
            if kind == "sad":
                side = -1 if cx < 100 else 1
                out.append(gr("brow", [sh(poly([(cx - 6 * side, y - 11), (cx + 4 * side, y - 8)]))], stc=INK, sw=SW2))
        elif kind == "closed":
            out.append(gr("eye", [sh(smooth([(cx - 6, y), (cx, y + 4), (cx + 6, y)], closed=False, tension=0.6))], stc=INK, sw=SW2))
        elif kind == "happy":
            out.append(gr("eye", [sh(smooth([(cx - 6, y + 3), (cx, y - 3), (cx + 6, y + 3)], closed=False, tension=0.6))], stc=INK, sw=SW2))
        elif kind == "half":
            out.append(gr("eye", [sh(poly([(cx - 6, y + 1), (cx + 6, y + 1)]))], stc=INK, sw=SW2))
            out.append(gr("lid", [sh(smooth([(cx - 6, y + 1), (cx, y + 4), (cx + 6, y + 1)], closed=False, tension=0.6))], stc=INK, sw=SW2))
    return out


def face(eye_kind="open", dy=0, blink=None, mouth="w"):
    g = eyes(eye_kind, dy, blink)
    g.append(gr("nose", [sh(smooth([(96, 96 + dy), (104, 96 + dy), (100, 100.5 + dy)], tension=0.25))], fl=INK, stc=INK, sw=1.5))
    if mouth == "w":
        g.append(gr("mouth", [sh(smooth([(93.5, 103 + dy), (97, 106 + dy), (100, 102 + dy), (103, 106 + dy), (106.5, 103 + dy)], closed=False, tension=0.5))], stc=INK, sw=SW2 - 0.6))
    elif mouth == "sad":
        g.append(gr("mouth", [sh(smooth([(95, 106 + dy), (100, 103 + dy), (105, 106 + dy)], closed=False, tension=0.6))], stc=INK, sw=SW2 - 0.6))
    for side in (-1, 1):
        for a, b in (((81, 97), (60, 93)), ((81, 100.5), (58, 101)), ((81, 104), (61, 109))):
            p0 = (100 + (a[0] - 100) * side, a[1] + dy)
            p1 = (100 + (b[0] - 100) * side, b[1] + dy)
            g.append(gr("whisker", [sh(poly([p0, p1]))], stc=INK, sw=2.2))
    return g


def head(eye_kind="open", dy=0, blink=None, mouth="w", t=None, ears_r=(None, None)):
    parts = ears(*ears_r, dy=dy)
    parts.append(gr("head", [sh(smooth(shift(HEAD, dy=dy)))], fl=FUR, stc=INK))
    parts += face(eye_kind, dy, blink, mouth)
    return stack("head", parts, t=t)


def bow(cx=100, cy=117, t=None):
    return stack("bow", [
        gr("wing-l", [sh(smooth([(cx, cy), (cx - 15, cy - 8), (cx - 16, cy + 8)], tension=0.2))], fl=INK, stc=INK, sw=2),
        gr("wing-r", [sh(smooth([(cx, cy), (cx + 15, cy - 8), (cx + 16, cy + 8)], tension=0.2))], fl=INK, stc=INK, sw=2),
        gr("knot", [el(cx, cy, 8, 8)], fl=INK),
    ], t=t)


def tail(points, rot=None, piv=None, tip_from=0.62, w=15):
    """Хвост — трубка: тёмная толстая линия, белая потоньше поверх, чёрный кончик."""
    n = len(points)
    k = max(1, int(round((n - 1) * tip_from)))
    tip = points[k:]
    piv = piv or points[0]
    return stack("tail", [
        gr("tail-out", [sh(smooth(points, closed=False, tension=0.55))], stc=INK, sw=w),
        gr("tail-fur", [sh(smooth(points, closed=False, tension=0.55))], stc=FUR, sw=w - 2 * SW + 1.6),
        gr("tail-tip", [sh(smooth(tip, closed=False, tension=0.55))], stc=INK, sw=w),
    ], t=pivot(*piv, r=rot))


def paw(cx, cy, w=19, h=11, t=None):
    return stack("paw", [
        gr("paw", [el(cx, cy, w, h)], fl=FUR, stc=INK),
        gr("toes", [sh(poly([(cx - 2.5, cy + 1), (cx - 2.5, cy + 4.5)])), sh(poly([(cx + 2.5, cy + 1), (cx + 2.5, cy + 4.5)]))], stc=INK, sw=1.8),
    ], t=t)


def blink_keys(n, at=0.78, dur=6):
    a = round(at * n)
    return kf([(0, [100, 100]), (a, [100, 100]), (a + dur // 2, [100, 10]), (a + dur, [100, 100]), (n, [100, 100])], LIN)


def breathe(n, amount=1.8):
    return loop(n, (0, [100, 100]), (0.5, [100, 100 + amount]), (1, [100, 100]))


def sit_parts(n, eye_kind="open", tail_pts=None, tail_rot=None, ears_r=(None, None), mouth="w", head_t=None, paws=None, extra_top=()):
    tail_pts = tail_pts or [(130, 188), (155, 188), (168, 170), (166, 146), (156, 130)]
    blink = blink_keys(n) if eye_kind in ("open", "sad") else None
    body = stack("body", [
        gr("body", [sh(smooth(BODY_SIT))], fl=FUR, stc=INK),
        bow(),
    ], t=pivot(100, BASE, s=breathe(n)))
    paws = paws if paws is not None else [paw(88, 196), paw(112, 196)]
    return [tail(tail_pts, rot=tail_rot), body, *paws,
            head(eye_kind, blink=blink, mouth=mouth, ears_r=ears_r, t=head_t or pivot(100, 112, s=breathe(n, 1.0))),
            *extra_top]


# ---------- позы ----------
def pose_sit():
    n = 90
    rot = loop(n, (0, 0), (0.3, 14), (0.6, -8), (1, 0))
    ear_tw = kf([(0, 0), (40, 0), (43, -14), (47, 0), (n, 0)], LIN)
    tilt = loop(n, (0, 0), (0.4, 4), (0.75, -2), (1, 0))
    return doc("cat-sit", n, sit_parts(n, tail_rot=rot, ears_r=(None, ear_tw), head_t=pivot(100, 112, r=tilt, s=breathe(n, 1.2))))


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


def pose_purr():
    n = 60
    jitter = kf([(f, [0, (0.7 if f % 4 == 0 else -0.7) if f not in (0, n) else 0]) for f in range(0, n + 1, 2)], LIN)
    cat = stack("cat", sit_parts(n, eye_kind="happy", tail_rot=loop(n, (0, 0), (0.5, 6), (1, 0))), t=tr(p=jitter))
    hearts = [
        rising("heart1", lambda: heart(0, 0, 1.1), 136, 70, n, 4, fl=HEART),
        rising("heart2", lambda: heart(0, 0, 0.8), 66, 64, n, 30, dx=-6, fl=HEART),
        rising("heart3", lambda: heart(0, 0, 0.65), 120, 50, n, 18, dx=10, dy=-34, fl=HEART),
    ]
    return doc("cat-purr", n, [cat, *hearts])


def pose_eat():
    """Ест: голова опущена к самой миске, тело за ней — видны только плечи, лапы и хвост."""
    n = 40
    chew = loop(n, (0, [100, 196]), (0.25, [100, 199]), (0.5, [100, 196]), (0.75, [100, 199]), (1, [100, 196]))
    body = gr("body", [sh(smooth([(56, 178), (60, 152), (80, 138), (120, 138), (140, 152), (144, 178), (138, 195), (100, 199), (62, 195)]))],
              fl=FUR, stc=INK)
    tail_g = tail([(128, 186), (152, 182), (166, 162), (166, 136), (158, 118)], rot=loop(n, (0, -4), (0.5, 6), (1, -4)))
    paws = [paw(66, 197), paw(134, 197)]
    head_g = head("closed", ears_r=(loop(n, (0, 0), (0.5, -6), (1, 0)), None),
                  t=tr(p=chew, a=[100, 112], s=[92, 92]))
    bowl = stack("bowl", [
        gr("kibble", [el(91, 186, 7, 6), el(100, 184, 7, 6), el(109, 186, 7, 6)], fl=KIBBLE, stc=INK, sw=1.5),
        gr("bowl", [sh(smooth([(74, 187), (126, 187), (120, 204), (80, 204)], tension=0.12))], fl=BOWL, stc=INK, sw=4),
    ])
    return doc("cat-eat", n, [tail_g, body, *paws, head_g, bowl])


def pose_sad():
    n = 120
    sigh = loop(n, (0, [0, 0]), (0.5, [0, 5]), (1, [0, 0]))
    tail_flat = [(130, 194), (152, 199), (170, 198), (182, 194)]
    parts = sit_parts(n, eye_kind="sad", tail_pts=tail_flat, ears_r=(st(-28), st(28)), mouth="sad", head_t=tr(p=sigh))
    return doc("cat-sad", n, parts)


def pose_scratch():
    """Царапает: передние лапы по очереди поднимаются и с нажимом тянутся вниз —
    нога от груди к лапе (лапа не отрывается от тела), следы когтей — прямо под лапой."""
    n = 40

    def forelimb(x, ph):
        lift = 18
        ys = [(0, 0), (4 + ph, -lift), (9 + ph, 0), (14 + ph, -lift), (19 + ph, 0), (24 + ph, -lift), (29 + ph, 0), (n, 0)]
        leg_k = [(t, poly([(x, 150), (x, 192 + dy)])) for t, dy in ys]
        paw_k = kf([(t, [0, dy]) for t, dy in ys], EASE)
        return stack("forelimb", [
            gr("leg-out", [sh(leg_k)], stc=INK, sw=15),
            gr("leg-fur", [sh(leg_k)], stc=FUR, sw=6.6),
            paw(x, 196, t=tr(p=paw_k)),
        ])
    marks = []
    for side, x0, ph in ((-1, 88, 0), (1, 112, 5)):
        for i in range(3):
            x = x0 - 5 + i * 5
            f = 9 + ph + i * 2
            o = kf([(0, 0), (f, 0), (f + 2, 100), (34, 100), (n, 0)], LIN)
            marks.append(gr("mark", [sh(poly([(x - 1.5, 201), (x + 1.5, 213)]))], stc=INK, sw=2.4, t=tr(o=o)))
    parts = sit_parts(n, eye_kind="open", tail_rot=loop(n, (0, 0), (0.5, 12), (1, 0)), paws=[forelimb(88, 0), forelimb(112, 5)])
    return doc("cat-scratch", n, marks + parts)


# ---------- вид сбоку (идёт, закапывает) ----------
SIDE_BODY = [(66, 150), (76, 128), (104, 120), (132, 126), (148, 144), (144, 166), (120, 176), (90, 176), (70, 168)]
SIDE_HEAD = [(122, 110), (126, 88), (146, 76), (166, 80), (180, 96), (180, 118), (166, 130), (140, 132)]
SIDE_EAR_B = [(128, 92), (127, 60), (146, 80)]
SIDE_EAR_F = [(150, 78), (165, 50), (176, 88)]


def side_cat(n, legs_rot, tail_rot, bob, head_rot=None, eye="open", crouch=0):
    """Тело и лапы сбоку, а голова — та же, что спереди: идёт и смотрит в экран.

    crouch — на сколько градусов кот припал грудью (закапывает): тело и хвост
    наклоняются вокруг задних лап, голова опускается, передние лапы подогнуты.
    """
    def leg(x, top, rot, name):
        return stack(name, [
            gr("leg-out", [sh(poly([(x, top), (x, 192)]))], stc=INK, sw=17),
            gr("leg-fur", [sh(poly([(x, top), (x, 192)]))], stc=FUR, sw=8.4),
            paw(x + 2, 196, w=18, h=11),
        ], t=pivot(x, top, r=rot))

    def tucked(x, top, name):
        # Подогнутая, как у сфинкса: плечо под грудью, локоть у самого пузыря,
        # предплечье лежит вперёд — лапа выглядывает из-под груди.
        pts = [(x, top), (x - 6, 192), (x + 16, 194)]
        return stack(name, [
            gr("leg-out", [sh(poly(pts))], stc=INK, sw=17),
            gr("leg-fur", [sh(poly(pts))], stc=FUR, sw=8.4),
            paw(x + 21, 196, w=20, h=10),
        ])

    drop = round(crouch * 0.6)  # присел: всё тело ниже, задние лапы короче
    lean = (lambda g: stack(g["nm"] + "-lean", [g], t=pivot(84, 176, p=[84, 176 + drop], r=st(crouch)))) if crouch else (lambda g: g)
    lf, lb, hf, hb = legs_rot
    blink = blink_keys(n, 0.6) if eye == "open" else None
    hx, hy = (146, 143) if crouch else (150, 132)  # шея: у присевшего ниже и ближе
    head_g = stack("head-wrap", [
        bow(hx, hy + 5, t=pivot(hx, hy + 5, s=st([74, 74]))),
        head(eye, blink=blink, t=tr(p=[hx, hy], a=[100, 112], s=[80, 80], r=head_rot)),
    ])
    if crouch:
        fore_b, fore_f = tucked(118, 178, "fore-back"), tucked(132, 180, "fore-front")
    else:
        fore_b, fore_f = leg(126, 160, lb, "fore-back"), leg(136, 162, lf, "fore-front")
    body = stack("cat", [
        leg(80, 160 + drop, hb, "hind-back"), fore_b,
        lean(tail([(70, 150), (54, 138), (46, 116), (52, 96), (63, 86)], rot=tail_rot)),
        lean(gr("body", [sh(smooth(SIDE_BODY))], fl=FUR, stc=INK)),
        leg(90, 162 + drop, hf, "hind-front"), fore_f,
        head_g,
    ], t=tr(p=bob))
    return body


def pose_walk():
    n = 20
    a = 22
    sw_ = lambda ph: loop(n, (0, a * ph), (0.5, -a * ph), (1, a * ph))
    bob = loop(n, (0, [0, 0]), (0.25, [0, -2.5]), (0.5, [0, 0]), (0.75, [0, -2.5]), (1, [0, 0]))
    cat = side_cat(n, (sw_(1), sw_(-1), sw_(-1), sw_(1)), loop(n, (0, -4), (0.5, 4), (1, -4)), bob)
    return doc("cat-walk", n, [cat])


def pose_bury():
    n = 24
    # Задние лапы бьют назад (к хвосту, туда же летит пыль), а не вперёд под живот.
    kick = lambda ph: kf([(0, 0), (4 + ph, 46), (9 + ph, -6), (14 + ph, 46), (19 + ph, -6), (n, 0)], EASE)
    still = st(0)
    cat = side_cat(n, (still, still, kick(0), kick(3)), loop(n, (0, -8), (0.5, 8), (1, -8)), st([0, 0]), head_rot=st(-4), crouch=10)
    dust = []
    # Земля летит из-под задних лап назад — начинается за лапой, чтобы не слипаться с ней.
    for i, (x0, y0, dx, dy, f, d) in enumerate([(56, 194, -36, -30, 5, 13), (52, 197, -44, -12, 6, 11), (58, 193, -28, -40, 15, 12),
                                                (50, 196, -42, -22, 16, 14), (54, 196, -32, -6, 17, 10)]):
        dust.append(rising(f"dust{i}", lambda d=d: el(0, 0, d, d), x0, y0, n, f, dx=dx, dy=dy, fl=DUST2, stc=INK, sw=1.2))
    return doc("cat-bury", n, [cat, *dust])


# ---------- лёжа ----------
BODY_LIE = [(38, 188), (46, 168), (70, 156), (100, 152), (130, 156), (154, 168), (162, 188), (140, 201), (100, 203), (60, 201)]


def lie_parts(n, eye_kind="open", tail_hang=True):
    blink = blink_keys(n, 0.3) if eye_kind == "open" else None
    t_rot = loop(n, (0, 0), (0.35, 14), (0.7, -4), (1, 0))
    parts = []
    if tail_hang:
        parts.append(tail([(150, 190), (166, 198), (172, 214), (168, 232)], rot=t_rot))
    parts.append(stack("body", [gr("body", [sh(smooth(BODY_LIE))], fl=FUR, stc=INK)], t=pivot(100, BASE, s=breathe(n, 2.2))))
    parts += [paw(82, 204), paw(118, 204)]
    parts.append(head(eye_kind, dy=46, blink=blink, t=pivot(100, 158, s=breathe(n, 0.8))))
    return parts


def pose_lie():
    n = 90
    return doc("cat-lie", n, lie_parts(n))


def z_letter(s=1.0):
    return sh(poly([(0, 0), (8 * s, 0), (0, 8 * s), (8 * s, 8 * s)]))


def pose_sleep():
    n = 120
    body = [(56, 176), (66, 152), (96, 140), (128, 144), (150, 164), (150, 188), (128, 202), (96, 204), (66, 196)]
    t_pts = [(146, 184), (146, 200), (124, 208), (96, 208), (74, 202)]
    head_g = head("closed", dy=58, t=pivot(100, 180, s=st([82, 82]), p=[78, 176]))
    parts = [
        stack("body", [gr("body", [sh(smooth(body))], fl=FUR, stc=INK)], t=pivot(100, BASE, s=breathe(n, 3.0))),
        head_g,
        tail(t_pts, tip_from=0.7),
    ]
    zs = [rising(f"z{i}", lambda i=i: z_letter(1.0 - i * 0.15), 112 + i * 4, 140, n, 6 + i * 26, dx=18, dy=-34, stc=INK, sw=2.4) for i in range(3)]
    return doc("cat-sleep", n, parts + zs)


CREAM = rgb("#F6EEE4")


def pose_belly():
    """Кверху пузом: лежит на спине, короткие лапки с подушечками вверх, голова у края тела."""
    n = 60
    body = [(56, 180), (72, 160), (104, 152), (138, 158), (156, 178), (146, 198), (108, 204), (70, 200)]
    wig = lambda ph: loop(n, (0, -9 * ph), (0.5, 9 * ph), (1, -9 * ph))

    def leg_up(x, top, lean, ph):
        bend = [(x, 166), (x + lean * 0.6, (166 + top) / 2), (x + lean, top)]
        return stack("leg", [
            gr("leg-out", [sh(smooth(bend, closed=False, tension=0.6))], stc=INK, sw=16),
            gr("leg-fur", [sh(smooth(bend, closed=False, tension=0.6))], stc=FUR, sw=7.4),
            gr("pad", [el(x + lean, top - 3, 17, 14)], fl=FUR, stc=INK),
            gr("beans", [el(x + lean, top - 1, 7, 5), el(x + lean - 5, top - 6, 3.6, 3.6), el(x + lean, top - 8, 3.6, 3.6), el(x + lean + 5, top - 6, 3.6, 3.6)], fl=PINK),
        ], t=pivot(x, 166, r=wig(ph)))
    parts = [
        tail([(152, 186), (166, 198), (170, 216), (165, 232)], rot=loop(n, (0, 0), (0.5, 8), (1, 0))),
        leg_up(84, 140, -5, 1), leg_up(130, 140, 5, -1),
        stack("body", [gr("body", [sh(smooth(body))], fl=FUR, stc=INK),
                       gr("belly", [sh(smooth([(84, 176), (106, 166), (132, 174), (128, 190), (106, 194), (86, 190)]))], fl=CREAM)],
              t=pivot(104, BASE, s=breathe(n, 2.4))),
        leg_up(100, 141, -3, -1), leg_up(116, 141, 3, 1),
        head("happy", dy=56, t=pivot(100, 170, r=loop(n, (0, -16), (0.5, -10), (1, -16)), s=st([88, 88]), p=[50, 168])),
    ]
    return doc("cat-belly", n, parts)


def pose_sick():
    n = 120
    parts = lie_parts(n, eye_kind="half", tail_hang=False)
    blanket = stack("blanket", [
        gr("blanket", [sh(smooth([(30, 174), (66, 166), (100, 164), (136, 166), (170, 174), (176, 214), (150, 222), (100, 220), (50, 222), (24, 214)], tension=0.25))], fl=BLANKET, stc=INK, sw=4),
        gr("stripes", [sh(poly([(36, 188), (164, 188)])), sh(poly([(32, 200), (168, 200)]))], stc=BLANKET2, sw=4),
        gr("fold", [sh(smooth([(34, 208), (70, 214), (100, 210), (132, 214), (166, 208)], closed=False, tension=0.6))], stc=INK, sw=2.4),
    ], t=pivot(100, 200, s=breathe(n, 2.2)))
    thermo = stack("thermo", [
        gr("tube", [sh(poly([(106, 152), (138, 160)]))], stc=INK, sw=7),
        gr("tube-in", [sh(poly([(106, 152), (138, 160)]))], stc=FUR, sw=3),
        gr("bulb", [el(140, 160.5, 7, 7)], fl=THERMO, stc=INK, sw=1.8),
    ], t=pivot(106, 152, r=loop(n, (0, -7), (0.5, 6), (1, -7))))
    # голова над одеялом, градусник поверх морды
    body_and_head = [p for p in parts if p["nm"] not in ("paw",)]
    return doc("cat-sick", n, body_and_head[:-1] + [blanket, body_and_head[-1], thermo])


def pose_sulk():
    """Обиделся: сидит спиной, хвост раздражённо дёргается."""
    n = 36
    flick = kf([(0, 0), (6, 20), (10, -6), (16, 18), (22, -4), (n, 0)], EASE)
    body = stack("body", [gr("body", [sh(smooth(BODY_SIT))], fl=FUR, stc=INK)], t=pivot(100, BASE, s=breathe(n, 1.4)))
    back_head = stack("head", [
        *ears(),
        gr("head", [sh(smooth(HEAD))], fl=FUR, stc=INK),
        gr("fur", [sh(poly([(94, 62), (96, 70)])), sh(poly([(100, 60), (100, 69)])), sh(poly([(106, 62), (104, 70)]))], stc=INK, sw=2.4),
    ])
    parts = [body, back_head, paw(84, 198, w=16, h=8), paw(116, 198, w=16, h=8),
             tail([(104, 196), (120, 204), (148, 202), (164, 188), (166, 170)], rot=flick, piv=(104, 196))]
    return doc("cat-sulk", n, parts)


POSES = {
    "sit": (pose_sit, {"loop": True}),
    "purr": (pose_purr, {"loop": True, "sound": "purr"}),
    "walk": (pose_walk, {"loop": True, "speed": 34, "facing": "right"}),
    "lie": (pose_lie, {"loop": True}),
    "sleep": (pose_sleep, {"loop": True}),
    "belly": (pose_belly, {"loop": True}),
    "scratch": (pose_scratch, {"loop": True}),
    "bury": (pose_bury, {"loop": True, "facing": "right"}),
    "eat": (pose_eat, {"loop": True}),
    "sad": (pose_sad, {"loop": True}),
    "sick": (pose_sick, {"loop": True}),
    "sulk": (pose_sulk, {"loop": True}),
}

MANIFEST = {
    "format": 1,
    "species": "cat",
    "rev": 2,
    "name": {"ru": "Кот", "en": "Cat", "ko": "고양이"},
    "defaultName": {"ru": "Мистер Кот", "en": "Mister Cat", "ko": "미스터 고양이"},
    "canvas": [W, H],
    "anchor": [100, BASE],
    "scale": 0.3,
    "author": "WYX",
    "sounds": {"purr": "synth:purr"},
}


def main():
    os.makedirs(OUT, exist_ok=True)
    poses = {}
    for key, (fn, meta) in POSES.items():
        data = fn()
        name = f"{key}.json"
        with open(os.path.join(OUT, name), "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        poses[key] = {"file": name, **meta}
    manifest = {**MANIFEST, "poses": poses}
    with open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print("→", OUT, ", ".join(poses))


if __name__ == "__main__":
    main()
