"""Допустимые реакции — по тайллисту (design/image copy 2.png).

Произвольные строки не принимаем: иначе в ленту попадёт что угодно, включая
длинные «эмодзи» из нескольких символов и текст. Набор тот же, что рисует
клиент, и он же проверяется на сервере — список менять в двух местах вместе
(sux-chat-app/src/lib/reactions.ts).

Порядок важен: первые двенадцать — основной набор, дальше дополнительные.
"""

MAIN = [
    ("❤️", "Лайк"),
    ("👍", "Класс"),
    ("👎", "Дизлайк"),
    ("🔥", "Огонь"),
    ("😂", "Смех"),
    ("😮", "Удивление"),
    ("😢", "Грусть"),
    ("🎉", "Праздник"),
    ("🤔", "Задумался"),
    ("👏", "Аплодисменты"),
    ("✅", "Согласен"),
    ("❌", "Не согласен"),
]

EXTRA = [
    ("⭐", "Интересно"),
    ("💡", "Идея"),
    ("👀", "Вау"),
    ("🤢", "Фу"),
    ("💯", "Супер"),
    ("🤝", "Поддержка"),
    ("🙏", "Спасибо"),
    ("💖", "Забота"),
]

ALL = MAIN + EXTRA
ALLOWED = {emoji for emoji, _ in ALL}
DEFAULT = MAIN[0][0]  # двойной тап ставит именно её

# Свои эмодзи (наборы эмодзи, StickerPack kind=emoji) тоже можно поставить
# реакцией: значение — «ce:<id эмодзи>», картинку и обычный эмодзи-двойник
# запоминаем в самой реакции (PostReaction.custom): набор могут удалить, а
# файлы эмодзи остаются, как и в тексте сообщений (formatting.resolve_custom_emoji).
CUSTOM_PREFIX = "ce:"
# Двойник по умолчанию — тот же, что подставляет клиент (EmojiPanel).
CUSTOM_FALLBACK = "🙂"


def custom_info(value):
    """«ce:<id>» → {"url", "glyph", "repaint"?} или None, если такого эмодзи нет."""
    import uuid as _uuid
    from .models import Sticker
    if not value.startswith(CUSTOM_PREFIX):
        return None
    try:
        sid = _uuid.UUID(value[len(CUSTOM_PREFIX):])
    except ValueError:
        return None
    # Только наши файлы: картинка реакции не должна ходить на чужой сервер.
    row = (Sticker.objects.filter(id=sid, pack__kind="emoji", file_url__startswith="/media/emoji/")
           .values("file_url", "emoji", "repaint").first())
    if not row:
        return None
    info = {"url": row["file_url"], "glyph": (row["emoji"] or "").strip() or CUSTOM_FALLBACK}
    if row["repaint"]:
        info["repaint"] = True
    return info


def parse(value):
    """Что прислал клиент → (value, kind, custom) или None, если такой реакции нет."""
    value = (value or "").strip()
    if value in ALLOWED:
        return value, "emoji", None
    info = custom_info(value)
    if info:
        return value, "custom", info
    return None


def glyph(value, custom):
    """Обычный эмодзи реакции — для пуша и старых клиентов."""
    return (custom or {}).get("glyph") or value


def describe(value, custom):
    """Поля таблетки: emoji — обычный эмодзи (его рисуют клиенты, которые
    своих реакций ещё не знают), key — чем реакцию переключать, custom —
    картинка. У обычных реакций key не нужен: он равен emoji."""
    if not custom:
        return {"emoji": value}
    pic = {"url": custom.get("url", "")}
    if custom.get("repaint"):
        pic["repaint"] = True
    return {"emoji": glyph(value, custom), "key": value, "custom": pic}


def grouped(reactions, extra):
    """Реакции сообщения по значению в порядке тайллиста, свои эмодзи — после,
    в порядке появления: [(value, custom, [extra(r) ...])]."""
    order = {emoji: i for i, (emoji, _) in enumerate(ALL)}
    groups, first = {}, {}
    # Сортируем здесь, а не order_by: реакции бывают уже подтянуты prefetch.
    for n, r in enumerate(sorted(reactions, key=lambda r: r.created_at)):
        if r.value not in groups:
            groups[r.value] = []
            first[r.value] = (n, r.custom)
        groups[r.value].append(extra(r))
    keys = sorted(groups, key=lambda v: (order.get(v, len(order)), first[v][0]))
    return [(v, first[v][1], groups[v]) for v in keys]
