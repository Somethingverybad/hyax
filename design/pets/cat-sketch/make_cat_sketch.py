"""Кот по эскизу — пак, собранный по гайду Студии из листа design/pets/image copy 2.png.

    python3 design/pets/cat-sketch/make_cat_sketch.py <папка>

Это копия генератора Мистера Кота (design/pets/cat/make_cat.py) с деталями,
перерисованными по меркам листа: 1 px эскиза = 0,47 единицы холста, нос — в
x = 100, лапы — на линии пузыря y = 200; позу целиком ужимаем до 95 % вокруг
опоры, чтобы толстый хвост слева не вышел за холст.

Что взято с листа: широкая голова без шеи, переходит в тело-«грушу» (книзу
почти в полторы головы); уши — простые треугольники без внутренней стороны;
глаза — сплошные чёрные овалы без бликов; нос — чёрный щиток; рот — два
отдельных штриха; по 3 уса; зигзаги шерсти «M» на висках; бабочка — два
ромба со штрихами складок и чёрный узелок-ромбик; лапы — толстые «столбики»
с двумя пальцами и запятыми шерсти; хвост — толстая трубка слева, загнута
крюком, чёрный кончик. Со спины хвост торчит вверх по центру.

Где отступили от листа — по правилам гайда:
- мех залит белым (на листе заливки нет — в чате кот пропал бы на тёмном пузыре);
- линия 3,6 вместо ~2 (на листе 2,5 % ширины головы — в чате это полпикселя);
- при ходьбе голова смотрит в экран (так решили для всех питомцев), а не в профиль.
Прикол с листа — «прижался к стеклу» (вид снизу с подушечками лап): поза glass.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import kit  # noqa: E402
from kit import *  # noqa: E402,F401,F403

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
OUT = os.path.join(ROOT, "design/pets/cat-sketch/pack")
BASE = 200
LINE = 3.6   # контур: тоньше, чем у Мистера Кота (5), как на листе, но виден в чате
FIT = 93     # ужать позу вокруг опоры, чтобы дуга хвоста слева влезла в холст


def gr(name, items, fl=None, stc=None, sw=LINE, t=None):
    return kit.gr(name, items, fl=fl, stc=stc, sw=sw, t=t)


PALETTE = {
    "ink": "#1E1E1E",    # контур
    "fur": "#FFFFFF",    # мех
    "eye": "#1E1E1F",    # глаза — сплошные овалы
    "face": "#1E1F1E",   # рот, усы, зигзаги на висках
    "nose": "#1F1E1E",
    "tip": "#1E1F1F",    # кончик хвоста
    "bow": "#1F1E1F",    # бабочка: контур и узелок
    "ribbon": "#FF6F91", # бантик на голову (девочке)
}
INK, FUR, EYE, FACE, NOSE, TIP, BOW, RIBBON = (rgb(PALETTE[k]) for k in ("ink", "fur", "eye", "face", "nose", "tip", "bow", "ribbon"))
PAD = rgb("#1E1E1E")  # подушечки на стекле — чёрные, как на листе (вне палитры: не перекрашиваются)
HEART = rgb("#FF5A6E")
BOWL = rgb("#E9776B")
KIBBLE = rgb("#B9855A")
DUST2 = rgb("#7A6C5E")
BLANKET = rgb("#A9C2DE")
BLANKET2 = rgb("#86A6CB")
THERMO = rgb("#E5484D")


def fit(parts):
    """Поза целиком — 95 % вокруг опоры (100, 200)."""
    return [stack("fit", parts, t=pivot(100, BASE, s=st([FIT, FIT])))]


# ---------- силуэт и голова ----------
# Замеры листа (1 px = 0,47 ед., нос — x = 100): уши стоят на макушке — внешнее основание
# (62, 76), кончик (65, 50,5), внутреннее (84,5, 63); между ушами макушка y ≈ 61. Ниже ушей
# голова и тело — один силуэт-«колокол» без шеи и подбородка: на висках полуширина ≈ 40–47,
# у пузыря ≈ 69 (x 31…169).
EAR_L = [(62, 76), (65, 50.5), (84.5, 63)]
# По замерам вида сзади: бока от висков до середины почти отвесные, в нижней половине округло расходятся.
BELL = [(62, 76), (55, 85), (51, 96), (49.5, 110), (47.5, 124), (43, 140), (37, 158), (31, 176), (29, 190), (34, 197.5), (58, 200), (100, 200.5),
        (142, 200), (166, 197.5), (171, 190), (169, 176), (163, 158), (157, 140), (152.5, 124), (150.5, 110), (149, 96), (145, 85), (138, 76), (128, 66),
        (115.5, 62.5), (100, 61), (84.5, 62.5), (72, 66)]
# Голова отдельно — для поз, где она не стоит на теле (лёжа, сбоку, у миски): та же макушка и щёки, снизу подбородок.
HEAD = [(52.5, 96), (56, 86), (62, 76), (72, 66), (84.5, 62.5), (100, 61), (115.5, 62.5), (128, 66), (138, 76), (144, 86),
        (147.5, 96), (145, 106), (134, 113), (100, 116), (66, 113), (55, 106)]


def sharp(name, paths, c, w):
    """Обводка с острыми углами (зигзаг шерсти): у gr() стыки скруглённые."""
    return {"ty": "gr", "nm": name, "it": [*paths, {"ty": "st", "c": st(c), "o": st(100), "w": st(w), "lc": 2, "lj": 1, "ml": 4, "bm": 0}, tr()]}


def ears(r_l=None, r_r=None, dy=0):
    l = shift(EAR_L, dy=dy)
    def ear(points, piv, r, name):
        return stack(name, [gr("ear", [sh(smooth(points, tension=0.12))], fl=FUR, stc=INK)], t=pivot(*piv, r=r))
    return [ear(l, (73, 70 + dy), r_l, "ear-l"), ear(mirror(l), (127, 70 + dy), r_r, "ear-r")]


def temple_marks(dy=0):
    """Зигзаги шерсти «M» прямо на краю силуэта у висков, по 4 зубца наружу — и спереди, и сзади."""
    z = [(58, 83 + dy), (52, 86 + dy), (56.3, 89.4 + dy), (50.3, 92.4 + dy), (54.6, 95.8 + dy), (49, 98.8 + dy)]
    return sharp("marks", [sh(poly(z)), sh(poly(mirror(z)))], FACE, 2.6)


def eyes(kind="open", dy=0, blink=None):
    """open — сплошные чёрные овалы (как на листе), closed — дужки, happy — ^ ^, sad — с бровками, half — щёлочки."""
    out = []
    for cx in (84, 116):
        y = 86.3 + dy
        side = -1 if cx < 100 else 1
        if kind in ("open", "sad"):
            out.append(gr("eye", [el(cx, y, 6.4, 8.6)], fl=EYE, t=pivot(cx, y, s=blink)))
            if kind == "sad":
                out.append(gr("brow", [sh(poly([(cx - 6 * side, y - 9), (cx + 3 * side, y - 7)]))], stc=FACE, sw=2.4))
        elif kind == "closed":
            out.append(gr("eye", [sh(smooth([(cx - 4.5, y), (cx, y + 3), (cx + 4.5, y)], closed=False, tension=0.6))], stc=EYE, sw=2.6))
        elif kind == "happy":
            out.append(gr("eye", [sh(smooth([(cx - 4.5, y + 2), (cx, y - 2.5), (cx + 4.5, y + 2)], closed=False, tension=0.6))], stc=EYE, sw=2.6))
        elif kind == "half":
            out.append(gr("eye", [sh(poly([(cx - 4.5, y + 1), (cx + 4.5, y + 1)]))], stc=EYE, sw=2.6))
            out.append(gr("lid", [sh(smooth([(cx - 4.5, y + 1), (cx, y + 3.5), (cx + 4.5, y + 1)], closed=False, tension=0.6))], stc=EYE, sw=2.6))
        ox, oy = cx + 3.6 * side, y + (0 if kind in ("closed", "half") else -3)
        out.append(gr("sex:f", [sh(poly([(ox, oy), (ox + 3.5 * side, oy - 3)])), sh(poly([(ox - 1.2 * side, oy - 2.4), (ox + 1.2 * side, oy - 6)]))], stc=EYE, sw=1.8))
    return out


def face(kind="open", dy=0, blink=None, mouth="w", t=None):
    """Лицо: глаза, нос-щиток, рот из двух штрихов, по 3 уса до зигзагов на висках."""
    g = eyes(kind, dy, blink)
    g.append(gr("nose", [sh(smooth([(95.8, 91.6 + dy), (104.2, 91.6 + dy), (100, 97.2 + dy)], tension=0.28))], fl=NOSE, stc=NOSE, sw=1.4))
    if mouth == "w":
        g.append(gr("mouth", [sh(smooth([(99.2, 97.8 + dy), (97.2, 100.8 + dy), (93.6, 100.2 + dy)], closed=False, tension=0.5)),
                              sh(smooth([(100.8, 97.8 + dy), (102.8, 100.8 + dy), (106.4, 100.2 + dy)], closed=False, tension=0.5))], stc=FACE, sw=2.2))
    elif mouth == "sad":
        g.append(gr("mouth", [sh(smooth([(95, 102 + dy), (100, 99.5 + dy), (105, 102 + dy)], closed=False, tension=0.6))], stc=FACE, sw=2.2))
    for side in (-1, 1):
        for a, b in (((79, 95.5), (66, 94)), ((79, 98.5), (65.5, 98.5)), ((79, 101.5), (66, 103))):
            g.append(gr("whisker", [sh(poly([(100 + (a[0] - 100) * side, a[1] + dy), (100 + (b[0] - 100) * side, b[1] + dy)]))], stc=FACE, sw=1.8))
    return stack("face", g, t=t)


def ribbon(cx, cy, rot=14):
    """Бантик на голову девочке (acc:bow_head)."""
    return stack("acc:bow_head", [
        gr("loop-l", [sh(smooth([(cx, cy), (cx - 10, cy - 6), (cx - 11, cy + 5)], tension=0.25))], fl=RIBBON, stc=INK, sw=2.4),
        gr("loop-r", [sh(smooth([(cx, cy), (cx + 10, cy - 6), (cx + 11, cy + 5)], tension=0.25))], fl=RIBBON, stc=INK, sw=2.4),
        gr("knot", [el(cx, cy, 6, 6)], fl=RIBBON, stc=INK, sw=2),
    ], t=pivot(cx, cy, r=st(rot)))


def head(kind="open", dy=0, blink=None, mouth="w", t=None, ears_r=(None, None), chin=True):
    """Голова отдельно (лёжа, сбоку, у миски): уши, макушка и щёки как у силуэта, снизу подбородок."""
    parts = ears(*ears_r, dy=dy)
    parts.append(gr("head", [sh(smooth(shift(HEAD, dy=dy)))], fl=FUR, stc=INK))
    parts.append(temple_marks(dy))
    parts.append(face(kind, dy, blink, mouth))
    parts.append(ribbon(122, 70 + dy))
    return stack("head", parts, t=t)


def bow(cx=100, cy=123, t=None):
    """Бабочка (acc:bow_tie): два ромба-крыла, в каждом по два коротких штриха-складки у узла; узелок — контуром."""
    wing = [(cx - 4, cy), (cx - 12, cy - 8.5), (cx - 17, cy), (cx - 12, cy + 8.5)]
    fold = [(cx - 6, cy - 2.6), (cx - 9.5, cy - 2.6)], [(cx - 6, cy + 2.6), (cx - 9.5, cy + 2.6)]
    return stack("acc:bow_tie", [
        gr("wing-l", [sh(poly(wing, closed=True))], fl=FUR, stc=BOW, sw=2.6),
        gr("wing-r", [sh(poly(mirror(wing, cx), closed=True))], fl=FUR, stc=BOW, sw=2.6),
        gr("folds", [sh(poly(f)) for f in fold] + [sh(poly(mirror(f, cx))) for f in fold], stc=BOW, sw=1.4),
        gr("knot", [sh(smooth([(cx, cy - 5), (cx + 4, cy), (cx, cy + 5), (cx - 4, cy)], tension=0.2))], fl=FUR, stc=BOW, sw=2.2),
    ], t=t)


def catmull(points, steps=3):
    """Точки → плотная гладкая линия (Catmull-Rom) — по ней строим сужающийся хвост."""
    P = [points[0], *points, points[-1]]
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for k in range(steps):
            t = k / steps
            out.append(tuple(0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t * t
                                    + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t ** 3) for j in (0, 1)))
    out.append(points[-1])
    return out


def tail(points, rot=None, piv=None, tip_from=0.75, w=19):
    """Хвост — как на листе: толстый у основания, сужается к кончику (заливка, а не линия одной
    толщины), конец круглый, чёрный только кончик — около четверти длины."""
    c = catmull(points)
    n = len(c)
    left, right = [], []
    for i, (x, y) in enumerate(c):
        ax, ay = c[max(0, i - 1)]
        bx, by = c[min(n - 1, i + 1)]
        dx, dy = bx - ax, by - ay
        ln = math.hypot(dx, dy) or 1
        nx, ny = -dy / ln, dx / ln
        half = (w + (w * 0.55 - w) * i / (n - 1)) / 2
        left.append((x + nx * half, y + ny * half))
        right.append((x - nx * half, y - ny * half))
    # Круглый конец: полукруг вокруг последней точки.
    ex, ey = c[-1]
    tx, ty = ex - c[-2][0], ey - c[-2][1]
    base = math.atan2(ty, tx)
    r_end = w * 0.55 / 2
    cap = [(ex + r_end * math.cos(base + math.radians(a)), ey + r_end * math.sin(base + math.radians(a))) for a in (60, 30, 0, -30, -60)]
    outline = [*left, *cap, *right[::-1]]
    k = int(n * tip_from)
    tip = [*left[k:], *cap, *right[k:][::-1]]
    return stack("tail", [
        gr("tail", [sh(smooth(outline, tension=0.25))], fl=FUR, stc=INK),
        gr("tail-tip", [sh(smooth(tip, tension=0.25))], fl=TIP, stc=INK),
    ], t=pivot(*(piv or points[0]), r=rot))


def paw(cx, cy, w=18, h=10, t=None):
    """Лапа на ноге (лёжа, сбоку): снизу два пальца-бугорка."""
    hw, hh = w / 2, h / 2
    pts = [(cx - hw, cy), (cx - hw + 1, cy - hh), (cx + hw - 1, cy - hh), (cx + hw, cy), (cx + hw / 2, cy + hh), (cx, cy + hh * 0.45), (cx - hw / 2, cy + hh)]
    return stack("paw", [gr("paw", [sh(smooth(pts, tension=0.35))], fl=FUR, stc=INK)], t=t)


def front_paw(cx, t=None, name="paw"):
    """Передние лапы сидящего — как на листе: только пальцы, два округлых бугорка на линии пузыря."""
    toes = [sh(smooth([(cx - 12, 200), (cx - 6, 194.5), (cx, 200)], closed=False, tension=0.55)),
            sh(smooth([(cx, 200), (cx + 6, 194.5), (cx + 12, 200)], closed=False, tension=0.55))]
    return stack(name, [gr("toes", toes, stc=INK)], t=t)


def column_paw(cx, t=None, name="paw"):
    """Лапа-«столбик» — для замаха (царапает): видна целиком, сверху уходит в тело."""
    l, r = cx - 12, cx + 12
    fill = [(l, 176), (l, 196), (cx - 6, 201), (cx, 198), (cx + 6, 201), (r, 196), (r, 176)]
    line = [(l, 178), (l, 195), (l + 2, 199), (cx - 6, 201), (cx - 1.5, 199.5), (cx, 197.5), (cx + 1.5, 199.5), (cx + 6, 201), (r - 2, 199), (r, 195), (r, 178)]
    return stack(name, [gr("paw-fill", [sh(poly(fill, closed=True))], fl=FUR), gr("paw-line", [sh(smooth(line, closed=False, tension=0.35))], stc=INK)], t=t)


def fur_commas():
    """Запятые шерсти у лап снаружи — как на листе."""
    c = [(67, 186), (64.5, 190.5), (67, 195)]
    return gr("commas", [sh(smooth(c, closed=False, tension=0.6)), sh(smooth(mirror(c), closed=False, tension=0.6))], stc=INK, sw=2.2)


# Дуга сразу от бедра наружу, вверху крюк влево.
TAIL_SIT = [(48, 195), (28, 192), (14, 178), (8, 156), (9, 132), (14, 110), (19, 94), (15, 82), (7, 77)]


def sit_parts(n, kind="open", tail_pts=None, tail_rot=None, ears_r=(None, None), mouth="w", face_t=None, paws=None, extra_top=(), sigh=None):
    """Сидит, как на листе: уши, силуэт-«колокол» с зигзагами на висках, лицо, бабочка, лапы-«столбики»."""
    blink = blink_keys(n) if kind in ("open", "sad") else None
    paws = paws if paws is not None else [front_paw(86), front_paw(114)]
    cat = stack("cat", [
        *ears(*ears_r),
        gr("bell", [sh(smooth(BELL, tension=0.38))], fl=FUR, stc=INK),
        temple_marks(),
        *paws,
        bow(),
        face(kind, blink=blink, mouth=mouth, t=face_t if sigh is None else tr(p=sigh)),
        ribbon(122, 70),
    ], t=pivot(100, BASE, s=breathe(n, 1.6)))
    return [tail(tail_pts or TAIL_SIT, rot=tail_rot), cat, *extra_top]


# ---------- позы спереди ----------
def pose_sit():
    n = 90
    rot = loop(n, (0, 0), (0.3, -7), (0.6, 5), (1, 0))  # хвост покачивается крюком
    ear_tw = kf([(0, 0), (40, 0), (43, -12), (47, 0), (n, 0)], LIN)
    tilt = loop(n, (0, 0), (0.4, 3), (0.75, -2), (1, 0))
    return doc("cat-sit", n, fit(sit_parts(n, tail_rot=rot, ears_r=(None, ear_tw), face_t=pivot(100, 96, r=tilt))))


def pose_purr():
    n = 60
    jitter = kf([(f, [0, (0.7 if f % 4 == 0 else -0.7) if f not in (0, n) else 0]) for f in range(0, n + 1, 2)], LIN)
    cat = stack("cat", sit_parts(n, kind="happy", tail_rot=loop(n, (0, 0), (0.5, -5), (1, 0))), t=tr(p=jitter))
    hearts = [
        rising("heart1", lambda: heart(0, 0, 1.1), 140, 70, n, 4, fl=HEART),
        rising("heart2", lambda: heart(0, 0, 0.8), 62, 64, n, 30, dx=-6, fl=HEART),
        rising("heart3", lambda: heart(0, 0, 0.65), 124, 50, n, 18, dx=10, dy=-34, fl=HEART),
    ]
    return doc("cat-purr", n, fit([cat, *hearts]))


def pose_eat():
    """Ест: голова опущена к миске, тело за ней — видны плечи, лапы и хвост."""
    n = 40
    chew = loop(n, (0, [100, 196]), (0.25, [100, 199]), (0.5, [100, 196]), (0.75, [100, 199]), (1, [100, 196]))
    body = gr("body", [sh(smooth([(48, 180), (52, 152), (74, 136), (126, 136), (148, 152), (152, 180), (144, 196), (100, 200), (56, 196)]))], fl=FUR, stc=INK)
    tail_g = tail([(62, 188), (40, 182), (26, 162), (24, 136), (30, 116), (24, 102)], rot=loop(n, (0, -4), (0.5, 5), (1, -4)))
    paws = [paw(62, 196), paw(138, 196)]
    head_g = head("closed", ears_r=(loop(n, (0, 0), (0.5, -6), (1, 0)), None), t=tr(p=chew, a=[100, 112], s=[92, 92]))
    bowl = stack("bowl", [
        gr("kibble", [el(91, 186, 7, 6), el(100, 184, 7, 6), el(109, 186, 7, 6)], fl=KIBBLE, stc=INK, sw=1.5),
        gr("bowl", [sh(smooth([(74, 187), (126, 187), (120, 204), (80, 204)], tension=0.12))], fl=BOWL, stc=INK, sw=3.6),
    ])
    return doc("cat-eat", n, fit([tail_g, body, *paws, head_g, bowl]))


def pose_sad():
    n = 120
    sigh = loop(n, (0, [0, 0]), (0.5, [0, 5]), (1, [0, 0]))
    tail_flat = [(44, 194), (28, 198), (16, 198), (8, 194)]
    parts = sit_parts(n, kind="sad", tail_pts=tail_flat, ears_r=(st(-26), st(26)), mouth="sad", sigh=sigh)
    return doc("cat-sad", n, fit(parts))


def pose_scratch():
    """Царапает: передние лапы по очереди поднимаются и с нажимом тянутся вниз, следы когтей под лапой."""
    n = 40

    def forelimb(x, ph):
        lift = 16
        ys = [(0, 0), (4 + ph, -lift), (9 + ph, 0), (14 + ph, -lift), (19 + ph, 0), (24 + ph, -lift), (29 + ph, 0), (n, 0)]
        return column_paw(x, t=tr(p=kf([(t, [0, dy]) for t, dy in ys], EASE)), name="forelimb")
    marks = []
    for x0, ph in ((86, 0), (114, 5)):
        for i in range(3):
            x = x0 - 5 + i * 5
            f = 9 + ph + i * 2
            o = kf([(0, 0), (f, 0), (f + 2, 100), (34, 100), (n, 0)], LIN)
            marks.append(gr("mark", [sh(poly([(x - 1.5, 202), (x + 1.5, 214)]))], stc=INK, sw=2.4, t=tr(o=o)))
    parts = sit_parts(n, tail_rot=loop(n, (0, 0), (0.5, -8), (1, 0)), paws=[forelimb(86, 0), forelimb(114, 5)])
    return doc("cat-scratch", n, fit(marks + parts))


# ---------- вид сбоку (идёт, закапывает): тело сбоку, голова — в экран ----------
SIDE_BODY = [(62, 150), (72, 126), (104, 116), (134, 122), (152, 142), (148, 166), (122, 178), (88, 178), (66, 168)]


def side_cat(n, legs_rot, tail_rot, bob, head_rot=None, kind="open", crouch=0):
    def leg(x, top, rot, name):
        return stack(name, [
            gr("leg-out", [sh(poly([(x, top), (x, 192)]))], stc=INK, sw=18),
            gr("leg-fur", [sh(poly([(x, top), (x, 192)]))], stc=FUR, sw=18 - 2 * LINE),
            paw(x + 2, 196, w=18, h=10),
        ], t=pivot(x, top, r=rot))

    def tucked(x, top, name):
        pts = [(x, top), (x - 6, 192), (x + 16, 194)]
        return stack(name, [
            gr("leg-out", [sh(poly(pts))], stc=INK, sw=18),
            gr("leg-fur", [sh(poly(pts))], stc=FUR, sw=18 - 2 * LINE),
            paw(x + 21, 196, w=19, h=10),
        ])

    drop = round(crouch * 0.6)
    lean = (lambda g: stack(g["nm"] + "-lean", [g], t=pivot(84, 176, p=[84, 176 + drop], r=st(crouch)))) if crouch else (lambda g: g)
    lf, lb, hf, hb = legs_rot
    blink = blink_keys(n, 0.6) if kind == "open" else None
    hx, hy = (148, 141) if crouch else (152, 130)
    head_g = stack("head-wrap", [
        bow(hx, hy + 7, t=pivot(hx, hy + 7, s=st([72, 72]))),
        head(kind, blink=blink, chin=True, t=tr(p=[hx, hy], a=[100, 112], s=[78, 78], r=head_rot)),
    ])
    if crouch:
        fore_b, fore_f = tucked(118, 178, "fore-back"), tucked(132, 180, "fore-front")
    else:
        fore_b, fore_f = leg(126, 160, lb, "fore-back"), leg(138, 162, lf, "fore-front")
    return stack("cat", [
        leg(80, 160 + drop, hb, "hind-back"), fore_b,
        lean(tail([(66, 150), (46, 140), (34, 118), (38, 94), (48, 80), (44, 66)], rot=tail_rot)),
        lean(gr("body", [sh(smooth(SIDE_BODY))], fl=FUR, stc=INK)),
        leg(92, 162 + drop, hf, "hind-front"), fore_f,
        head_g,
    ], t=tr(p=bob))


def pose_walk():
    n = 20
    a = 22
    sw_ = lambda ph: loop(n, (0, a * ph), (0.5, -a * ph), (1, a * ph))  # noqa: E731
    bob = loop(n, (0, [0, 0]), (0.25, [0, -2.5]), (0.5, [0, 0]), (0.75, [0, -2.5]), (1, [0, 0]))
    return doc("cat-walk", n, fit([side_cat(n, (sw_(1), sw_(-1), sw_(-1), sw_(1)), loop(n, (0, -4), (0.5, 4), (1, -4)), bob)]))


def pose_bury():
    n = 24
    kick = lambda ph: kf([(0, 0), (4 + ph, 46), (9 + ph, -6), (14 + ph, 46), (19 + ph, -6), (n, 0)], EASE)  # noqa: E731
    still = st(0)
    cat = side_cat(n, (still, still, kick(0), kick(3)), loop(n, (0, -8), (0.5, 8), (1, -8)), st([0, 0]), head_rot=st(-4), crouch=10)
    dust = []
    # Земля летит из-под задних лап — над линией пузыря, не сквозь неё.
    for i, (x0, y0, dx, dy, f, d) in enumerate([(56, 188, -36, -30, 5, 13), (52, 190, -44, -12, 6, 11), (58, 187, -28, -40, 15, 12),
                                                (50, 189, -42, -22, 16, 14)]):
        dust.append(rising(f"dust{i}", lambda d=d: el(0, 0, d, d), x0, y0, n, f, dx=dx, dy=dy, fl=DUST2, stc=INK, sw=1.2))
    return doc("cat-bury", n, fit([cat, *dust]))


# ---------- лёжа ----------
BODY_LIE = [(34, 188), (42, 166), (68, 154), (100, 150), (132, 154), (158, 166), (166, 188), (142, 201), (100, 203), (58, 201)]


def lie_parts(n, kind="open", tail_hang=True):
    blink = blink_keys(n, 0.3) if kind == "open" else None
    parts = []
    if tail_hang:
        parts.append(tail([(50, 190), (34, 198), (28, 214), (32, 232)], rot=loop(n, (0, 0), (0.35, -14), (0.7, 4), (1, 0))))
    parts.append(stack("body", [gr("body", [sh(smooth(BODY_LIE))], fl=FUR, stc=INK)], t=pivot(100, BASE, s=breathe(n, 2.2))))
    parts += [paw(82, 203), paw(118, 203)]
    parts.append(head(kind, dy=44, blink=blink, chin=True, t=pivot(100, 156, s=breathe(n, 0.8))))
    return parts


def pose_lie():
    n = 90
    return doc("cat-lie", n, fit(lie_parts(n)))


def pose_sleep():
    n = 120
    body = [(52, 176), (62, 150), (96, 138), (130, 142), (154, 164), (154, 188), (130, 202), (96, 204), (62, 196)]
    t_pts = [(150, 184), (150, 200), (126, 209), (96, 209), (72, 203)]
    parts = [
        stack("body", [gr("body", [sh(smooth(body))], fl=FUR, stc=INK)], t=pivot(100, BASE, s=breathe(n, 3.0))),
        head("closed", dy=58, chin=True, t=pivot(100, 180, s=st([82, 82]), p=[76, 176])),
        tail(t_pts, tip_from=0.7),
    ]
    zs = [rising(f"z{i}", lambda i=i: z_letter(1.0 - i * 0.15), 112 + i * 4, 140, n, 6 + i * 26, dx=18, dy=-34, stc=INK, sw=2.4) for i in range(3)]
    return doc("cat-sleep", n, fit(parts + zs))


def pose_belly():
    """Кверху пузом: короткие лапки вверх, голова у края тела."""
    n = 60
    body = [(54, 180), (70, 160), (104, 150), (140, 156), (160, 178), (150, 198), (108, 205), (68, 200)]
    wig = lambda ph: loop(n, (0, -9 * ph), (0.5, 9 * ph), (1, -9 * ph))  # noqa: E731

    def leg_up(x, top, lean, ph):
        bend = [(x, 172), (x + lean * 0.6, (172 + top) / 2), (x + lean, top)]
        return stack("leg", [
            gr("leg-out", [sh(smooth(bend, closed=False, tension=0.6))], stc=INK, sw=17),
            gr("leg-fur", [sh(smooth(bend, closed=False, tension=0.6))], stc=FUR, sw=17 - 2 * LINE),
            gr("pad", [el(x + lean, top - 3, 17, 14)], fl=FUR, stc=INK),
            gr("beans", [el(x + lean, top - 1, 6, 4.5), el(x + lean - 5, top - 6, 3.2, 3.2), el(x + lean, top - 8, 3.2, 3.2), el(x + lean + 5, top - 6, 3.2, 3.2)], fl=PAD),
        ], t=pivot(x, 172, r=wig(ph)))
    parts = [
        tail([(154, 186), (168, 198), (172, 216), (167, 232)], rot=loop(n, (0, 0), (0.5, 8), (1, 0))),
        # Все лапы — из-за туловища: основания прячутся под краем тела, лапы растут из него.
        leg_up(84, 140, -5, 1), leg_up(130, 140, 5, -1), leg_up(100, 141, -3, -1), leg_up(116, 141, 3, 1),
        stack("body", [gr("body", [sh(smooth(body))], fl=FUR, stc=INK)], t=pivot(104, BASE, s=breathe(n, 2.4))),
        head("happy", dy=56, chin=True, t=pivot(100, 170, r=loop(n, (0, -16), (0.5, -10), (1, -16)), s=st([88, 88]), p=[50, 168])),
    ]
    return doc("cat-belly", n, fit(parts))


def pose_sick():
    n = 120
    parts = lie_parts(n, kind="half", tail_hang=False)
    blanket = stack("blanket", [
        gr("blanket", [sh(smooth([(28, 174), (66, 166), (100, 164), (136, 166), (172, 174), (178, 214), (150, 222), (100, 220), (50, 222), (22, 214)], tension=0.25))], fl=BLANKET, stc=INK, sw=3.6),
        gr("stripes", [sh(poly([(34, 188), (166, 188)])), sh(poly([(30, 200), (170, 200)]))], stc=BLANKET2, sw=4),
    ], t=pivot(100, 200, s=breathe(n, 2.2)))
    thermo = stack("thermo", [
        gr("tube", [sh(poly([(106, 150), (138, 158)]))], stc=INK, sw=7),
        gr("tube-in", [sh(poly([(106, 150), (138, 158)]))], stc=FUR, sw=3),
        gr("bulb", [el(140, 158.5, 7, 7)], fl=THERMO, stc=INK, sw=1.8),
    ], t=pivot(106, 150, r=loop(n, (0, -7), (0.5, 6), (1, -7))))
    no_paws = [p for p in parts if p["nm"] != "paw"]
    return doc("cat-sick", n, fit(no_paws[:-1] + [blanket, no_paws[-1], thermo]))


def back_bell(n, extra=(), pressed=False):
    """Со спины: тот же силуэт-«колокол», уши, зигзаги на висках, лица нет; бантик девочки — на другой стороне.
    pressed — прижался к стеклу: уши расплющены и ближе друг к другу."""
    if pressed:
        # Прижатые уши — округлые бугорки без острых кончиков.
        bump = [(62, 76), (63, 64), (72, 57), (80, 59), (84.5, 63)]
        ear_l = stack("ear-l", [gr("ear", [sh(smooth(bump, tension=0.55))], fl=FUR, stc=INK)], t=pivot(73, 70, p=[80, 74], r=st(14), s=st([112, 62])))
        ear_r = stack("ear-r", [gr("ear", [sh(smooth(mirror(bump), tension=0.55))], fl=FUR, stc=INK)], t=pivot(127, 70, p=[120, 74], r=st(-14), s=st([112, 62])))
        top = [ear_l, ear_r]
    else:
        top = ears()
    return [*top, gr("bell", [sh(smooth(BELL, tension=0.38))], fl=FUR, stc=INK), temple_marks(), ribbon(78, 70, rot=-14), *extra]


def pose_sulk():
    """Обиделся: сидит спиной (вид сзади на листе) — хвост торчит вверх по центру и раздражённо дёргается."""
    n = 36
    flick = kf([(0, 0), (6, 12), (10, -5), (16, 10), (22, -3), (n, 0)], EASE)
    cat = stack("cat", back_bell(n), t=pivot(100, BASE, s=breathe(n, 1.4)))
    t_up = tail([(100, 198), (110, 178), (114, 154), (106, 130), (98, 110), (100, 96), (93, 86)], rot=flick, piv=(100, 198), w=20)
    return doc("cat-sulk", n, fit([cat, t_up]))


# ---------- прикол с листа: прижался к стеклу ----------
def paw_print(cx, cy, r=0):
    """Отпечаток лапы на «стекле»: подушечка-капля и три пальчика, в тонкой дуге лапы."""
    return stack("print", [
        gr("paw", [el(cx, cy, 19, 17)], fl=FUR, stc=INK, sw=2.4),
        gr("pad", [sh(smooth([(cx - 5.5, cy + 4.5), (cx, cy - 0.5), (cx + 5.5, cy + 4.5), (cx, cy + 7)], tension=0.4))], fl=PAD),
        gr("toes", [el(cx - 6.8, cy - 3, 3.6, 4.2), el(cx - 2.4, cy - 6.4, 3.6, 4.2), el(cx + 2.4, cy - 6.4, 3.6, 4.2), el(cx + 6.8, cy - 3, 3.6, 4.2)], fl=PAD),
    ], t=pivot(cx, cy, r=st(r)))


def pose_glass():
    """Прижался к стеклу — вид «снизу», как на листе: спина, уши, хвост вверх по центру,
    четыре отпечатка лап и крестик посередине. Кот то прижимается (расплющивается), то отлипает."""
    n = 60
    squish = loop(n, (0, [100, 100]), (0.2, [108, 94]), (0.55, [108, 94]), (0.75, [100, 100]), (1, [100, 100]))
    prints = [paw_print(56, 160, -18), paw_print(144, 160, 18), paw_print(58, 188, -8), paw_print(142, 188, 8)]
    cross = gr("cross", [sh(poly([(96, 172), (104, 180)])), sh(poly([(104, 172), (96, 180)]))], stc=INK, sw=2.4)
    tail_g = tail([(100, 172), (110, 152), (113, 130), (105, 110), (98, 96), (100, 86), (93, 79)], piv=(100, 172), rot=loop(n, (0, 0), (0.5, 6), (1, 0)), w=19)
    cat = stack("cat", back_bell(n, [tail_g, *prints, cross], pressed=True), t=pivot(100, BASE, s=squish))
    return doc("cat-glass", n, fit([cat]))


POSES = {
    "sit": (pose_sit, {"loop": True}),
    "purr": (pose_purr, {"loop": True, "sound": "tap"}),
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
    "glass": (pose_glass, {"loop": True}),
}

MANIFEST = {
    "format": 2,
    "species": "cat",
    "rev": 1,
    "name": {"ru": "Кот", "en": "Cat", "ko": "고양이"},
    "defaultName": {"ru": "Мистер Кот", "en": "Mister Cat", "ko": "미스터 고양이"},
    "sexes": ["m", "f"],
    "defaultNameBySex": {"f": {"ru": "Мисс Кошка", "en": "Miss Kitty", "ko": "미스 고양이"}},
    "accessories": {
        "bow_tie": {"name": {"ru": "Бабочка", "en": "Bow tie", "ko": "나비넥타이"}, "slot": "neck", "sex": ["m"], "default": True},
        "bow_head": {"name": {"ru": "Бантик на голову", "en": "Hair bow", "ko": "머리 리본"}, "slot": "head", "sex": ["f"], "default": True},
    },
    "texts": {"tap": {"ru": "{name} мурчит — +1 к вайбу", "en": "{name} purrs — +1 vibe", "ko": "{name}이(가) 골골거려요 — 바이브 +1"}},
    "sounds": {"purr": "synth:purr", "tap": "synth:purr"},
    "extras": {"bored": [{"pose": "glass", "min": 3, "max": 5, "target": "any", "w": 1}],
               "content": [{"pose": "glass", "min": 3, "max": 4, "target": "any", "w": 1}]},
    "canvas": [W, H],
    "anchor": [100, BASE],
    "scale": 0.3,
    "author": "WYX (по эскизу)",
    "palette": PALETTE,
    "defaultCoat": "white",
    "coats": {
        "white": {"name": {"ru": "Белый", "en": "White", "ko": "흰색"}, "colors": {}},
        "ginger": {"name": {"ru": "Рыжий", "en": "Ginger", "ko": "치즈"},
                   "colors": {"fur": "#F7B46A", "tip": "#D2702F", "ink": "#3B2416", "eye": "#2A1A10", "face": "#3B2416", "nose": "#C2574A", "bow": "#2F6B57", "ribbon": "#2F6B57"}},
        "grey": {"name": {"ru": "Серый", "en": "Grey", "ko": "회색"}, "colors": {"fur": "#C3C8D0", "tip": "#5F656E", "nose": "#B5707E"}},
        "black": {"name": {"ru": "Чёрный", "en": "Black", "ko": "검은색"},
                  "colors": {"fur": "#3A3A42", "ink": "#121216", "eye": "#F5C842", "face": "#C9C9D2", "nose": "#E98AA0", "tip": "#1B1B20", "bow": "#E5484D"}},
        "cream": {"name": {"ru": "Кремовый", "en": "Cream", "ko": "크림"}, "colors": {"fur": "#F4E4C6", "tip": "#A87A4C", "ink": "#2E2318", "nose": "#B8705E"}},
    },
}


def main():
    write_pack(sys.argv[1] if len(sys.argv) > 1 else OUT, POSES, MANIFEST)


if __name__ == "__main__":
    main()
