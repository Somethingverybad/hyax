"""Присутствие в Redis — та же картина для всех процессов api.

Зеркало chat/presence.py для случая, когда api работает несколькими
процессами (gunicorn с воркерами uvicorn, см. docker-compose): сокет человека
живёт в одном процессе, а HTTP-запрос «слать ли пуш» приходит в другой.
Поэтому «кто какой чат смотрит», «кто на связи» и «кому ушёл пуш» лежат в
Redis. Включается настройкой REDIS_URL (sux_chat/settings.py); без неё
presence.py работает в памяти процесса, как раньше.

Ключи (все с TTL, чтобы ничего не копилось):
  pres:view:<chat>        hash  «профиль|устройство» → до какого момента смотрит
  pres:viewkey:<п|у>      str   какой чат смотрит это устройство (чтобы снять
                                отметку с прошлого чата при переключении)
  pres:viewdevs:<профиль> set   устройства профиля с отметками (снять все разом)
  pres:prof:<профиль>     hash  канал сокета → «на экране|пинг|открыт»
  pres:lsw:<профиль>      str   last_seen в базу писали меньше минуты назад
  pres:rov:<кто>:<кому>   str   пуш о Р.Ё.В уже уходил в эту минуту
  pres:pushed:<chat>      hash  профиль → до какого момента висит его пуш

Если Redis не отвечает, присутствие деградирует безопасно: «никто не смотрит»
(пуш уйдёт лишний раз), «не в сети», «пуш разрешён» — а не ошибка 500.
"""
import functools
import logging
import time

logger = logging.getLogger(__name__)

_FAIL_LOG_EVERY = 60
_last_fail_log = 0.0


def _safe(default):
    """Ошибка Redis — в лог (не чаще раза в минуту) и значение по умолчанию."""
    def deco(fn):
        @functools.wraps(fn)
        def wrap(self, *a, **k):
            global _last_fail_log
            try:
                return fn(self, *a, **k)
            except Exception:
                now = time.time()
                if now - _last_fail_log > _FAIL_LOG_EVERY:
                    _last_fail_log = now
                    logger.exception("presence: Redis недоступен — %s", fn.__name__)
                return default() if callable(default) else default
        return wrap
    return deco


