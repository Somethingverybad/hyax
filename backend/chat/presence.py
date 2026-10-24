"""Кто какой чат сейчас смотрит.

Нужно ровно для одного: не слать пуш человеку, у которого этот чат открыт —
он и так видит сообщение, а звук аудио-стикера ему проиграет само приложение.

Клиент сообщает об открытом чате по сокету ({type:'viewing', chat}) и
повторяет это, пока чат открыт; запись живёт TTL секунд и протухает сама,
если приложение свернули или связь оборвалась.

Хранение: по умолчанию память процесса — для одного процесса daphne и
InMemoryChannelLayer (тесты, локальный стенд). На сервере api работает
несколькими процессами, и тогда всё это лежит в Redis (REDIS_URL в
настройках, реализация — chat/presence_redis.py): сокет человека в одном
процессе, а HTTP-запрос «слать ли пуш» — в другом, и видеть они должны одно.
Публичные функции ниже одни для обоих хранилищ.
"""
import threading
import time

# ── Хранилище: Redis или память процесса ─────────────────────────────────────
_redis_backend = None
_redis_checked = False


def configure(client=None) -> None:
    """Переключить хранилище: client — redis.Redis (в тестах — fakeredis),
    None — память процесса."""
    global _redis_backend, _redis_checked
    _redis_checked = True
    if client is None:
        _redis_backend = None
        return
    from .presence_redis import RedisPresence
    _redis_backend = RedisPresence(client, TTL, TTL_MIN, TTL_MAX, STALE, ROV_PUSH_INTERVAL, PUSHED_TTL)


def _rb():
    """Redis-хранилище, если настроено, иначе None (память процесса)."""
    global _redis_checked
    if not _redis_checked:
        _redis_checked = True
        from django.conf import settings
        url = getattr(settings, "REDIS_URL", "")
        if url:
            import redis
            configure(redis.Redis.from_url(url, decode_responses=True, socket_timeout=1.0,
                                           socket_connect_timeout=1.0, health_check_interval=30))
    return _redis_backend

TTL = 90  # секунд без подтверждения — считаем, что чат уже не смотрят
# Клиент может сам сказать, как часто подтверждает (поле ttl в «viewing»):
# новые версии — каждые 10 с с ttl 15, и пуши начинают приходить через
# ~15 с после того, как приложение свернули, даже если «больше не смотрю»
# потерялось по дороге. Старые подтверждают раз в 45 с — им прежние 90.
TTL_MIN, TTL_MAX = 10, 90

_lock = threading.Lock()
# Ключ — «профиль|устройство»: у человека может быть открыт чат на компьютере,
# а телефон лежит в кармане — ему пуш нужен. Старый клиент устройства не
# называет (device_id пусто) — тогда отметка на весь профиль, как раньше.
_viewing: dict[str, tuple[str, float]] = {}


def _key(profile_id, device_id) -> str:
    return f"{profile_id}|{device_id or ''}"


def set_viewing(profile_id, chat_id, ttl=None, device_id=None) -> None:
    b = _rb()
    if b:
        return b.set_viewing(profile_id, chat_id, ttl, device_id)
    key = _key(profile_id, device_id)
    try:
        life = min(TTL_MAX, max(TTL_MIN, int(ttl))) if ttl else TTL
    except (TypeError, ValueError):
        life = TTL
    with _lock:
        if chat_id:
            _viewing[key] = (str(chat_id), time.monotonic() + life)
        elif device_id:
            _viewing.pop(key, None)
        else:
            # Без устройства — снимаем все отметки профиля (старый клиент, разрыв сокета).
            prefix = f"{profile_id}|"
            for k in [k for k in _viewing if k.startswith(prefix)]:
                _viewing.pop(k, None)


def clear(profile_id, device_id=None) -> None:
    set_viewing(profile_id, None, device_id=device_id)


def is_viewing(profile_id, chat_id) -> bool:
    """Смотрит ли этот чат хотя бы одно устройство человека."""
    return str(profile_id) in viewers(chat_id)


def viewing_devices(chat_id) -> dict[str, set[str]]:
    """Кто смотрит чат: id профиля → устройства ('' — клиент без устройства,
    считаем за весь профиль). Протухшие отметки по пути выкидываем."""
    b = _rb()
    if b:
        return b.viewing_devices(chat_id)
    now, cid = time.monotonic(), str(chat_id)
    out: dict[str, set[str]] = {}
    with _lock:
        for key, (chat, until) in list(_viewing.items()):
            if until < now:
                _viewing.pop(key, None)
            elif chat == cid:
                pid, _, dev = key.partition("|")
                out.setdefault(pid, set()).add(dev)
    return out


def viewers(chat_id) -> set[str]:
    """Кто прямо сейчас смотрит этот чат (любым устройством) — id профилей."""
    b = _rb()
    if b:
        return b.viewers(chat_id)
    return set(viewing_devices(chat_id))


# ── Кто сейчас на связи ──────────────────────────────────────────────────────
# Считаем открытые сокеты: их может быть несколько (телефон и вкладка в
# браузере). Нужно, чтобы понять, доедет ли Р.Ё.В живьём или собеседнику
# надо слать пуш.

_online: dict[str, int] = {}


def add_connection(profile_id) -> None:
    if _rb():
        return  # в Redis соединения учитывает conn_open
    key = str(profile_id)
    with _lock:
        _online[key] = _online.get(key, 0) + 1


def drop_connection(profile_id) -> None:
    if _rb():
        return
    key = str(profile_id)
    with _lock:
        left = _online.get(key, 0) - 1
        if left > 0:
            _online[key] = left
        else:
            _online.pop(key, None)


