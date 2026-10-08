"""Мониторинг: снимки онлайна и нагрузки раз в минуту + сводка для панели.

Онлайн живёт в памяти процесса daphne (presence.py: открытые сокеты), поэтому
сэмплер — поток в этом же процессе, его запускает sux_chat/asgi.py. В другом
процессе (manage.py shell, migrate) он не стартует и онлайн там всегда ноль.

Нагрузку читаем из /proc: loadavg, stat и meminfo в контейнере показывают
хост целиком (они не изолированы), а диск — корень, это тот же раздел хоста.

Всё, что можно посчитать задним числом (регистрации, сообщения, кто писал по
дням, звонки), считаем из базы и историю не храним. Хранятся только снимки,
которые иначе не восстановить: онлайн, сокеты, CPU, память.
"""
import logging
import os
import shutil
import threading
import time
from datetime import timedelta

from django.db import close_old_connections, connection
from django.utils import timezone

logger = logging.getLogger(__name__)

SAMPLE_EVERY = 60          # секунд между снимками
KEEP_DAYS = 120            # снимки старше — удаляем
_started = False
_start_lock = threading.Lock()
_t0 = time.time()          # когда поднялся процесс daphne


# ── система ──────────────────────────────────────────────────────────────────

def _cpu_times():
    try:
        with open("/proc/stat") as f:
            parts = [int(x) for x in f.readline().split()[1:]]
        idle = parts[3] + (parts[4] if len(parts) > 4 else 0)
        return sum(parts), idle
    except Exception:
        return None


def _cpu_pct(prev, cur):
    if not prev or not cur:
        return None
    total, idle = cur[0] - prev[0], cur[1] - prev[1]
    return round(100.0 * (total - idle) / total, 1) if total > 0 else None


def loadavg():
    try:
        with open("/proc/loadavg") as f:
            a = f.read().split()
        return [float(a[0]), float(a[1]), float(a[2])]
    except Exception:
        return None


def meminfo():
    """(занято, всего) в байтах; занято = всего − доступно."""
    try:
        vals = {}
        with open("/proc/meminfo") as f:
            for line in f:
                k, v = line.split(":", 1)
                vals[k] = int(v.split()[0]) * 1024
        total = vals["MemTotal"]
        return total - vals.get("MemAvailable", vals.get("MemFree", 0)), total
    except Exception:
        return None


def process_rss():
    try:
        with open("/proc/self/status") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    return int(line.split()[1]) * 1024
    except Exception:
        pass
    return None


def disk_usage():
    try:
        u = shutil.disk_usage("/")
        return u.used, u.total
    except Exception:
        return None


def db_size():
    try:
        with connection.cursor() as c:
            c.execute("SELECT pg_database_size(current_database())")
            return int(c.fetchone()[0])
    except Exception:
        return None


# ── онлайн ───────────────────────────────────────────────────────────────────

def presence_counts():
    """(на экране, на связи, сокетов) без ботов."""
    from . import presence
    from .models import Profile
    now = time.monotonic()
    with presence._lock:
        conns = list(presence._conns.values())
    fresh = [(p, act) for p, act, ts in conns if now - ts < presence.STALE]
    bots = {str(x) for x in Profile.objects.filter(is_bot=True).values_list("id", flat=True)}
    active = {p for p, act in fresh if act and p not in bots}
    connected = {p for p, _ in fresh if p not in bots}
    sockets = sum(1 for p, _ in fresh if p not in bots)
    return len(active), len(connected), sockets


def online_users(limit=300):
    """Кто сейчас на связи: ник, аватар, приложение на экране или в фоне,
    сколько устройств и сколько минут подряд. «Скрытые» тоже в списке —
    это панель админа, — но с пометкой. Боты не считаются."""
    from . import presence
    from .models import Profile
    now = time.monotonic()
    with presence._lock:
        conns = [(ch, p, act, ts, presence._opened.get(ch)) for ch, (p, act, ts) in presence._conns.items()]
    per = {}
    for ch, p, act, ts, opened in conns:
        if now - ts >= presence.STALE:
            continue
        u = per.setdefault(p, {"active": False, "devices": 0, "since": None})
        u["active"] = u["active"] or act
        u["devices"] += 1
        if opened is not None:
            u["since"] = opened if u["since"] is None else min(u["since"], opened)
    if not per:
        return []
    rows = Profile.objects.filter(id__in=list(per), is_bot=False).values("id", "username", "avatar_url", "hide_online", "role")
    out = []
    for r in rows:
        u = per[str(r["id"])]
        out.append({
            "id": str(r["id"]), "username": r["username"], "avatar_url": r["avatar_url"],
            "hidden": r["hide_online"], "role": r["role"],
            "active": u["active"], "devices": u["devices"],
            "online_s": int(now - u["since"]) if u["since"] is not None else None,
        })
    # На экране — выше, внутри — кто дольше в сети.
    out.sort(key=lambda x: (not x["active"], -(x["online_s"] or 0), x["username"].lower()))
    return out[:limit]


# ── сэмплер ──────────────────────────────────────────────────────────────────

