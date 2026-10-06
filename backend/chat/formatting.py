"""Форматирование текста сообщений.

Текст хранится чистым (Message.content), а оформление — отдельным списком
диапазонов Message.entities: [{"type": "bold", "offset": 0, "length": 5}, …].
Так старые клиенты показывают обычный текст без служебных символов, а превью,
пуши, поиск и копирование работают с чистым текстом.

offset и length считаются в единицах UTF-16 — так же, как индексы строк в JS:
клиент вычисляет их у себя, сервер только проверяет и обрезает.
"""
import random

ENTITY_TYPES = {
    "bold", "italic", "underline", "strike", "code", "pre",
    "spoiler",   # скрыт до тапа
    "zalgo",     # «глитч»: диакритика над и под буквами, рисует клиент
    "scramble",  # буквы перемешаны, по тапу собираются в исходный текст
}
# Что прячем в превью (список чатов, пуш, цитата): иначе спойлер и
# перемешанный текст читались бы, не открывая переписку.
HIDDEN_IN_PREVIEW = {"spoiler", "scramble"}
MAX_ENTITIES = 200


def utf16_len(text):
    return len((text or "").encode("utf-16-le")) // 2


def clean_entities(raw, text):
    """Проверенный список диапазонов: известные типы, целые неотрицательные
    offset/length в пределах текста. Мусор молча отбрасываем."""
    if not isinstance(raw, list) or not text:
        return []
    total = utf16_len(text)
    out = []
    for e in raw[:MAX_ENTITIES]:
        if not isinstance(e, dict):
            continue
        t = e.get("type")
        try:
            off, ln = int(e.get("offset")), int(e.get("length"))
        except (TypeError, ValueError):
            continue
        if t not in ENTITY_TYPES or off < 0 or ln <= 0 or off >= total:
            continue
        out.append({"type": t, "offset": off, "length": min(ln, total - off)})
    return out


def _units(text):
    """Пары (символ, его длина в UTF-16) — чтобы переводить offset в индексы."""
    return [(ch, 2 if ord(ch) > 0xFFFF else 1) for ch in text]


def mask_preview(text, entities):
    """Текст для превью: спойлер заменяем на ░, перемешанное — перемешиваем.
    Остальное оформление в превью не нужно — там простой текст."""
    text = text or ""
    hidden = [e for e in (entities or []) if isinstance(e, dict) and e.get("type") in HIDDEN_IN_PREVIEW]
    if not hidden:
        return text
    chars = _units(text)
    out, pos = [], 0
    spans = []  # (начало, конец, тип) в UTF-16
    for e in hidden:
        try:
            spans.append((int(e["offset"]), int(e["offset"]) + int(e["length"]), e["type"]))
        except (KeyError, TypeError, ValueError):
            continue
    word, word_mode = [], None

    def flush():
        nonlocal word, word_mode
        if word:
            if word_mode == "scramble":
                random.shuffle(word)
            out.extend(word)
        word, word_mode = [], None

    for ch, n in chars:
        mode = None
        for a, b, t in spans:
            if a <= pos < b:
                mode = "spoiler" if t == "spoiler" else (mode or t)
        pos += n
        if mode == "spoiler":
            flush()
            out.append(" " if ch.isspace() else "░")
        elif mode == "scramble" and ch.isalnum():
            if word_mode != "scramble":
                flush()
            word_mode = "scramble"
            word.append(ch)
        else:
            flush()
            out.append(ch)
    flush()
    return "".join(out)
