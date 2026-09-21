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


# ── «В сети» для собеседников ────────────────────────────────────────────────
# Открытый сокет — ещё не «в сети»: свёрнутое на iPhone приложение держит
# соединение, пока iOS его не усыпит. Поэтому у каждого соединения свой флаг
# «приложение на экране» (клиент шлёт {type:'active'} на смене видимости) и
# время последнего пинга: пинг идёт раз в 30 с, соединение без пинга дольше
# STALE секунд считаем мёртвым, даже если TCP ещё не закрыт.

STALE = 75

_conns: dict[str, tuple[str, bool, float]] = {}  # channel → (profile, на экране, пинг)


def _active_locked(key: str, now: float) -> bool:
    return any(p == key and act and now - ts < STALE for p, act, ts in _conns.values())


def _update_conn(channel, profile_id, active) -> bool:
    """Обновить соединение; вернуть True, если человек сменил «в сети»."""
    key = str(profile_id)
    now = time.monotonic()
    with _lock:
        before = _active_locked(key, now)
        if active is None:
            _conns.pop(channel, None)
        else:
            _conns[channel] = (key, active, now)
        return before != _active_locked(key, now)


def conn_open(channel, profile_id) -> bool:
    return _update_conn(channel, profile_id, True)


def conn_active(channel, profile_id, active: bool) -> bool:
    return _update_conn(channel, profile_id, bool(active))


def conn_ping(channel, profile_id) -> bool:
    with _lock:
        rec = _conns.get(channel)
    return _update_conn(channel, profile_id, rec[1] if rec else True)


def conn_close(channel, profile_id) -> bool:
    return _update_conn(channel, profile_id, None)


def is_active(profile_id) -> bool:
    now = time.monotonic()
    with _lock:
        for ch, (p, act, ts) in list(_conns.items()):
            if now - ts > STALE * 20:  # забытые соединения — выметаем
                _conns.pop(ch, None)
        return _active_locked(str(profile_id), now)


def shown_online(profile) -> bool:
    """Что видят собеседники: «Скрыт» выглядит как «не в сети»."""
    return not getattr(profile, 'hide_online', False) and is_active(profile.id)


def presence_peers(profile_id) -> list[str]:
    """Кому сообщать о смене статуса: собеседники по личным чатам."""
    from .models import ChatParticipant
    chats = ChatParticipant.objects.filter(user_id=profile_id, chat__kind='direct').values('chat_id')
    return [str(x) for x in ChatParticipant.objects.filter(chat_id__in=chats)
            .exclude(user_id=profile_id).values_list('user_id', flat=True).distinct()]


def presence_events(profile) -> list[tuple[str, dict]]:
    """(группа, событие) для рассылки собеседникам — синхронно, из потока БД."""
    data = {'type': 'presence', 'profile_id': str(profile.id), 'online': shown_online(profile)}
    return [(f'user_{pid}', {'type': 'notification', 'data': data}) for pid in presence_peers(profile.id)]


def broadcast_presence_sync(profile) -> None:
    """Из обычного (не async) кода — например, после смены настройки «Скрыт»."""
    from asgiref.sync import async_to_sync
    from channels.layers import get_channel_layer
    layer = get_channel_layer()
    for group, event in presence_events(profile):
        async_to_sync(layer.group_send)(group, event)


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
