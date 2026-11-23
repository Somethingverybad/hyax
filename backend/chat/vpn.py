"""«Сеть WYX» — свой VPN-клиент для друзей: раздача узлов и приём отчётов.

Зачем: публичные клиенты банят по названию, а адреса серверов — по списку.
Свой клиент получает подписанный список узлов отсюда (hyax.ru / cdn.hyax.ru —
их не заблокируют), сам выбирает живой и переключается, когда узел умер.
Сами серверы xray живут на crystal (панель 3x-ui, /home/vpn/README.md там);
здесь только управление: кому выдан доступ (VpnAccess, свой UUID каждому),
какие узлы есть (VpnNode) и живы ли они из России (manage.py vpn_probe).

  GET  /api/vpn/profile/   — узлы и мой UUID, подпись Ed25519 (VPN_SIGN_KEY)
  POST /api/vpn/report/    — отчёты клиента о подключениях (только здоровье)
  GET/PUT /api/vpn/direct/ — что пускать мимо туннеля (российские сайты, свои адреса)
  POST /api/vpn/direct/share/ {username} — поделиться ими через бота «Бупень»

Подпись: поле payload — строка с каноническим JSON (sort_keys, без
пробелов); подписываются ровно её байты, клиент проверяет строку как есть и
только потом разбирает (никакой своей канонизации на стороне клиента). Ключ —
32 байта seed в base64 в VPN_SIGN_KEY; публичный ключ (manage.py vpn_pubkey)
зашит в клиент. Без ключа в окружении ответ без подписи (локальный стенд),
клиент в бою такой не примет.
"""
import base64
import json
import logging
import os
from datetime import timedelta

from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import VpnAccess, VpnNode, VpnReport

log = logging.getLogger(__name__)

PROFILE_TTL = 300          # секунд: как часто клиенту перечитывать список
REPORT_MAX = 200           # отчётов за один запрос
REPORT_KEEP_DAYS = 7


def _signer():
    """(private_key, public_b64) из VPN_SIGN_KEY или (None, '')."""
    seed = os.getenv("VPN_SIGN_KEY", "").strip()
    if not seed:
        return None, ""
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    key = Ed25519PrivateKey.from_private_bytes(base64.b64decode(seed))
    pub = key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return key, base64.b64encode(pub).decode()


def canonical(payload) -> bytes:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def sign(payload):
    """Подписанный конверт: {payload: str, sig, pub}. sig пустой, если ключа нет."""
    text = canonical(payload)
    key, pub = _signer()
    if not key:
        return {"payload": text.decode(), "sig": "", "pub": ""}
    return {"payload": text.decode(), "sig": base64.b64encode(key.sign(text)).decode(), "pub": pub}


def node_payload(n: VpnNode):
    d = {
        "id": n.slug, "name": n.name, "kind": n.kind, "host": n.host, "port": n.port, "sni": n.sni or n.host,
        "ips": [x.strip() for x in (n.ips or "").split(",") if x.strip()],
        "weight": n.weight, "ok": n.ok, "rtt_ms": n.rtt_ms,
        "checked_at": n.checked_at.isoformat() if n.checked_at else None,
    }
    if n.kind == VpnNode.KIND_REALITY:
        d.update({"pbk": n.public_key, "sid": n.short_id, "fp": n.fingerprint or "chrome", "flow": n.flow})
    else:
        d.update({"path": n.path, "mode": n.mode or "auto", "alpn": [a.strip() for a in (n.alpn or "h2").split(",") if a.strip()]})
    return d


# Куда ходить напрямую, мимо узла: сам WYX и его хранилища — они в России, через
# Нидерланды и обратно только медленнее (и профиль не должен зависеть от живого узла).
# Домены — правилом ядра (по SNI/Host), адреса — исключением из туннеля на уровне системы.
DIRECT_DOMAINS_DEFAULT = (
    "hyax.ru,wyx.su,huyax.e-tree.su,storage.yandexcloud.net,"
    "43fb9b03-c74c-45ab-b258-7872345451b3.selcdn.net"
)
_direct_cache = {"at": None, "value": None}


def direct_domains():
    raw = os.getenv("VPN_DIRECT_DOMAINS", DIRECT_DOMAINS_DEFAULT)
    return [d.strip().lower().strip(".") for d in raw.split(",") if d.strip()]


