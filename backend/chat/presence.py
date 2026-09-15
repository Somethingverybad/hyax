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


# ── Кто сейчас на связи ──────────────────────────────────────────────────────
# Считаем открытые сокеты: их может быть несколько (телефон и вкладка в
# браузере). Нужно, чтобы понять, доедет ли Р.Ё.В живьём или собеседнику
# надо слать пуш.

_online: dict[str, int] = {}


def add_connection(profile_id) -> None:
    key = str(profile_id)
    with _lock:
        _online[key] = _online.get(key, 0) + 1


def drop_connection(profile_id) -> None:
    key = str(profile_id)
    with _lock:
        left = _online.get(key, 0) - 1
        if left > 0:
            _online[key] = left
        else:
            _online.pop(key, None)


def is_online(profile_id) -> bool:
    with _lock:
        return _online.get(str(profile_id), 0) > 0


# ── Пуш о Р.Ё.В: не чаще раза в минуту на пару «кто кого» ────────────────────
# Иначе серия коротких тычков превратилась бы в очередь уведомлений.

ROV_PUSH_INTERVAL = 60

_rov_push: dict[tuple[str, str], float] = {}


def rov_push_allowed(sender_id, target_id) -> bool:
    key = (str(sender_id), str(target_id))
    now = time.monotonic()
    with _lock:
        last = _rov_push.get(key, 0.0)
        if now - last < ROV_PUSH_INTERVAL:
            return False
        _rov_push[key] = now
        return True
