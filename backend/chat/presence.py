"""Кто какой чат сейчас смотрит.

Нужно ровно для одного: не слать пуш человеку, у которого этот чат открыт —
он и так видит сообщение, а звук аудио-стикера ему проиграет само приложение.

Клиент сообщает об открытом чате по сокету ({type:'viewing', chat}) и
повторяет это, пока чат открыт; запись живёт TTL секунд и протухает сама,
если приложение свернули или связь оборвалась.

Хранение — в памяти процесса, и это осознанно: у api один процесс daphne
(см. docker-compose) и InMemoryChannelLayer, так что сокеты и HTTP-запросы
живут в нём же. Появится второй процесс — переносить в Redis.
"""
import threading
import time

TTL = 90  # секунд без подтверждения — считаем, что чат уже не смотрят

_lock = threading.Lock()
_viewing: dict[str, tuple[str, float]] = {}


def set_viewing(profile_id, chat_id) -> None:
    key = str(profile_id)
    with _lock:
        if chat_id:
            _viewing[key] = (str(chat_id), time.monotonic() + TTL)
        else:
            _viewing.pop(key, None)


def clear(profile_id) -> None:
    set_viewing(profile_id, None)


def is_viewing(profile_id, chat_id) -> bool:
    key = str(profile_id)
    with _lock:
        rec = _viewing.get(key)
        if not rec:
            return False
        chat, until = rec
        if until < time.monotonic():
            _viewing.pop(key, None)
            return False
        return chat == str(chat_id)


def viewers(chat_id) -> set[str]:
    """Кто прямо сейчас смотрит этот чат — им пуш не нужен."""
    now = time.monotonic()
    out = set()
    with _lock:
        for key, (chat, until) in list(_viewing.items()):
            if until < now:
                _viewing.pop(key, None)
            elif chat == str(chat_id):
                out.add(key)
    return out