def direct_payload():
    """{domains, cidrs}: домены и их адреса, как их видит DNS из Москвы (кэш 10 минут)."""
    now = timezone.now()
    c = _direct_cache
    if c["value"] is not None and c["at"] and now - c["at"] < timedelta(minutes=10):
        return c["value"]
    import ipaddress
    import socket
    domains = direct_domains()
    cidrs = set()
    for extra in os.getenv("VPN_DIRECT_CIDRS", "").split(","):
        if extra.strip():
            try:
                cidrs.add(str(ipaddress.ip_network(extra.strip(), strict=False)))
            except ValueError:
                pass
    for d in domains:
        try:
            for fam, _, _, _, sa in socket.getaddrinfo(d, 443, proto=socket.IPPROTO_TCP):
                ip = ipaddress.ip_address(sa[0])
                if ip.is_global:
                    cidrs.add(f"{ip}/{32 if ip.version == 4 else 128}")
        except OSError:
            pass
    value = {"domains": domains, "cidrs": sorted(cidrs)}
    c["at"], c["value"] = now, value
    return value


# --- Российские сайты напрямую + свои адреса человека ---------------------------
# На NL (crystal) те же адреса уходят через российский релей (/home/vpn/xray/
# routed-domains.txt, его пополняет routebot); в Бупене их можно пускать прямо с
# устройства — тот же российский IP, только быстрее. NL раз в 10 минут копирует
# файл в /home/vpn/web/bypen/ru-direct.txt (cron), отсюда он и берётся.
# geosite/geoip на клиенты не тащим: базы большие, VPN-расширению iPhone не по памяти.
RU_ZONES = ["ru", "su", "xn--p1ai", "moscow"]          # .рф = xn--p1ai
RU_LIST_URL_DEFAULT = "https://nemilf.hyax.ru/bypen/ru-direct.txt"
# Снимок routed-domains.txt на 23.11.2026 — пока ссылка недоступна.
RU_LIST_SNAPSHOT = (
    "sberbank.ru sber.ru ozon.ru ozonusercontent.com o3.ru wildberries.ru wb.ru wbbasket.ru wbstatic.net "
    "hh.ru yandex.ru ya.ru yandex.net yandex.com yastatic.net yandex.st vk.com vk.ru vkvideo.ru "
    "vkuserlive.com mts.ru tbank.ru tinkoff.ru kinopoisk.ru kinopoiskhd.ru samokat.ru rustore.ru vtb.ru "
    "avito.ru alfabank.ru 2gis.ru 2gis.com megamarket.ru max.ru rutube.ru ok.ru rocket.hunterhelp.ru "
    "animego.me aniboom.one aderom.net malsed.site videoroll.net s1.kalarona.org walking-dead.vip kalarona.org"
).split()
CUSTOM_MAX = 200
_ru_cache = {"at": None, "value": None}


def normalize_entry(raw):
    """Строка человека → запись списка или None.
    example.com / *.example.com / .example.com → «example.com» (домен и поддомены — суффикс);
    .ru / ru → «ru» (вся зона); =example.com или full:example.com → «full:example.com» (только он);
    domain:x — как x. Кириллица → punycode. Адреса и мусор — None."""
    s = str(raw or "").strip().lower()
    if not s or len(s) > 253:
        return None
    full = False
    if s.startswith("full:"):
        full, s = True, s[5:]
    elif s.startswith("="):
        full, s = True, s[1:]
    elif s.startswith("domain:"):
        s = s[7:]
    for pre in ("https://", "http://"):
        if s.startswith(pre):
            s = s[len(pre):]
    s = s.split("/", 1)[0].split(":", 1)[0].strip()
    while s.startswith("*.") or s.startswith("."):
        s = s[2:] if s.startswith("*.") else s[1:]
    s = s.rstrip(".")
    if not s:
        return None
    try:
        s = s.encode("idna").decode("ascii")
    except UnicodeError:
        return None
    import re
    if not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*", s):
        return None
    if re.fullmatch(r"[0-9.]+", s):      # IP — не домен
        return None
    return f"full:{s}" if full else s


