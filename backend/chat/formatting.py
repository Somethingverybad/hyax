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
    # Свой эмодзи из набора (StickerPack kind=emoji): в тексте — обычный эмодзи
    # (его видят старые клиенты, пуши и превью), клиент рисует картинку.
    # Нужен emoji_id; адрес картинки сервер подставляет сам (resolve_custom_emoji).
    "custom_emoji",
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
        item = {"type": t, "offset": off, "length": min(ln, total - off)}
        if t == "custom_emoji":
            emoji_id = str(e.get("emoji_id") or "")[:64]
            if not emoji_id:
                continue
            item["emoji_id"] = emoji_id
        out.append(item)
    return out


def resolve_custom_emoji(entities):
    """Свои эмодзи: по emoji_id — картинка из набора эмодзи. Адрес кладём в
    сам диапазон: сообщение рисуется без лишних запросов и не теряет эмодзи,
    если автор потом удалит набор (файлы эмодзи при этом не удаляются)."""
    ids = [e["emoji_id"] for e in entities if e.get("type") == "custom_emoji"]
    if not ids:
        return entities
    import uuid as _uuid
    from .models import Sticker
    valid = []
    for i in ids:
        try:
            valid.append(str(_uuid.UUID(i)))
        except ValueError:
            pass
    # Только наши файлы эмодзи: стикер в набор можно добавить с любым адресом,
    # а картинка в тексте не должна ходить на чужой сервер.
    rows = {str(k): (url, pack, repaint) for k, url, pack, repaint in
            Sticker.objects.filter(id__in=valid, pack__kind="emoji", file_url__startswith="/media/emoji/")
            .values_list("id", "file_url", "pack_id", "repaint")}
    out = []
    for e in entities:
        if e.get("type") == "custom_emoji":
            row = rows.get(e["emoji_id"])
            if not row:
                continue
            # Набор — по тапу на эмодзи его можно открыть и добавить себе;
            # repaint — одноцветный значок, рисуется цветом текста.
            e = {**e, "url": row[0], "pack": str(row[1])}
            if row[2]:
                e["repaint"] = True
        out.append(e)
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