def _loop():
    from .models import MetricSample
    prev = _cpu_times()
    last_cleanup = 0.0
    while True:
        # Ровно на границе минуты: точки разных дней ложатся друг на друга.
        time.sleep(SAMPLE_EVERY - (time.time() % SAMPLE_EVERY) + 0.5)
        try:
            close_old_connections()
            cur = _cpu_times()
            cpu = _cpu_pct(prev, cur)
            prev = cur
            active, connected, sockets = presence_counts()
            mem = meminfo()
            la = loadavg()
            MetricSample.objects.create(
                ts=timezone.now().replace(second=0, microsecond=0),
                online=active, connected=connected, sockets=sockets,
                cpu=cpu, mem=round(100.0 * mem[0] / mem[1], 1) if mem else None,
                load1=la[0] if la else None,
            )
            if time.time() - last_cleanup > 6 * 3600:
                last_cleanup = time.time()
                MetricSample.objects.filter(ts__lt=timezone.now() - timedelta(days=KEEP_DAYS)).delete()
        except Exception:
            logger.exception("metrics: снимок не записан")


def start_sampler():
    """Один поток на процесс. Зовёт asgi.py; повторный вызов ничего не делает."""
    global _started
    if os.environ.get("HYAX_METRICS_OFF"):
        return
    with _start_lock:
        if _started:
            return
        _started = True
    threading.Thread(target=_loop, name="metrics-sampler", daemon=True).start()
    logger.info("metrics: сэмплер запущен, шаг %s с", SAMPLE_EVERY)


# ── сводка для панели ────────────────────────────────────────────────────────

RANGES = {
    # окно, шаг корзины для графиков по времени (секунды)
    "24h": (timedelta(hours=24), 30 * 60),
    "7d": (timedelta(days=7), 3 * 3600),
    "30d": (timedelta(days=30), 12 * 3600),
}


def _bucket_counts(sql, params):
    with connection.cursor() as c:
        c.execute(sql, params)
        return {int(b): int(n) for b, n in c.fetchall()}