def parse_list(text):
    """Формат routed-domains.txt: строка — домен, # — комментарий; regexp/geosite/ext/keyword пропускаем."""
    out = []
    for line in str(text or "").splitlines():
        line = line.split("#", 1)[0].strip()
        if not line or line.startswith(("regexp:", "geosite:", "ext:", "keyword:", "geoip:")):
            continue
        e = normalize_entry(line)
        if e and e not in out:
            out.append(e)
    return out


def ru_list():
    """Домены с NL (кэш 10 минут; не скачалось — прежний или снимок) плюс зоны."""
    now = timezone.now()
    c = _ru_cache
    if c["value"] is None or not c["at"] or now - c["at"] > timedelta(minutes=10):
        domains = None
        url = os.getenv("VPN_RU_LIST_URL", RU_LIST_URL_DEFAULT).strip()
        if url:
            try:
                import urllib.request
                req = urllib.request.Request(url, headers={"User-Agent": "hyax-vpn"})
                with urllib.request.urlopen(req, timeout=5) as r:
                    if r.status == 200:
                        domains = parse_list(r.read(512 * 1024).decode("utf-8", "replace")) or None
            except Exception as e:
                log.info("vpn: список RU с NL не скачался (%s) — беру прежний", e)
        if domains is None:
            domains = c["value"] or [d for d in (normalize_entry(x) for x in RU_LIST_SNAPSHOT) if d]
        c["at"], c["value"] = now, domains
    return RU_ZONES + [d for d in c["value"] if d not in RU_ZONES]


def direct_for(acc):
    """Что пускать мимо туннеля этому человеку: WYX + (российские) + свои."""
    base = direct_payload()
    domains = list(base["domains"])
    extra = (ru_list() if acc.direct_ru else []) + list(acc.direct_custom or [])
    for d in extra:
        if d not in domains:
            domains.append(d)
    return {"domains": domains, "cidrs": base["cidrs"]}


class VpnDirectView(APIView):
    """Настройки «напрямую» — в профиле WYX, одни на все устройства человека.
    GET → {ru, custom, ru_count}; PUT/POST {ru?, custom?: [строки]} → то же (custom нормализован)."""
    permission_classes = [permissions.IsAuthenticated]

    def _out(self, acc):
        return {"ru": acc.direct_ru, "custom": list(acc.direct_custom or []), "ru_count": len(ru_list())}

    def get(self, request):
        acc = access_for(request)
        if not acc:
            return Response({"detail": "Доступ к сети WYX не выдан"}, status=403)
        return Response(self._out(acc))

    def put(self, request):
        acc = access_for(request)
        if not acc:
            return Response({"detail": "Доступ к сети WYX не выдан"}, status=403)
        d = request.data if isinstance(request.data, dict) else {}
        fields = []
        if "ru" in d:
            acc.direct_ru = bool(d.get("ru"))
            fields.append("direct_ru")
        if "custom" in d:
            raw = d.get("custom")
            if isinstance(raw, str):
                raw = raw.replace(",", "\n").splitlines()
            if not isinstance(raw, list):
                return Response({"detail": "custom — список строк"}, status=400)
            out, bad = [], []
            for x in raw:
                if not str(x or "").strip():
                    continue
                e = normalize_entry(x)
                if e is None:
                    bad.append(str(x)[:80])
                elif e not in out:
                    out.append(e)
            if bad:
                return Response({"detail": "Не похоже на домен: " + ", ".join(bad[:5]), "bad": bad}, status=400)
            if len(out) > CUSTOM_MAX:
                return Response({"detail": f"Не больше {CUSTOM_MAX} адресов"}, status=400)
            acc.direct_custom = out
            fields.append("direct_custom")
        if fields:
            acc.save(update_fields=fields)
        return Response(self._out(acc))

    post = put


# --- «Поделиться» настройками по логину WYX ----------------------------------------
# Снимок настроек отправителя ждёт в VpnDirectShare; бот «Бупень» пишет получателю
# «@x отправил вам настройки маршрутизации» с кнопками «Принять» (bd:y:<id>) и
# «Отклонить» (bd:n:<id>). Принять — свои адреса добавляются к его, тумблер российских
# ставится как у отправителя. Отправителю бот сообщает, чем кончилось.
SHARE_PER_10MIN = 5
SHARE_PREVIEW = 12