def is_online(profile_id) -> bool:
    b = _rb()
    if b:
        return b.is_online(profile_id)
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
# Когда в последний раз писали last_seen: чаще раза в минуту в базу не ходим.
_last_seen_write: dict[str, float] = {}
# Когда открылось соединение — для мониторинга («в сети 15 мин»).
_opened: dict[str, float] = {}


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
    b = _rb()
    if b:
        return b.conn_open(channel, profile_id)
    with _lock:
        _opened[channel] = time.monotonic()
    return _update_conn(channel, profile_id, True)


def conn_active(channel, profile_id, active: bool) -> bool:
    b = _rb()
    if b:
        return b.conn_active(channel, profile_id, active)
    return _update_conn(channel, profile_id, bool(active))


def conn_ping(channel, profile_id) -> bool:
    b = _rb()
    if b:
        return b.conn_ping(channel, profile_id)
    with _lock:
        rec = _conns.get(channel)
    return _update_conn(channel, profile_id, rec[1] if rec else True)


def conn_close(channel, profile_id) -> bool:
    b = _rb()
    if b:
        return b.conn_close(channel, profile_id)
    with _lock:
        _opened.pop(channel, None)
    return _update_conn(channel, profile_id, None)


def is_active(profile_id) -> bool:
    b = _rb()
    if b:
        return b.is_active(profile_id)
    now = time.monotonic()
    with _lock:
        for ch, (p, act, ts) in list(_conns.items()):
            if now - ts > STALE * 20:  # забытые соединения — выметаем
                _conns.pop(ch, None)
        return _active_locked(str(profile_id), now)


def conn_snapshot() -> list[tuple[str, str, bool, float, float]]:
    """(канал, профиль, на экране, секунд с пинга, секунд с открытия) по всем
    живым соединениям — для мониторинга (chat/metrics.py)."""
    b = _rb()
    if b:
        return b.conn_snapshot()
    now = time.monotonic()
    with _lock:
        rows = [(ch, p, act, now - ts, now - _opened[ch] if ch in _opened else None)
                for ch, (p, act, ts) in _conns.items()]
    return [(ch, p, act, age, since) for ch, p, act, age, since in rows if age < STALE]


def shown_online(profile) -> bool:
    """Что видят собеседники: «Скрыт» выглядит как «не в сети»."""
    return not getattr(profile, 'hide_online', False) and is_active(profile.id)


def shown_last_seen(profile):
    """Когда собеседник был на связи — или None, если показывать нельзя.

    «Скрыт» прячет и время: иначе настройка была бы половинчатой — человек
    вроде не в сети, а по времени видно, что только что заходил.
    """
    if getattr(profile, 'hide_online', False) or not getattr(profile, 'show_last_seen', True):
        return None
    return getattr(profile, 'last_seen', None)


def touch_last_seen(profile_id) -> None:
    """Отметить, что человек на связи. Пишем не чаще раза в минуту: иначе
    каждый пинг раз в 30 секунд бил бы в базу по строке на каждое устройство."""
    from django.utils import timezone
    from .models import Profile
    key = str(profile_id)
    b = _rb()
    if b:
        if not b.should_write_last_seen(key):
            return
    else:
        now = time.monotonic()
        with _lock:
            if now - _last_seen_write.get(key, 0) < 60:
                return
            _last_seen_write[key] = now
    Profile.objects.filter(id=profile_id).update(last_seen=timezone.now())


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
    b = _rb()
    if b:
        return b.rov_push_allowed(sender_id, target_id)
    key = (str(sender_id), str(target_id))
    now = time.monotonic()
    with _lock:
        last = _rov_push.get(key, 0.0)
        if now - last < ROV_PUSH_INTERVAL:
            return False
        _rov_push[key] = now
        return True


# ── По каким чатам ушёл пуш о сообщении ──────────────────────────────────────
# Прочитал чат (на любом устройстве) — его уведомления на телефонах надо
# убрать тихим пушем «chat_read». Слать его на каждое прочтение незачем:
# пока переписываешься в открытом чате, пушей и не было. Поэтому помним,
# кому по какому чату пуш уходил, и «прочитано» шлём только им.

_pushed: dict[tuple[str, str], float] = {}
PUSHED_TTL = 7 * 24 * 3600  # дольше уведомления на телефоне обычно не живут


def note_pushed(profile_ids, chat_id) -> None:
    b = _rb()
    if b:
        return b.note_pushed(profile_ids, chat_id)
    now = time.monotonic()
    with _lock:
        for pid in profile_ids:
            _pushed[(str(pid), str(chat_id))] = now + PUSHED_TTL


def was_pushed(profile_id, chat_id) -> bool:
    """Висит ли пуш по этому чату (с прошлого прочтения) — не забывая о нём:
    удалили сообщение — убрать его уведомление, но сам чат ещё не прочитан."""
    b = _rb()
    if b:
        return b.was_pushed(profile_id, chat_id)
    with _lock:
        until = _pushed.get((str(profile_id), str(chat_id)))
    return bool(until and until > time.monotonic())


def pushed_for(chat_id) -> list:
    """Кому по этому чату висит пуш — id профилей (для message_deleted)."""
    b = _rb()
    if b:
        return b.pushed_for(chat_id)
    now, cid = time.monotonic(), str(chat_id)
    with _lock:
        return [pid for (pid, c), until in _pushed.items() if c == cid and until > now]


def take_pushed(profile_id, chat_id) -> bool:
    """Был ли пуш по этому чату с прошлого прочтения (и забыть о нём)."""
    b = _rb()
    if b:
        return b.take_pushed(profile_id, chat_id)
    with _lock:
        until = _pushed.pop((str(profile_id), str(chat_id)), None)
    return bool(until and until > time.monotonic())
