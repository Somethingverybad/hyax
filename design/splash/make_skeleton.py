"""Lottie-скелетон загрузки «Мяты»: палочки «X» расходятся, играют в пинг-понг
и собираются обратно (по кругу).

    python design/splash/make_skeleton.py  →  sux-chat-app/src/assets/skeleton.json

Части «X» — те же, что в заставке (make_lottie.py): таблетки с градиентом от
салатового к тёмно-мятному. Мяч называется «ball» — в тёмной теме компонент
(components/LoadingSkeleton.tsx) перекрашивает его в основной цвет темы.

Сценарий (30 к/с, 96 кадров по кругу):
  0–6     «X»
  6–18    палочки разъезжаются к краям и встают ракетками
  16–74   мяч: вправо → влево → вправо → влево → в центр; ракетки ловят его по высоте
  72–86   палочки съезжаются обратно в «X»
  86–96   «X»
"""
import json
import os

from make_lottie import (BAR1_END, BAR2_END, EASE_IO, LIME_TOP, MINT_DEEP, anim, grad, group, layer,
                         static, transform)

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                   "sux-chat-app/src/assets/skeleton.json")
S = 200
C = S / 2
OP = 96
BW, BH = 24, 110                 # палочка (в «X» — как в иконке, только мельче)
PAD_X = 30                       # ракетки — у краёв
PAD_SY = 60                      # ракетка короче палочки «X», чтобы мячу было где летать
BALL_R = 9
HIT_L = PAD_X + BW / 2 + BALL_R  # мяч касается ракетки
HIT_R = S - HIT_L
LINEAR = {"i": {"x": [1], "y": [1]}, "o": {"x": [0], "y": [0]}}

# Удары: (кадр, x, y) — мяч летит по прямой с постоянной скоростью.
HITS = [(16, C, C), (27, HIT_R, C - 20), (39, HIT_L, C + 18), (51, HIT_R, C - 8), (63, HIT_L, C + 14), (72, C, C)]


def paddle(ind, name, end_color, end_alpha, angle, side):
    """side: -1 — левая ракетка, +1 — правая."""
    x_pad = PAD_X if side < 0 else S - PAD_X
    hits = [(t, y) for t, x, y in HITS if (x == HIT_L if side < 0 else x == HIT_R)]
    # Ракетка: из центра к краю, затем ходит к высоте каждого своего удара, потом обратно.
    ys = [(18, C)] + [(t - 1, y) for t, y in hits] + [(72, C)]
    pos = [(6, [C, C, 0])] + [(t, [x_pad, y, 0]) for t, y in ys] + [(86, [C, C, 0])]
    rect = {"ty": "rc", "nm": "stick", "d": 1, "s": static([BW, BH]), "p": static([0, 0]), "r": static(BW / 2)}
    ks = transform(
        p=anim(*pos, ease=EASE_IO),
        r=anim((6, angle), (18, 0), (72, 0), (86, angle), ease=EASE_IO),
        s=anim((6, [100, 100, 100]), (18, [100, PAD_SY, 100]), (72, [100, PAD_SY, 100]), (86, [100, 100, 100]),
               ease=EASE_IO),
    )
    return layer(ind, name, [group([rect, grad(LIME_TOP, end_color, end_alpha, h=BH)], name)], ks)


def ball(ind):
    dot = {"ty": "el", "nm": "ball", "d": 1, "s": static([2 * BALL_R, 2 * BALL_R]), "p": static([0, 0])}
    fill = {"ty": "fl", "nm": "ball", "o": static(100), "c": static([*MINT_DEEP, 1]), "r": 1, "bm": 0}
    squash = []
    for t, x, _ in HITS[1:-1]:          # сплющивается о ракетку
        squash += [(t - 1, [100, 100, 100]), (t, [70, 125, 100]), (t + 2, [100, 100, 100])]
    ks = transform(
        p=anim(*[(t, [x, y, 0]) for t, x, y in HITS], ease=LINEAR),
        s=anim((16, [0, 0, 100]), (20, [100, 100, 100]), *squash, (70, [100, 100, 100]), (74, [0, 0, 100]),
               ease=EASE_IO),
    )
    return layer(ind, "ball", [group([dot, fill], "ball")], ks)


def main():
    layers = [
        ball(1),
        paddle(2, "stick 2", BAR2_END, 1 - 0.43 / 1.9066, -45, +1),
        paddle(3, "stick 1", BAR1_END, 1.0, 45, -1),
    ]
    for l in layers:
        l["op"] = OP
    doc = {"v": "5.7.4", "fr": 30, "ip": 0, "op": OP, "w": S, "h": S, "nm": "WhoYaX skeleton",
           "ddd": 0, "assets": [], "layers": layers}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(doc, f, separators=(",", ":"))
    print(OUT, os.path.getsize(OUT), "bytes")


if __name__ == "__main__":
    main()