def _share_text(share):
    items = [("= " + e[5:]) if e.startswith("full:") else (e if "." in e else "." + e) for e in share.custom]
    lines = [f"Настройки маршрутизации от @{share.sender.username}", "",
             f"@{share.sender.username} отправил(а) вам настройки «Напрямую, мимо VPN» для Бупеня:",
             f"• Российские сайты напрямую: {'вкл' if share.ru else 'выкл'}"]
    if items:
        shown = ", ".join(items[:SHARE_PREVIEW]) + (f" и ещё {len(items) - SHARE_PREVIEW}" if len(items) > SHARE_PREVIEW else "")
        lines.append(f"• Свои адреса ({len(items)}): {shown}")
    else:
        lines.append("• Своих адресов нет")
    lines += ["", "Если примете, адреса добавятся к вашим, а российские сайты будут как у отправителя."]
    return "\n".join(lines)


class VpnDirectShareView(APIView):
    """POST {username} — отправить свои настройки «напрямую» другому человеку через бота."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        acc = access_for(request)
        if not acc:
            return Response({"detail": "Доступ к сети WYX не выдан"}, status=403)
        from .bypen_login import _find_profile, bot_say
        from .models import VpnDirectShare
        d = request.data if isinstance(request.data, dict) else {}
        to = _find_profile(str(d.get("username") or ""))
        if not to:
            return Response({"detail": "Нет такого аккаунта WYX — проверьте ник"}, status=404)
        if to.id == acc.profile_id:
            return Response({"detail": "Это вы сами"}, status=400)
        from .moderation import blocked_either_way
        if blocked_either_way(acc.profile_id, to.id):
            return Response({"detail": "Этому человеку отправить нельзя"}, status=403)
        since = timezone.now() - timedelta(minutes=10)
        if VpnDirectShare.objects.filter(sender_id=acc.profile_id, created_at__gte=since).count() >= SHARE_PER_10MIN:
            return Response({"detail": "Слишком часто — попробуйте через 10 минут"}, status=429)
        share = VpnDirectShare.objects.create(sender=acc.profile, recipient=to, ru=acc.direct_ru,
                                              custom=list(acc.direct_custom or []))
        m = bot_say(to, _share_text(share), [[{"text": "✅ Принять", "data": f"bd:y:{share.id}"},
                                               {"text": "Отклонить", "data": f"bd:n:{share.id}"}]])
        VpnDirectShare.objects.filter(pk=share.pk).update(message=m)
        log.info("vpn: %s отправил настройки «напрямую» %s (%d адресов)", acc.profile.username, to.username, len(share.custom))
        return Response({"ok": True, "username": to.username})


def handle_share_press(msg, profile, accept, share_id, request=None):
    """«Принять»/«Отклонить» под сообщением бота. Ответ клиенту WYX: {ok, toast?, message?}."""
    from .bypen_login import bot_say, edit_message
    from .models import VpnDirectShare
    from .serializers import MessageSerializer
    share = VpnDirectShare.objects.select_related("sender", "message").filter(pk=share_id).first() if len(share_id) == 36 else None
    if not share or share.message_id != msg.id or share.recipient_id != profile.id:
        return {"error": "Такой кнопки нет"}
    out = {"ok": True}
    now = timezone.now()
    new = VpnDirectShare.ACCEPTED if accept else VpnDirectShare.DECLINED
    if not VpnDirectShare.objects.filter(pk=share.pk, status=VpnDirectShare.PENDING).update(status=new, decided_at=now):
        out.update(toast="Уже обработано", toast_kind="error")
    elif accept:
        acc, _ = VpnAccess.objects.get_or_create(profile=profile)
        merged = list(acc.direct_custom or [])
        for e in share.custom:
            if e not in merged:
                merged.append(e)
        acc.direct_custom, acc.direct_ru = merged[:CUSTOM_MAX], share.ru
        acc.save(update_fields=["direct_custom", "direct_ru"])
        edit_message(share.message, f"✅ Настройки от @{share.sender.username} приняты\n"
                                    f"Российские сайты напрямую: {'вкл' if share.ru else 'выкл'}, своих адресов теперь {len(acc.direct_custom)}. "
                                    "Бупень подхватит их при следующем обновлении списка узлов или после переподключения.")
        bot_say(share.sender, f"✅ @{profile.username} принял(а) ваши настройки маршрутизации")
        out.update(toast="Настройки приняты", toast_kind="success")
    else:
        edit_message(share.message, f"Настройки от @{share.sender.username} отклонены")
        bot_say(share.sender, f"@{profile.username} отклонил(а) ваши настройки маршрутизации")
        out.update(toast="Отклонено", toast_kind="success")
    msg.refresh_from_db()
    out["message"] = MessageSerializer(msg, context={"request": request}).data
    return out


def auto_access() -> bool:
    """Доступ всем зарегистрированным («пусть автоматом будут у всех, кто в WYX регается»);
    VPN_AUTO_ACCESS=0 — только выданные руками."""
    return os.getenv("VPN_AUTO_ACCESS", "1").strip() not in ("0", "false", "no")


def access_for(request):
    profile = getattr(request.user, "profile", None)
    if profile is None:
        return None
    try:
        acc = profile.vpn_access
    except VpnAccess.DoesNotExist:
        if not auto_access():
            return None
        acc, created = VpnAccess.objects.get_or_create(profile=profile)
        if created:
            log.info("vpn: доступ выдан автоматически: %s", profile.username)
            from .vpn_xui import sync_soon
            sync_soon()
    return acc if acc.enabled else None


class VpnProfileView(APIView):
    """Список узлов для этого человека: живые первыми, мёртвые в хвосте
    (клиент попробует их последними — пробник в Москве может ошибаться
    про чужую сеть)."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        acc = access_for(request)
        if not acc:
            return Response({"detail": "Доступ к сети WYX не выдан"}, status=403)
        nodes = list(VpnNode.objects.filter(enabled=True))
        nodes.sort(key=lambda n: (not n.ok, -n.weight, n.rtt_ms if n.rtt_ms is not None else 10**6))
        app = str(request.headers.get("X-WYX-App") or "")[:80]
        VpnAccess.objects.filter(pk=acc.pk).update(last_seen_at=timezone.now(), **({"last_app": app} if app else {}))
        payload = {
            "v": 1,
            "issued_at": timezone.now().isoformat(),
            "ttl": PROFILE_TTL,
            "user": {"id": str(acc.profile_id), "username": acc.profile.username, "uuid": str(acc.uuid), "email": acc.email},
            "nodes": [node_payload(n) for n in nodes],
            "direct": direct_for(acc),
        }
        return Response(sign(payload))