class RedisPresence:
    def __init__(self, client, ttl, ttl_min, ttl_max, stale, rov_interval, pushed_ttl):
        self.r = client
        self.TTL, self.TTL_MIN, self.TTL_MAX, self.STALE = ttl, ttl_min, ttl_max, stale
        self.ROV_PUSH_INTERVAL, self.PUSHED_TTL = rov_interval, pushed_ttl

    # ── какой чат открыт ──────────────────────────────────────────────────
    @staticmethod
    def _vk(profile_id, device_id) -> str:
        return f"{profile_id}|{device_id or ''}"

    def _unmark(self, pipe, key):
        prev = self.r.get(f"pres:viewkey:{key}")
        if prev:
            pipe.hdel(f"pres:view:{prev}", key)
        pipe.delete(f"pres:viewkey:{key}")

    @_safe(None)
    def set_viewing(self, profile_id, chat_id, ttl=None, device_id=None):
        key = self._vk(profile_id, device_id)
        try:
            life = min(self.TTL_MAX, max(self.TTL_MIN, int(ttl))) if ttl else self.TTL
        except (TypeError, ValueError):
            life = self.TTL
        pipe = self.r.pipeline(transaction=False)
        if chat_id:
            chat = str(chat_id)
            prev = self.r.get(f"pres:viewkey:{key}")
            if prev and prev != chat:
                pipe.hdel(f"pres:view:{prev}", key)
            pipe.hset(f"pres:view:{chat}", key, repr(time.time() + life))
            pipe.expire(f"pres:view:{chat}", self.TTL_MAX + 5)
            pipe.set(f"pres:viewkey:{key}", chat, ex=life + 5)
            pipe.sadd(f"pres:viewdevs:{profile_id}", key)
            pipe.expire(f"pres:viewdevs:{profile_id}", self.TTL_MAX + 5)
        elif device_id:
            self._unmark(pipe, key)
            pipe.srem(f"pres:viewdevs:{profile_id}", key)
        else:
            # Без устройства — снимаем все отметки профиля (старый клиент, разрыв сокета).
            for k in self.r.smembers(f"pres:viewdevs:{profile_id}"):
                self._unmark(pipe, k)
            pipe.delete(f"pres:viewdevs:{profile_id}")
        pipe.execute()

    @_safe(dict)
    def viewing_devices(self, chat_id) -> dict[str, set[str]]:
        now = time.time()
        out: dict[str, set[str]] = {}
        stale = []
        for key, until in self.r.hgetall(f"pres:view:{chat_id}").items():
            try:
                if float(until) <= now:
                    stale.append(key)
                    continue
            except ValueError:
                stale.append(key)
                continue
            p, _, d = key.partition("|")
            out.setdefault(p, set()).add(d)
        if stale:
            self.r.hdel(f"pres:view:{chat_id}", *stale)
        return out

    def viewers(self, chat_id) -> set[str]:
        return set(self.viewing_devices(chat_id))

    # ── соединения ────────────────────────────────────────────────────────
    def _conns(self, profile_id) -> dict[str, tuple[bool, float, float]]:
        """канал → (на экране, пинг, открыт) — живые записи профиля."""
        out = {}
        for ch, v in self.r.hgetall(f"pres:prof:{profile_id}").items():
            try:
                act, ts, opened = v.split("|")
                out[ch] = (act == "1", float(ts), float(opened))
            except ValueError:
                continue
        return out

    def _active_in(self, conns, now) -> bool:
        return any(act and now - ts < self.STALE for act, ts, _ in conns.values())

    def _update(self, channel, profile_id, active, opened=None) -> bool:
        key = f"pres:prof:{profile_id}"
        now = time.time()
        conns = self._conns(str(profile_id))
        before = self._active_in(conns, now)
        pipe = self.r.pipeline(transaction=False)
        if active is None:
            conns.pop(channel, None)
            pipe.hdel(key, channel)
        else:
            was = conns.get(channel)
            since = opened if opened is not None else (was[2] if was else now)
            conns[channel] = (bool(active), now, since)
            pipe.hset(key, channel, f"{1 if active else 0}|{now!r}|{since!r}")
            pipe.expire(key, self.STALE * 20)
        pipe.execute()
        return before != self._active_in(conns, now)

    @_safe(False)
    def conn_open(self, channel, profile_id) -> bool:
        return self._update(channel, profile_id, True, opened=time.time())

    @_safe(False)
    def conn_active(self, channel, profile_id, active) -> bool:
        return self._update(channel, profile_id, bool(active))

    @_safe(False)
    def conn_ping(self, channel, profile_id) -> bool:
        rec = self._conns(str(profile_id)).get(channel)
        return self._update(channel, profile_id, rec[0] if rec else True)

    @_safe(False)
    def conn_close(self, channel, profile_id) -> bool:
        return self._update(channel, profile_id, None)

    @_safe(False)
    def is_online(self, profile_id) -> bool:
        """Есть ли живой сокет (пинг не старше STALE) — доедет ли событие живьём."""
        now = time.time()
        return any(now - ts < self.STALE for _, ts, _ in self._conns(str(profile_id)).values())

    @_safe(False)
    def is_active(self, profile_id) -> bool:
        return self._active_in(self._conns(str(profile_id)), time.time())

    @_safe(list)
    def conn_snapshot(self) -> list[tuple[str, str, bool, float, float]]:
        """(канал, профиль, на экране, секунд с пинга, секунд с открытия) по
        всем живым соединениям — для мониторинга."""
        now = time.time()
        keys = list(self.r.scan_iter(match="pres:prof:*", count=500))
        if not keys:
            return []
        pipe = self.r.pipeline(transaction=False)
        for k in keys:
            pipe.hgetall(k)
        out = []
        for k, conns in zip(keys, pipe.execute()):
            p = k.split("pres:prof:", 1)[1]
            for ch, v in conns.items():
                try:
                    act, ts, opened = v.split("|")
                    ts, opened = float(ts), float(opened)
                except ValueError:
                    continue
                if now - ts < self.STALE:
                    out.append((ch, p, act == "1", now - ts, now - opened))
        return out

    @_safe(False)
    def should_write_last_seen(self, profile_id) -> bool:
        return bool(self.r.set(f"pres:lsw:{profile_id}", "1", nx=True, ex=60))

    # ── пуши ──────────────────────────────────────────────────────────────
    @_safe(True)
    def rov_push_allowed(self, sender_id, target_id) -> bool:
        return bool(self.r.set(f"pres:rov:{sender_id}:{target_id}", "1", nx=True, ex=self.ROV_PUSH_INTERVAL))

    @_safe(None)
    def note_pushed(self, profile_ids, chat_id) -> None:
        ids = [str(p) for p in profile_ids]
        if not ids:
            return
        until = repr(time.time() + self.PUSHED_TTL)
        pipe = self.r.pipeline(transaction=False)
        pipe.hset(f"pres:pushed:{chat_id}", mapping={p: until for p in ids})
        pipe.expire(f"pres:pushed:{chat_id}", self.PUSHED_TTL)
        pipe.execute()

    @staticmethod
    def _live(until) -> bool:
        try:
            return bool(until) and float(until) > time.time()
        except ValueError:
            return False

    @_safe(False)
    def was_pushed(self, profile_id, chat_id) -> bool:
        return self._live(self.r.hget(f"pres:pushed:{chat_id}", str(profile_id)))

    @_safe(list)
    def pushed_for(self, chat_id) -> list:
        return [p for p, until in self.r.hgetall(f"pres:pushed:{chat_id}").items() if self._live(until)]

    @_safe(False)
    def take_pushed(self, profile_id, chat_id) -> bool:
        pipe = self.r.pipeline(transaction=False)
        pipe.hget(f"pres:pushed:{chat_id}", str(profile_id))
        pipe.hdel(f"pres:pushed:{chat_id}", str(profile_id))
        until, _ = pipe.execute()
        return self._live(until)
