"""Упоминания в группах: «@ник» участника в тексте сообщения.

Ник может быть с пробелами и кириллицей («Долгий ящик»), поэтому не разбираем
текст регуляркой «@слово», а ищем в нём ники участников этого чата — длинные
раньше коротких, чтобы «@Ани Мур» не съелся упоминанием «@Ани». Регистр не
важен, по краям — не буква и не цифра.

Результат — Message.mentions: [{"id": профиль, "offset": …, "length": …}],
offset/length в UTF-16, как у entities. По нему клиент подсвечивает ник, а
список чатов ставит «@» у чата, где меня упомянули и я ещё не прочитал.
"""
import re

from .models import ChatParticipant

MAX_MENTIONS = 50


def _u16(s: str) -> int:
    return len(s.encode("utf-16-le")) // 2


def find_mentions(chat, text, author_id=None):
    if not text or "@" not in text or not chat or not chat.is_group or chat.kind in ("channel", "secret"):
        return []
    people = (ChatParticipant.objects.filter(chat=chat).exclude(user_id=author_id)
              .values_list("user_id", "user__username"))
    people = sorted(((str(uid), name) for uid, name in people if name), key=lambda p: -len(p[1]))
    taken, out = [], []
    for uid, name in people:
        for m in re.finditer(r"(?<!\w)@" + re.escape(name) + r"(?!\w)", text, re.IGNORECASE):
            s, e = m.span()
            if any(a < e and s < b for a, b in taken):
                continue
            taken.append((s, e))
            out.append({"id": uid, "offset": _u16(text[:s]), "length": _u16(text[s:e])})
            if len(out) >= MAX_MENTIONS:
                break
    return sorted(out, key=lambda x: x["offset"])


def store_mentions(message):
    """Пересчитать упоминания сообщения (после создания или правки)."""
    from .models import Message
    found = find_mentions(message.chat, message.content or "", message.sender_id)
    if found != (message.mentions or []):
        message.mentions = found
        Message.objects.filter(pk=message.pk).update(mentions=found)
    return found