class VpnReportView(APIView):
    """{events: [{node, ok, rtt_ms?, error?, at?, net?}]}, app — в заголовке X-WYX-App."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        acc = access_for(request)
        if not acc:
            return Response({"detail": "Доступ к сети WYX не выдан"}, status=403)
        events = request.data.get("events") if isinstance(request.data, dict) else None
        if not isinstance(events, list):
            return Response({"detail": "events — список"}, status=400)
        app = str(request.headers.get("X-WYX-App") or request.data.get("app") or "")[:80]
        by_slug = {n.slug: n for n in VpnNode.objects.all()}
        rows = []
        now = timezone.now()
        for e in events[:REPORT_MAX]:
            if not isinstance(e, dict):
                continue
            at = parse_datetime(str(e.get("at") or "")) or now
            if at > now + timedelta(minutes=5) or at < now - timedelta(days=REPORT_KEEP_DAYS):
                at = now
            rtt = e.get("rtt_ms")
            rows.append(VpnReport(
                access=acc, node=by_slug.get(str(e.get("node") or "")), ok=bool(e.get("ok")),
                rtt_ms=int(rtt) if isinstance(rtt, (int, float)) and 0 <= rtt < 10**6 else None,
                error=str(e.get("error") or "")[:200], net=str(e.get("net") or "")[:16], app=app, at=at,
            ))
        if rows:
            VpnReport.objects.bulk_create(rows)
        VpnAccess.objects.filter(pk=acc.pk).update(last_seen_at=now, **({"last_app": app} if app else {}))
        return Response({"saved": len(rows)})


def prune_reports():
    VpnReport.objects.filter(at__lt=timezone.now() - timedelta(days=REPORT_KEEP_DAYS)).delete()
