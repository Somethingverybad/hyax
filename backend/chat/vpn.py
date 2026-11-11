"""«Сеть WYX» — свой VPN-клиент для друзей: раздача узлов и приём отчётов.

Зачем: публичные клиенты банят по названию, а адреса серверов — по списку.
Свой клиент получает подписанный список узлов отсюда (hyax.ru / cdn.hyax.ru —
их не заблокируют), сам выбирает живой и переключается, когда узел умер.
Сами серверы xray живут на crystal (панель 3x-ui, /home/vpn/README.md там);
здесь только управление: кому выдан доступ (VpnAccess, свой UUID каждому),
какие узлы есть (VpnNode) и живы ли они из России (manage.py vpn_probe).

  GET  /api/vpn/profile/   — узлы и мой UUID, подпись Ed25519 (VPN_SIGN_KEY)
  POST /api/vpn/report/    — отчёты клиента о подключениях (только здоровье)

Подпись: канонический JSON (sort_keys, без пробелов) поля payload, ключ —
32 байта seed в base64 в VPN_SIGN_KEY; публичный ключ зашит в клиент. Без
ключа в окружении ответ без подписи (локальный стенд), клиент в бою такой
не примет.
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
    """Подписанный конверт: {payload, sig, pub}. sig пустой, если ключа нет."""
    key, pub = _signer()
    if not key:
        return {"payload": payload, "sig": "", "pub": ""}
    return {"payload": payload, "sig": base64.b64encode(key.sign(canonical(payload))).decode(), "pub": pub}


def node_payload(n: VpnNode):
    d = {
        "id": n.slug, "name": n.name, "kind": n.kind, "host": n.host, "port": n.port, "sni": n.sni or n.host,
        "weight": n.weight, "ok": n.ok, "rtt_ms": n.rtt_ms,
        "checked_at": n.checked_at.isoformat() if n.checked_at else None,
    }
    if n.kind == VpnNode.KIND_REALITY:
        d.update({"pbk": n.public_key, "sid": n.short_id, "fp": n.fingerprint or "chrome", "flow": n.flow})
    else:
        d.update({"path": n.path, "mode": n.mode or "auto", "alpn": [a.strip() for a in (n.alpn or "h2").split(",") if a.strip()]})
    return d


def access_for(request):
    try:
        acc = request.user.profile.vpn_access
    except (VpnAccess.DoesNotExist, AttributeError):
        return None
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
