"""Кролик — второй пак питомца WYX (формат 2: пол, украшения, свои «приколы»).

    python design/pets/rabbit/make_rabbit.py  →  sux-chat-app/public/pets/rabbit/

Холст и точка опоры — как у кота: 200×240, лапы на линии y = 200 (верхний край
пузыря). Тот же стиль: белый мех, тёмный контур. Голова смотрит в экран и в
позах сбоку (как у кота при ходьбе).

Чем кролик не кот:
- ходит прыжками (walk — цикл прыжка);
- голодный не царапает, а подгрызает сообщения (scratch — грызёт край пузыря);
- обиженный стучит задней лапой (bury — топот);
- объевшийся и счастливый падает на бок («флоп», belly);
- на тап довольно скрипит зубками (purr, звук synth:chatter);
- свои приколы (manifest.extras): бинки — прыжок с разворотом в воздухе,
  столбик — встал на задние лапы и оглядывается, умывание лапками;
- нос всё время шевелится, левое ухо иногда падает и пружинисто встаёт.

Украшения (слои acc:<id> внутри головы): цветок — девочке, повязка — мальчику.
Ресницы девочки — слой sex:f.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from kit import *  # noqa: E402,F401,F403 — примитивы Lottie, ритмы, эффекты (design/pets/kit.py)

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
OUT = os.path.join(ROOT, "sux-chat-app/public/pets/rabbit")
BASE = 200

# Слоты окраса (как у кота: у каждой детали своя метка, на глаз — те же цвета).
PALETTE = {
    "ink": "#1E1E1E",
    "fur": "#FFFFFF",
    "eye": "#1E1E1F",
    "glint": "#FEFEFE",
    "face": "#1E1F1E",
    "nose": "#F29CB0",
    "ear": "#F7B8C4",     # внутри ушей и румянец
    "teeth": "#FFFDF6",
    "pad": "#F5B1BE",     # подушечки задних лап (вид сзади)
    "petal": "#FF8FB1",   # цветок девочки
    "petal2": "#FFD24A",
    "band": "#3F7DD8",    # повязка мальчика
}
INK, FUR, EYE, GLINT, FACE, NOSE, EAR, TEETH, PAD, PETAL, PETAL2, BAND = (
    rgb(PALETTE[k]) for k in ("ink", "fur", "eye", "glint", "face", "nose", "ear", "teeth", "pad", "petal", "petal2", "band"))
HEART = rgb("#FF5A6E")
CARROT = rgb("#F28C28")
LEAF = rgb("#5DBB63")
CRUMB = rgb("#D9CFC2")
DUST2 = rgb("#7A6C5E")
SPARK = rgb("#FFC83D")
BLANKET = rgb("#A9C2DE")
BLANKET2 = rgb("#86A6CB")
THERMO = rgb("#E5484D")


def soft_fill(c, o):
    """Заливка с прозрачностью (румянец)."""
    return {"ty": "fl", "c": st(c), "o": st(o), "r": 1, "bm": 0}


# ---------- голова (вид спереди) ----------
HEAD = [(64, 96), (68, 78), (82, 66), (100, 63), (118, 66), (132, 78), (136, 96), (128, 112), (114, 120), (100, 122), (86, 120), (72, 112)]
EAR_L = [(83, 72), (78, 48), (79, 22), (87, 12), (95, 20), (97, 46), (96, 70)]
EAR_L_IN = [(86.5, 64), (83.5, 44), (85, 26), (88.5, 21), (92, 29), (93, 47), (92, 64)]


def ear(points, inner, piv, r=None, s=None, name="ear", back=False):
    parts = [gr("ear-fill", [sh(smooth(points, tension=0.32))], fl=FUR, stc=INK)]
    if not back:
        parts.append(gr("ear-in", [sh(smooth(inner, tension=0.32))], fl=EAR))
    return stack(name, parts, t=pivot(*piv, r=r, s=s))


def ears(r_l=None, r_r=None, s_l=None, s_r=None, dy=0, back=False):
    l, li = shift(EAR_L, dy=dy), shift(EAR_L_IN, dy=dy)
    return [ear(l, li, (89, 70 + dy), r_l, s_l, "ear-l", back), ear(mirror(l), mirror(li), (111, 70 + dy), r_r, s_r, "ear-r", back)]


def eyes(kind="open", dy=0, blink=None):
    """open — круглые с бликом, closed — дужки, happy — ^ ^, sad — с бровками, half — щёлочки, cross — сердитые."""
    out = []
    for cx in (86, 114):
        y = 90 + dy
        side = -1 if cx < 100 else 1
        if kind in ("open", "sad", "cross"):
            pupil = stack("eye", [
                gr("pupil", [el(cx, y, 11, 13)], fl=EYE),
                gr("glint", [el(cx - 2, y - 3, 3.6, 3.6)], fl=GLINT),
            ], t=pivot(cx, y, s=blink))
            out.append(pupil)
            if kind == "sad":
                out.append(gr("brow", [sh(poly([(cx - 7 * side, y - 12), (cx + 4 * side, y - 9)]))], stc=FACE, sw=SW2))
            if kind == "cross":
                out.append(gr("brow", [sh(poly([(cx - 7 * side, y - 9), (cx + 5 * side, y - 13)]))], stc=FACE, sw=SW2))
        elif kind == "closed":
            out.append(gr("eye", [sh(smooth([(cx - 6, y), (cx, y + 4), (cx + 6, y)], closed=False, tension=0.6))], stc=EYE, sw=SW2))
        elif kind == "happy":
            out.append(gr("eye", [sh(smooth([(cx - 6, y + 3), (cx, y - 3), (cx + 6, y + 3)], closed=False, tension=0.6))], stc=EYE, sw=SW2))
        elif kind == "half":
            out.append(gr("eye", [sh(poly([(cx - 6, y + 1), (cx + 6, y + 1)]))], stc=EYE, sw=SW2))
            out.append(gr("lid", [sh(smooth([(cx - 6, y + 1), (cx, y + 4), (cx + 6, y + 1)], closed=False, tension=0.6))], stc=EYE, sw=SW2))
        # Ресницы девочки у внешнего уголка (слой sex:f).
        ox, oy = cx + 6 * side, y + (0 if kind in ("closed", "half") else -3)
        out.append(gr("sex:f", [sh(poly([(ox, oy), (ox + 4 * side, oy - 3.5)])), sh(poly([(ox - 1.5 * side, oy - 2.8), (ox + 1.5 * side, oy - 7)]))], stc=EYE, sw=2.0))
    return out


def nose_twitch(n, at=(0.2, 0.55), fast=False):
    """Нос шевелится: короткие серии подёргиваний (у кролика — всегда)."""
    keys = [(0, [100, 100])]
    for a in at:
        f = round(a * n)
        step = 2 if fast else 3
        for i, v in enumerate(([112, 86], [92, 108], [110, 90], [100, 100])):
            keys.append((min(n - 1, f + step * (i + 1)), v))
    keys.append((n, [100, 100]))
    keys = sorted(dict(keys).items())
    return kf(keys, LIN)


def face(kind="open", dy=0, blink=None, mouth="w", twitch=None, teeth=True):
    g = eyes(kind, dy, blink)
    g.append(gr("nose", [sh(smooth([(96, 99 + dy), (104, 99 + dy), (100, 103.5 + dy)], tension=0.3))], fl=NOSE, stc=NOSE, sw=1.5,
                t=pivot(100, 101 + dy, s=twitch)))
    if teeth:
        g.append(gr("teeth", [sh(poly([(97.2, 107.5 + dy), (99.6, 107.5 + dy), (99.6, 112.5 + dy), (97.2, 112.5 + dy)], closed=True)),
                              sh(poly([(100.4, 107.5 + dy), (102.8, 107.5 + dy), (102.8, 112.5 + dy), (100.4, 112.5 + dy)], closed=True))],
                    fl=TEETH, stc=INK, sw=1.4))
    if mouth == "w":
        g.append(gr("mouth", [sh(poly([(100, 103.5 + dy), (100, 106.5 + dy)])),
                              sh(smooth([(93.5, 106 + dy), (97, 108.5 + dy), (100, 106.5 + dy), (103, 108.5 + dy), (106.5, 106 + dy)], closed=False, tension=0.5))],
                    stc=FACE, sw=SW2 - 0.8))
    elif mouth == "flat":
        g.append(gr("mouth", [sh(poly([(100, 103.5 + dy), (100, 106 + dy)])), sh(poly([(94, 107 + dy), (106, 107 + dy)]))], stc=FACE, sw=SW2 - 0.8))
    elif mouth == "sad":
        g.append(gr("mouth", [sh(poly([(100, 103.5 + dy), (100, 106 + dy)])),
                              sh(smooth([(94.5, 109 + dy), (100, 106 + dy), (105.5, 109 + dy)], closed=False, tension=0.6))], stc=FACE, sw=SW2 - 0.8))
    for side in (-1, 1):
        for a, b in (((80, 102), (61, 99)), ((80, 105.5), (62, 109))):
            g.append(gr("whisker", [sh(poly([(100 + (a[0] - 100) * side, a[1] + dy), (100 + (b[0] - 100) * side, b[1] + dy)]))], stc=FACE, sw=2.0))
    g.append({"ty": "gr", "nm": "blush", "it": [el(76, 104 + dy, 10, 6), el(124, 104 + dy, 10, 6), soft_fill(EAR, 55), tr()]})
    return g


def flower(cx, cy):
    """Цветок девочке (acc:flower): пять лепестков и серединка."""
    petals = [el(cx + 5.2 * math.cos(a), cy + 5.2 * math.sin(a), 7.5, 7.5) for a in (math.radians(-90 + 72 * i) for i in range(5))]
    return stack("acc:flower", [
        gr("petals", petals, fl=PETAL, stc=INK, sw=1.6),
        gr("center", [el(cx, cy, 5.5, 5.5)], fl=PETAL2, stc=INK, sw=1.4),
    ], t=pivot(cx, cy, r=st(12)))


def headband(dy=0, flutter=None):
    """Повязка мальчику (acc:headband): поперёк лба под ушами, хвостики завязки слева."""
    band = [(67, 86 + dy), (76, 75 + dy), (100, 70 + dy), (124, 75 + dy), (133, 86 + dy)]
    tails = stack("tails", [
        gr("tail1", [sh(smooth([(68, 85 + dy), (56, 86 + dy), (52, 94 + dy), (60, 92 + dy)], tension=0.3))], fl=BAND, stc=INK, sw=1.8),
        gr("tail2", [sh(smooth([(68, 87 + dy), (59, 96 + dy), (58, 104 + dy), (64, 97 + dy)], tension=0.3))], fl=BAND, stc=INK, sw=1.8),
    ], t=pivot(68, 86 + dy, r=flutter))
    return stack("acc:headband", [
        tails,
        gr("band-out", [sh(smooth(band, closed=False, tension=0.5))], stc=INK, sw=9),
        gr("band", [sh(smooth(band, closed=False, tension=0.5))], stc=BAND, sw=5.6),
        gr("knot", [el(68, 86 + dy, 7, 7)], fl=BAND, stc=INK, sw=1.6),
    ])


def head(kind="open", dy=0, blink=None, mouth="w", t=None, ears_r=(None, None), ears_s=(None, None), n=90, twitch=None,
         teeth=True, flutter=None):
    parts = ears(ears_r[0], ears_r[1], ears_s[0], ears_s[1], dy=dy)
    parts.append(gr("head", [sh(smooth(shift(HEAD, dy=dy)))], fl=FUR, stc=INK))
    parts += face(kind, dy, blink, mouth, twitch, teeth)
    parts.append(headband(dy, flutter))
    parts.append(flower(121, 70 + dy))
    return stack("head", parts, t=t)


def paw(cx, cy, w=15, h=10, t=None):
    return stack("paw", [
        gr("paw", [el(cx, cy, w, h)], fl=FUR, stc=INK),
        gr("toes", [sh(poly([(cx - 2.5, cy + 0.5), (cx - 2.5, cy + 4)])), sh(poly([(cx + 2.5, cy + 0.5), (cx + 2.5, cy + 4)]))], stc=INK, sw=1.6),
    ], t=t)


def foot(cx, cy, w=30, h=11, t=None):
    """Большая задняя лапа (вид спереди — смотрит вперёд)."""
    return stack("foot", [
        gr("foot", [el(cx, cy, w, h)], fl=FUR, stc=INK),
        gr("toes", [sh(poly([(cx - 4, cy + 0.5), (cx - 4, cy + 4.5)])), sh(poly([(cx + 4, cy + 0.5), (cx + 4, cy + 4.5)]))], stc=INK, sw=1.6),
    ], t=t)


def pompom(cx, cy, r=10, t=None):
    """Хвостик-помпон: пушистый круг с парой штрихов шерсти."""
    return stack("tail", [
        # Круг с лёгкой волной по краю — пушистый, но не многоугольник.
        gr("tail", [sh(smooth([(cx + r * math.cos(a) * (1 + 0.045 * math.cos(5 * a)), cy + r * math.sin(a) * (1 + 0.045 * math.cos(5 * a)))
                               for a in (math.radians(360 / 20 * j) for j in range(20))], tension=0.45))], fl=FUR, stc=INK, sw=4),
        gr("fluff", [sh(poly([(cx - 3, cy - 2), (cx - 1, cy + 1)])), sh(poly([(cx + 2, cy - 3), (cx + 3, cy)]))], stc=INK, sw=1.6),
    ], t=t)


BODY_SIT = [(78, 126), (66, 146), (60, 172), (66, 192), (100, 201), (134, 192), (140, 172), (134, 146), (122, 126)]


def sit_parts(n, kind="open", mouth="w", head_t=None, ears_r=(None, None), ears_s=(None, None), paws=None, twitch=None,
              extra_top=(), teeth=True, feet=True, body_t=None):
    blink = blink_keys(n) if kind in ("open", "sad", "cross") else None
    twitch = twitch if twitch is not None else nose_twitch(n)
    parts = [pompom(141, 186)]
    parts.append(stack("body", [gr("body", [sh(smooth(BODY_SIT))], fl=FUR, stc=INK)], t=body_t or pivot(100, BASE, s=breathe(n, 2.0))))
    if feet:
        parts += [foot(73, 198), foot(127, 198)]
    parts += paws if paws is not None else [paw(89, 191), paw(111, 191)]
    parts.append(head(kind, blink=blink, mouth=mouth, ears_r=ears_r, ears_s=ears_s, n=n, twitch=twitch, teeth=teeth,
                      t=head_t or pivot(100, 118, s=breathe(n, 1.0))))
    parts += list(extra_top)
    return parts


# ---------- позы спереди ----------
def pose_sit():
    n = 120
    flop = kf([(0, 0), (50, 0), (54, -64), (78, -64), (83, 9), (87, -5), (91, 0), (n, 0)], EASE)
    return doc("rabbit-sit", n, sit_parts(n, ears_r=(flop, None), twitch=nose_twitch(n, (0.12, 0.38, 0.8))))


def pose_purr():
    """Тап: доволен — зубки мелко скрипят (дрожь), глаза-дуги, уши торчком, сердечки."""
    n = 54
    jitter = kf([(f, [0, (0.6 if f % 4 == 0 else -0.6) if f not in (0, n) else 0]) for f in range(0, n + 1, 2)], LIN)
    perk = loop(n, (0, [100, 100]), (0.15, [100, 106]), (0.85, [100, 106]), (1, [100, 100]))
    bunny = stack("bunny", sit_parts(n, kind="happy", ears_s=(perk, perk), twitch=nose_twitch(n, (0.1, 0.35, 0.6), fast=True)), t=tr(p=jitter))
    hearts = [
        rising("heart1", lambda: heart(0, 0, 1.0), 140, 60, n, 4, fl=HEART),
        rising("heart2", lambda: heart(0, 0, 0.8), 62, 56, n, 20, dx=-6, fl=HEART),
        rising("heart3", lambda: heart(0, 0, 0.65), 124, 40, n, 30, dx=8, dy=-30, fl=HEART),
    ]
    return doc("rabbit-purr", n, [bunny, *hearts])


def pose_eat():
    """Покормили: держит морковку лапками и хрумкает, крошки падают."""
    n = 40
    bite = loop(n, (0, [0, 0]), (0.25, [0, -3]), (0.5, [0, 0]), (0.75, [0, -3]), (1, [0, 0]))
    carrot = stack("carrot", [
        gr("leaves", [sh(smooth([(112, 100), (118, 86), (121, 99)], tension=0.3)), sh(smooth([(113, 101), (126, 92), (122, 104)], tension=0.3))], fl=LEAF, stc=INK, sw=1.8),
        gr("carrot", [sh(smooth([(108, 100), (116, 106), (92, 128), (89, 125)], tension=0.15))], fl=CARROT, stc=INK, sw=2.4),
        gr("lines", [sh(poly([(104, 110), (108, 112)])), sh(poly([(99, 116), (102, 118)]))], stc=INK, sw=1.4),
    ], t=tr(p=bite))
    paws = [paw(95, 119, t=tr(p=bite)), paw(108, 112, t=tr(p=bite))]
    crumbs = [rising(f"crumb{i}", lambda: el(0, 0, 4, 3.5), 100 + dx0, 112, n, f, dx=dx, dy=46, fl=CARROT, stc=INK, sw=1)
              for i, (dx0, f, dx) in enumerate([(-4, 6, -10), (3, 16, 8), (-1, 26, -4)])]
    parts = sit_parts(n, kind="happy", paws=[], twitch=nose_twitch(n, (0.2, 0.7), fast=True))
    return doc("rabbit-eat", n, parts + [carrot, *paws, *crumbs])


def pose_sad():
    """Грустит: уши повисли в стороны, бровки домиком, голова чуть ниже."""
    n = 90
    sway_l = loop(n, (0, -64), (0.5, -58), (1, -64))
    sway_r = loop(n, (0, 64), (0.5, 58), (1, 64))
    return doc("rabbit-sad", n, sit_parts(n, kind="sad", mouth="sad", ears_r=(sway_l, sway_r), teeth=False,
                                          head_t=tr(p=[100, 121], a=[100, 118], s=breathe(n, 0.6))))


def pose_thump():
    """Обиделся (bury): сердито стучит задней лапой — пыль, толчок, черточки удара."""
    n = 30
    hits = (9, 21)
    lift = kf([(0, [0, 0]), (4, [2, -9]), (8, [2, -9]), (9, [0, 0]), (16, [2, -9]), (20, [2, -9]), (21, [0, 0]), (n, [0, 0])], EASE)
    jolt = kf([(0, [0, 0]), (9, [0, 0]), (10, [0, 1.8]), (13, [0, 0]), (21, [0, 0]), (22, [0, 1.8]), (25, [0, 0]), (n, [0, 0])], LIN)
    jig = kf([(0, 0), (9, 0), (11, -7), (14, 3), (17, 0), (21, 0), (23, 7), (26, -3), (n, 0)], EASE)
    parts = [pompom(141, 186),
             stack("body", [gr("body", [sh(smooth(BODY_SIT))], fl=FUR, stc=INK)]),
             foot(73, 198), foot(127, 198, t=tr(p=lift)),
             paw(89, 191), paw(111, 191),
             head("cross", mouth="flat", teeth=False, ears_r=(jig, jig), n=n, t=pivot(100, 118))]
    bunny = stack("bunny", parts, t=tr(p=jolt))
    dust = []
    for i, (f, dx, dy, d) in enumerate([(9, 18, -12, 9), (9, 26, -4, 7), (21, 20, -14, 10), (21, 28, -5, 7)]):
        dust.append(rising(f"dust{i}", lambda d=d: el(0, 0, d, d), 138, 198, n, f, dx=dx, dy=dy, fl=CRUMB, stc=INK, sw=1.2))
    marks = []
    for i, f in enumerate(hits):
        o = kf([(0, 0), (f, 0), (f + 1, 100), (f + 5, 100), (f + 7, 0), (n, 0)], LIN)
        marks.append(gr(f"hit{i}", [sh(poly([(146, 186), (152, 182)])), sh(poly([(148, 192), (156, 191)])), sh(poly([(146, 198), (152, 201)]))],
                        stc=INK, sw=2.2, t=tr(o=o)))
    return doc("rabbit-thump", n, [bunny, *dust, *marks])


def pose_gnaw():
    """Голоден (scratch): наклонился к краю пузыря и подгрызает его — голова у края, крошки летят вниз."""
    n = 36
    chew = kf([(f, [100, 186 + (1.8 if (f // 3) % 2 else 0)]) for f in range(0, n, 3)] + [(n, [100, 186])], LIN)
    body = gr("body", [sh(smooth([(58, 178), (62, 150), (80, 136), (120, 136), (138, 150), (142, 178), (136, 196), (100, 200), (64, 196)]))], fl=FUR, stc=INK)
    hd = head("open", mouth="w", ears_r=(st(-14), st(14)), n=n, twitch=nose_twitch(n, (0.1, 0.5), fast=True),
              t=tr(p=chew, a=[100, 118], s=[94, 94]))
    crumbs = [rising(f"crumb{i}", lambda d=d: el(0, 0, d, d * 0.85), 100 + dx0, 198, n, f, dx=dx, dy=34, fl=CRUMB, stc=INK, sw=1)
              for i, (dx0, f, dx, d) in enumerate([(-3, 2, -14, 4.5), (4, 9, 12, 4), (0, 16, -6, 5), (-6, 23, -18, 3.5), (5, 29, 10, 4.5)])]
    return doc("rabbit-gnaw", n, [pompom(144, 184), body, paw(70, 197), paw(130, 197), hd, *crumbs])


# ---------- вид сбоку (прыжки, бинки) ----------
SIDE_BODY = [(60, 166), (66, 146), (86, 134), (112, 134), (132, 144), (142, 162), (134, 182), (104, 190), (74, 188)]
HAUNCH = [(64, 168), (72, 152), (92, 156), (100, 174), (94, 190), (70, 192)]


def side_bunny(n, haunch_rot, fore_rot, body_t, head_rot=None, kind="open", tail_s=None, flutter=None):
    """Тело и лапы сбоку, голова — спереди (смотрит в экран)."""
    def fore(x, rot, name):
        return stack(name, [
            gr("leg-out", [sh(poly([(x, 178), (x + 2, 191)]))], stc=INK, sw=15),
            gr("leg-fur", [sh(poly([(x, 178), (x + 2, 191)]))], stc=FUR, sw=7),
            paw(x + 4, 196, w=15, h=9),
        ], t=pivot(x, 178, r=rot))
    haunch = stack("haunch", [
        gr("haunch", [sh(smooth(HAUNCH, tension=0.35))], fl=FUR, stc=INK),
        foot(76, 197, w=34, h=10),
    ], t=pivot(84, 170, r=haunch_rot))
    blink = blink_keys(n, 0.6) if kind == "open" else None
    hd = head(kind, blink=blink, n=n, twitch=nose_twitch(n, (0.3,), fast=True), flutter=flutter,
              t=tr(p=[136, 144], a=[100, 118], s=[80, 80], r=head_rot))
    return stack("bunny", [
        fore(118, fore_rot, "fore-back"),
        pompom(58, 152, t=pivot(58, 152, s=tail_s)),
        gr("body", [sh(smooth(SIDE_BODY))], fl=FUR, stc=INK),
        haunch,
        fore(128, fore_rot, "fore-front"),
        hd,
    ], t=body_t)


def pose_hop():
    """Прыжок (walk): присел — толкнулся — в воздухе лапы назад — приземлился на передние."""
    n = 24
    body_t = tr(p=kf([(0, [100, 166]), (5, [100, 160]), (10, [100, 150]), (15, [100, 156]), (19, [100, 167]), (n, [100, 166])], EASE),
                a=[100, 166], r=kf([(0, 0), (5, -8), (11, -2), (16, 7), (20, 1), (n, 0)], EASE),
                s=kf([(0, [100, 100]), (4, [104, 95]), (8, [97, 104]), (18, [100, 100]), (20, [104, 95]), (n, [100, 100])], EASE))
    haunch = kf([(0, 0), (5, 18), (10, 42), (15, 26), (19, 4), (n, 0)], EASE)
    fore = kf([(0, 0), (6, 10), (11, -34), (16, -20), (19, 0), (n, 0)], EASE)
    flutter = loop(n, (0, 0), (0.45, 22), (0.75, -6), (1, 0))
    return doc("rabbit-hop", n, [side_bunny(n, haunch, fore, body_t, flutter=flutter, tail_s=loop(n, (0, [100, 100]), (0.45, [112, 112]), (1, [100, 100])))])


def pose_binky():
    """Бинки (прикол счастья): присел — подпрыгнул высоко — разворот в воздухе — пинок лапами — приземлился."""
    n = 40
    body_t = tr(p=kf([(0, [100, 166]), (7, [100, 170]), (16, [100, 124]), (22, [100, 130]), (27, [100, 167]), (31, [100, 168]), (n, [100, 166])], EASE),
                a=[100, 166],
                r=kf([(0, 0), (8, -4), (13, -18), (19, 22), (25, 4), (n, 0)], EASE),
                s=kf([(0, [100, 100]), (7, [106, 92]), (11, [96, 106]), (14, [-100, 100]), (18, [100, 100]), (27, [100, 100]), (29, [108, 92]), (33, [100, 100]), (n, [100, 100])], EASE))
    haunch = kf([(0, 0), (8, 12), (14, 58), (19, 64), (24, 10), (n, 0)], EASE)
    fore = kf([(0, 0), (9, -24), (16, -40), (24, -10), (28, 0), (n, 0)], EASE)
    bunny = side_bunny(n, haunch, fore, body_t, kind="happy", flutter=loop(n, (0, 0), (0.4, 30), (0.6, -14), (1, 0)))
    sparks = [rising(f"spark{i}", lambda s=s: sh(poly([(0, -s), (s * 0.3, -s * 0.3), (s, 0), (s * 0.3, s * 0.3), (0, s), (-s * 0.3, s * 0.3), (-s, 0), (-s * 0.3, -s * 0.3)], closed=True)),
                     x, 86, n, 14, dx=dx, dy=-18, fl=SPARK, stc=INK, sw=1.2)
              for i, (x, dx, s) in enumerate([(66, -10, 6), (136, 10, 7), (100, 0, 5)])]
    return doc("rabbit-binky", n, [bunny, *sparks])


# ---------- лёжа ----------
LOAF = [(54, 186), (62, 164), (84, 150), (116, 150), (138, 164), (146, 186), (132, 200), (100, 203), (68, 200)]


def loaf_parts(n, kind="open", ears_r=(st(-48), st(48)), ears_s=(st([100, 82]), st([100, 82])), dy=44, breath=2.4):
    blink = blink_keys(n, 0.3) if kind == "open" else None
    return [
        pompom(146, 182),
        stack("body", [gr("body", [sh(smooth(LOAF))], fl=FUR, stc=INK)], t=pivot(100, BASE, s=breathe(n, breath))),
        paw(86, 202, w=14, h=8), paw(114, 202, w=14, h=8),
        head(kind, dy=dy, blink=blink, n=n, ears_r=ears_r, ears_s=ears_s, twitch=nose_twitch(n, (0.5,)), teeth=kind != "closed",
             t=pivot(100, 160, s=breathe(n, 0.8))),
    ]


def pose_lie():
    """Лежит «буханкой»: лапы под собой, уши назад."""
    n = 90
    return doc("rabbit-lie", n, loaf_parts(n))


def pose_sleep():
    """Спит: буханка, уши совсем легли, глаза закрыты, Z."""
    n = 120
    parts = loaf_parts(n, kind="closed", ears_r=(st(-78), st(78)), ears_s=(st([100, 76]), st([100, 76])), breath=3.0)
    zs = [rising(f"z{i}", lambda i=i: z_letter(1.0 - i * 0.15), 116 + i * 4, 136, n, 6 + i * 26, dx=18, dy=-34, stc=INK, sw=2.4) for i in range(3)]
    return doc("rabbit-sleep", n, parts + zs)


def pose_flop():
    """Флоп (belly): от счастья упал на бок — тело вытянуто, задние лапы в сторону, блаженно спит."""
    n = 60
    body = [(84, 188), (92, 166), (118, 158), (150, 162), (170, 176), (166, 196), (130, 204), (92, 202)]
    hd = head("closed", n=n, teeth=False, ears_r=(st(-14), st(10)), ears_s=(st([100, 78]), st([100, 78])), twitch=nose_twitch(n, (0.5,)),
              t=tr(p=[96, 186], a=[100, 118], s=[84, 84], r=st(-80)))
    parts = [
        pompom(156, 158),
        stack("body", [gr("body", [sh(smooth(body))], fl=FUR, stc=INK)], t=pivot(128, BASE, s=breathe(n, 2.6))),
        foot(174, 184, w=28, h=10, t=pivot(174, 184, r=loop(n, (0, -18), (0.5, -12), (1, -18)))),
        foot(178, 196, w=28, h=10, t=pivot(178, 196, r=st(-8))),
        paw(118, 205, w=14, h=8), paw(138, 205, w=14, h=8),
        hd,
    ]
    zs = [rising(f"z{i}", lambda i=i: z_letter(0.9 - i * 0.15), 70 + i * 4, 124, n, 4 + i * 18, dx=-12, dy=-30, stc=INK, sw=2.2) for i in range(2)]
    return doc("rabbit-flop", n, parts + zs)


def pose_sick():
    """Приболел: под пледом, уши повисли поверх, градусник."""
    n = 120
    parts = loaf_parts(n, kind="half", ears_r=(st(-70), st(70)), ears_s=(st([100, 80]), st([100, 80])))
    blanket = stack("blanket", [
        gr("blanket", [sh(smooth([(30, 174), (66, 166), (100, 164), (136, 166), (170, 174), (176, 214), (150, 222), (100, 220), (50, 222), (24, 214)], tension=0.25))], fl=BLANKET, stc=INK, sw=4),
        gr("stripes", [sh(poly([(36, 188), (164, 188)])), sh(poly([(32, 200), (168, 200)]))], stc=BLANKET2, sw=4),
    ], t=pivot(100, 200, s=breathe(n, 2.2)))
    thermo = stack("thermo", [
        gr("tube", [sh(poly([(106, 150), (138, 158)]))], stc=INK, sw=7),
        gr("tube-in", [sh(poly([(106, 150), (138, 158)]))], stc=FUR, sw=3),
        gr("bulb", [el(140, 158.5, 7, 7)], fl=THERMO, stc=INK, sw=1.8),
    ], t=pivot(106, 150, r=loop(n, (0, -7), (0.5, 6), (1, -7))))
    no_paws = [p for p in parts if p["nm"] != "paw"]
    return doc("rabbit-sick", n, no_paws[:-1] + [blanket, no_paws[-1], thermo])


def pose_sulk():
    """Дуется (sulk): сидит спиной — круглая спина, помпон, подушечки лап; хвостик дёргается, иногда топот."""
    n = 36
    twitch = kf([(0, [100, 100]), (6, [118, 112]), (9, [96, 98]), (14, [114, 110]), (18, [100, 100]), (n, [100, 100])], EASE)
    flick = kf([(0, 0), (20, 0), (22, 10), (26, -4), (29, 0), (n, 0)], EASE)
    lift = kf([(0, [0, 0]), (15, [0, 0]), (18, [0, -8]), (20, [0, -8]), (21, [0, 0]), (n, [0, 0])], EASE)
    back_head = stack("head", [
        *ears(flick, None, dy=0, back=True),
        gr("head", [sh(smooth(HEAD))], fl=FUR, stc=INK),
        gr("fur", [sh(poly([(95, 70), (97, 77)])), sh(poly([(101, 68), (101, 76)])), sh(poly([(106, 70), (104, 77)]))], stc=INK, sw=2.2),
        flower(79, 70),  # с затылка цветок — на другой стороне
        stack("acc:headband", [
            gr("band-out", [sh(smooth([(67, 86), (76, 75), (100, 70), (124, 75), (133, 86)], closed=False, tension=0.5))], stc=INK, sw=9),
            gr("band", [sh(smooth([(67, 86), (76, 75), (100, 70), (124, 75), (133, 86)], closed=False, tension=0.5))], stc=BAND, sw=5.6),
            gr("knot", [el(132, 86, 7, 7)], fl=BAND, stc=INK, sw=1.6),
        ]),
    ])
    sole = lambda cx, t=None: stack("sole", [gr("sole", [el(cx, 198, 22, 11)], fl=FUR, stc=INK), gr("pads", [el(cx, 199, 9, 5), el(cx - 6, 195, 4, 3.5), el(cx + 6, 195, 4, 3.5)], fl=PAD)], t=t)  # noqa: E731
    parts = [
        stack("body", [gr("body", [sh(smooth(BODY_SIT))], fl=FUR, stc=INK)], t=pivot(100, BASE, s=breathe(n, 1.4))),
        back_head,
        sole(80, tr(p=lift)), sole(120),
        pompom(100, 178, r=12, t=pivot(100, 178, s=twitch)),
    ]
    dust = [rising(f"dust{i}", lambda d=d: el(0, 0, d, d), 70, 199, n, 21, dx=dx, dy=-8, fl=CRUMB, stc=INK, sw=1.2) for i, (dx, d) in enumerate([(-14, 8), (-8, 6)])]
    return doc("rabbit-sulk", n, parts + dust)


# ---------- приколы ----------
def pose_periscope():
    """Столбик: встал на задние лапы, лапки у груди, оглядывается влево-вправо."""
    n = 72
    up = kf([(0, [100, 88]), (10, [100, 100]), (60, [100, 100]), (n, [100, 88])], EASE)
    body = [(80, 112), (70, 136), (68, 164), (74, 188), (100, 199), (126, 188), (132, 164), (130, 136), (120, 112)]
    look = kf([(0, [0, 0]), (14, [0, 0]), (20, [-5, -1]), (34, [-5, -1]), (40, [5, -1]), (54, [5, -1]), (60, [0, 0]), (n, [0, 0])], EASE)
    head_t = tr(p=kf([(0, [100, 120]), (10, [100, 104]), (60, [100, 104]), (n, [100, 120])], EASE), a=[100, 118])
    turn = stack("turn", [head("open", blink=blink_keys(n, 0.42), n=n, twitch=nose_twitch(n, (0.3, 0.7), fast=True),
                               ears_s=(st([100, 106]), st([100, 106])))], t=tr(p=look))
    parts = [
        pompom(140, 186),
        stack("body", [gr("body", [sh(smooth(body))], fl=FUR, stc=INK)], t=pivot(100, BASE, s=up)),
        foot(73, 198), foot(127, 198),
        stack("head-up", [turn], t=head_t),
        paw(92, 130, t=tr(p=kf([(0, [0, 50]), (10, [0, 0]), (60, [0, 0]), (n, [0, 50])], EASE))),
        paw(108, 130, t=tr(p=kf([(0, [0, 50]), (10, [0, 0]), (60, [0, 0]), (n, [0, 50])], EASE))),
    ]
    return doc("rabbit-periscope", n, parts)


def pose_groom():
    """Умывается: лапки по очереди трут мордочку, глаза закрыты, уши прижаты."""
    n = 60
    rub_l = loop(n, (0, [0, 0]), (0.25, [0, -9]), (0.5, [0, 0]), (0.75, [0, -9]), (1, [0, 0]))
    rub_r = loop(n, (0, [0, -9]), (0.25, [0, 0]), (0.5, [0, -9]), (0.75, [0, 0]), (1, [0, -9]))
    paws = [paw(84, 108, t=tr(p=rub_l)), paw(116, 108, t=tr(p=rub_r))]
    parts = sit_parts(n, kind="closed", paws=[], ears_r=(st(-12), st(12)), twitch=nose_twitch(n, (0.4,)))
    return doc("rabbit-groom", n, parts + paws)


POSES = {
    "sit": (pose_sit, {"loop": True}),
    "purr": (pose_purr, {"loop": True, "sound": "tap"}),
    "walk": (pose_hop, {"loop": True, "speed": 40, "facing": "right"}),
    "lie": (pose_lie, {"loop": True}),
    "sleep": (pose_sleep, {"loop": True}),
    "belly": (pose_flop, {"loop": True}),
    "scratch": (pose_gnaw, {"loop": True}),
    "bury": (pose_thump, {"loop": True}),
    "eat": (pose_eat, {"loop": True}),
    "sad": (pose_sad, {"loop": True}),
    "sick": (pose_sick, {"loop": True}),
    "sulk": (pose_sulk, {"loop": True}),
    "binky": (pose_binky, {"loop": True, "facing": "right"}),
    "periscope": (pose_periscope, {"loop": True}),
    "groom": (pose_groom, {"loop": True}),
}

MANIFEST = {
    "format": 2,
    "species": "rabbit",
    "rev": 1,
    "name": {"ru": "Кролик", "en": "Rabbit", "ko": "토끼"},
    "defaultName": {"ru": "Мистер Кролик", "en": "Mister Bunny", "ko": "미스터 토끼"},
    "defaultNameBySex": {"f": {"ru": "Мисс Зайка", "en": "Miss Bunny", "ko": "미스 토끼"}},
    "canvas": [W, H],
    "anchor": [100, BASE],
    "scale": 0.3,
    "author": "WYX",
    "sexes": ["m", "f"],
    "accessories": {
        "headband": {"name": {"ru": "Повязка", "en": "Headband", "ko": "머리띠"}, "slot": "head", "sex": ["m"], "default": True},
        "flower": {"name": {"ru": "Цветок", "en": "Flower", "ko": "꽃"}, "slot": "head", "sex": ["f"], "default": True},
    },
    "texts": {"tap": {"ru": "{name} довольно скрипит зубками — +1 к вайбу", "en": "{name} is happily grinding its teeth — +1 vibe",
                      "ko": "{name}이(가) 기분 좋게 이를 갈아요 — 바이브 +1"}},
    "sounds": {"tap": "synth:chatter"},
    # Приколы кролика к общему характеру (ChatPets BEHAVIOUR): поза, секунды, на чьих пузырях, вес.
    "extras": {
        "happy": [{"pose": "binky", "min": 2, "max": 3, "target": "owner", "w": 2}, {"pose": "groom", "min": 4, "max": 6, "target": "owner", "w": 1}],
        "content": [{"pose": "groom", "min": 4, "max": 7, "target": "any", "w": 2}, {"pose": "periscope", "min": 3, "max": 5, "target": "any", "w": 1}],
        "bored": [{"pose": "periscope", "min": 3, "max": 6, "target": "any", "w": 3}],
    },
    "palette": PALETTE,
    "defaultCoat": "white",
    "coats": {
        "white": {"name": {"ru": "Белый", "en": "White", "ko": "흰색"}, "colors": {}},
        "grey": {"name": {"ru": "Серый", "en": "Grey", "ko": "회색"}, "colors": {"fur": "#BFC4CC", "ear": "#E9AEB9", "nose": "#C98896"}},
        "brown": {"name": {"ru": "Шоколадный", "en": "Chocolate", "ko": "초코"},
                  "colors": {"fur": "#C9A27C", "ink": "#3A2717", "eye": "#2A1A10", "face": "#3A2717", "ear": "#E9A99A", "nose": "#B86F62"}},
        "black": {"name": {"ru": "Чёрный", "en": "Black", "ko": "검은색"},
                  "colors": {"fur": "#3A3A42", "ink": "#121216", "eye": "#D9A441", "glint": "#FFFFFF", "face": "#C9C9D2", "ear": "#8A6472", "nose": "#D98AA0", "teeth": "#F3EFE6", "pad": "#8A6472"}},
        "cream": {"name": {"ru": "Кремовый", "en": "Cream", "ko": "크림"}, "colors": {"fur": "#F4E4C6", "ink": "#2E2318", "ear": "#F2B7A8", "nose": "#C9887A"}},
    },
}


def main():
    write_pack(OUT, POSES, MANIFEST)


if __name__ == "__main__":
    main()