def summary(range_key="24h", tz_offset_min=0):
    from .models import Profile, Message, Chat, MetricSample, CallSession

    window, step = RANGES.get(range_key, RANGES["24h"])
    now = timezone.now()
    since = now - window
    off = int(tz_offset_min) * 60  # секунды к UTC → местное время клиента

    humans = Profile.objects.filter(is_bot=False)
    active, connected, sockets = presence_counts()
    mem, disk, la = meminfo(), disk_usage(), loadavg()
    latest = MetricSample.objects.order_by("-ts").first()

    # ---- онлайн и нагрузка по корзинам (из снимков) ----
    first_b = int(since.timestamp()) // step
    last_b = int(now.timestamp()) // step
    buckets = {b: {"on": [], "con": [], "cpu": [], "mem": []} for b in range(first_b, last_b + 1)}
    for ts, on, con, cpu, m in MetricSample.objects.filter(ts__gte=since).values_list("ts", "online", "connected", "cpu", "mem"):
        b = int(ts.timestamp()) // step
        if b in buckets:
            d = buckets[b]
            d["on"].append(on); d["con"].append(con)
            if cpu is not None: d["cpu"].append(cpu)
            if m is not None: d["mem"].append(m)

    msg_by_b = _bucket_counts(
        "SELECT floor(extract(epoch from created_at) / %s)::bigint AS b, count(*) FROM chat_message "
        "WHERE created_at >= %s AND deleted_for_all = false GROUP BY b",
        [step, since],
    )

    def avg(xs):
        return round(sum(xs) / len(xs), 1) if xs else None

    timeline = []
    for b, d in buckets.items():
        timeline.append({
            "t": b * step * 1000,
            "online_avg": avg(d["on"]),
            "online_max": max(d["on"]) if d["on"] else None,
            "cpu": avg(d["cpu"]),
            "mem": avg(d["mem"]),
            "messages": msg_by_b.get(b, 0),
        })

    # ---- по дням за 30 дней, в часовом поясе клиента ----
    day_since = now - timedelta(days=30)
    day = 86400
    regs = _bucket_counts(
        "SELECT floor((extract(epoch from created_at) + %s) / %s)::bigint AS d, count(*) FROM chat_profile "
        "WHERE created_at >= %s AND is_bot = false GROUP BY d",
        [off, day, day_since],
    )
    writers = _bucket_counts(
        "SELECT floor((extract(epoch from m.created_at) + %s) / %s)::bigint AS d, count(DISTINCT m.sender_id) "
        "FROM chat_message m JOIN chat_profile p ON p.id = m.sender_id "
        "WHERE m.created_at >= %s AND p.is_bot = false GROUP BY d",
        [off, day, day_since],
    )
    msgs_day = _bucket_counts(
        "SELECT floor((extract(epoch from created_at) + %s) / %s)::bigint AS d, count(*) FROM chat_message "
        "WHERE created_at >= %s AND deleted_for_all = false GROUP BY d",
        [off, day, day_since],
    )
    peak_day = {}
    for ts, on in MetricSample.objects.filter(ts__gte=day_since).values_list("ts", "online"):
        d = (int(ts.timestamp()) + off) // day
        peak_day[d] = max(peak_day.get(d, 0), on)
    d0, d1 = (int(day_since.timestamp()) + off) // day + 1, (int(now.timestamp()) + off) // day
    daily = [{
        # Полночь местного дня в UTC-миллисекундах: клиент подпишет датой.
        "t": (d * day - off) * 1000,
        "registrations": regs.get(d, 0),
        "writers": writers.get(d, 0),
        "messages": msgs_day.get(d, 0),
        "peak_online": peak_day.get(d),
    } for d in range(d0, d1 + 1)]

    # ---- по часам суток за 30 дней ----
    by_hour = _bucket_counts(
        "SELECT floor(mod(((extract(epoch from created_at) + %s) / 3600)::numeric, 24))::bigint AS h, count(*) "
        "FROM chat_message WHERE created_at >= %s AND deleted_for_all = false GROUP BY h",
        [off, day_since],
    )
    hours = [{"hour": h, "messages": by_hour.get(h, 0)} for h in range(24)]

    peak_24 = MetricSample.objects.filter(ts__gte=now - timedelta(hours=24)).order_by("-online", "-ts").values("online", "ts").first()
    peak_all = MetricSample.objects.order_by("-online", "-ts").values("online", "ts").first()
    first_sample = MetricSample.objects.order_by("ts").values_list("ts", flat=True).first()

    return {
        "now": now.isoformat(),
        "range": range_key if range_key in RANGES else "24h",
        "step_s": step,
        "live": {
            "online": active, "connected": connected, "sockets": sockets,
            "cpu": latest.cpu if latest else None,
            "load": la, "cores": os.cpu_count(),
            "mem_used": mem[0] if mem else None, "mem_total": mem[1] if mem else None,
            "disk_used": disk[0] if disk else None, "disk_total": disk[1] if disk else None,
            "rss": process_rss(), "db_size": db_size(),
            "uptime_s": int(time.time() - _t0),
            "sampling_since": first_sample.isoformat() if first_sample else None,
            "users_online": online_users(),
        },
        "totals": {
            "users": humans.count(),
            "users_24h": humans.filter(created_at__gte=now - timedelta(hours=24)).count(),
            "users_7d": humans.filter(created_at__gte=now - timedelta(days=7)).count(),
            "seen_24h": humans.filter(last_seen__gte=now - timedelta(hours=24)).count(),
            "seen_7d": humans.filter(last_seen__gte=now - timedelta(days=7)).count(),
            "seen_30d": humans.filter(last_seen__gte=now - timedelta(days=30)).count(),
            "bots": Profile.objects.filter(is_bot=True).count(),
            "messages": Message.objects.filter(deleted_for_all=False).count(),
            "messages_24h": Message.objects.filter(created_at__gte=now - timedelta(hours=24), deleted_for_all=False).count(),
            "chats_direct": Chat.objects.filter(kind="direct").count(),
            "chats_group": Chat.objects.filter(kind="group").count(),
            "channels": Chat.objects.filter(kind="channel").count(),
            "calls_24h": CallSession.objects.filter(created_at__gte=now - timedelta(hours=24)).count(),
            "peak_24h": peak_24["online"] if peak_24 else None,
            "peak_24h_at": peak_24["ts"].isoformat() if peak_24 else None,
            "peak_all": peak_all["online"] if peak_all else None,
            "peak_all_at": peak_all["ts"].isoformat() if peak_all else None,
        },
        "timeline": timeline,
        "daily": daily,
        "hours": hours,
    }


def registrations(date_from, date_to, tz_offset_min=0):
    """Регистрации людей (без ботов) с date_from по date_to включительно —
    даты в часовом поясе клиента. Число, разбивка по дням и последние ники."""
    from datetime import datetime, time as dtime, timezone as dtz
    from .models import Profile
    off = timedelta(minutes=int(tz_offset_min))
    start = datetime.combine(date_from, dtime.min).replace(tzinfo=dtz.utc) - off
    end = datetime.combine(date_to, dtime.min).replace(tzinfo=dtz.utc) - off + timedelta(days=1)
    qs = Profile.objects.filter(is_bot=False, created_at__gte=start, created_at__lt=end)
    # Длинный период — по месяцам, иначе столбики сливаются в шум.
    monthly = (date_to - date_from).days > 92
    bucket = (lambda d: d.replace(day=1)) if monthly else (lambda d: d)
    days = {}
    for ts in qs.values_list("created_at", flat=True):
        d = bucket((ts + off).date())
        days[d] = days.get(d, 0) + 1
    out_days, d = [], bucket(date_from)
    while d <= date_to and len(out_days) < 400:
        out_days.append({"date": d.isoformat(), "count": days.get(d, 0)})
        d = (d.replace(day=28) + timedelta(days=4)).replace(day=1) if monthly else d + timedelta(days=1)
    users = [{"username": u, "created_at": c.isoformat()} for u, c in qs.order_by("-created_at").values_list("username", "created_at")[:100]]
    return {"from": date_from.isoformat(), "to": date_to.isoformat(), "count": qs.count(),
            "unit": "month" if monthly else "day", "days": out_days, "users": users}
