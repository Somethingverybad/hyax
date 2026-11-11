"""Пробник узлов «Сети WYX» из Москвы: раз в минуту проверяет каждый узел
и пишет ok/rtt_ms в VpnNode — клиенты получают живые узлы первыми.

  reality — TLS-рукопожатие к host:port с SNI узла: Reality отдаёт настоящий
            сертификат чужого сайта, так что успешное рукопожатие = путь жив
            (ТСПУ режет TCP, рукопожатие не проходит). Проверка сертификата
            включена — подмена на пути тоже будет видна.
  xhttp   — HTTPS GET probe_url (или https://host:port/): любой ответ < 500.

    python manage.py vpn_probe            # бесконечно, раз в INTERVAL
    python manage.py vpn_probe --once     # один проход, печатает таблицу

Смена состояния пишется в журнал (warning), оттуда её видно в docker logs.
"""
import http.client
import logging
import socket
import ssl
import time
from urllib.parse import urlparse

from django.core.management.base import BaseCommand
from django.utils import timezone

from chat.models import VpnNode
from chat.vpn import prune_reports

log = logging.getLogger("chat.vpn.probe")
INTERVAL = 60
TIMEOUT = 8


def resolve(host: str, port: int):
    """IP-адреса host (IPv4 первыми), как их видит сервер в Москве."""
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except OSError:
        return []
    ips = []
    for fam, *_rest, sa in sorted(infos, key=lambda i: i[0] != socket.AF_INET):
        if sa[0] not in ips:
            ips.append(sa[0])
    return ips[:6]


def probe_reality(n: VpnNode):
    ctx = ssl.create_default_context()
    ctx.set_alpn_protocols(["h2", "http/1.1"])
    sni = n.sni or n.host
    t0 = time.monotonic()
    with socket.create_connection((n.host, n.port), timeout=TIMEOUT) as raw:
        with ctx.wrap_socket(raw, server_hostname=sni) as s:
            s.getpeercert()
    return int((time.monotonic() - t0) * 1000)


def probe_xhttp(n: VpnNode):
    url = n.probe_url or f"https://{n.host}:{n.port}/"
    u = urlparse(url)
    host = u.hostname or n.host
    port = u.port or (443 if u.scheme == "https" else 80)
    ctx = ssl.create_default_context()
    t0 = time.monotonic()
    conn = http.client.HTTPSConnection(host, port, timeout=TIMEOUT, context=ctx) if u.scheme == "https" \
        else http.client.HTTPConnection(host, port, timeout=TIMEOUT)
    try:
        conn.request("GET", u.path or "/", headers={"Host": u.hostname or n.host, "User-Agent": "wyx-vpn-probe"})
        r = conn.getresponse()
        r.read(64)
        if r.status >= 500:
            raise RuntimeError(f"HTTP {r.status}")
    finally:
        conn.close()
    return int((time.monotonic() - t0) * 1000)


def probe(n: VpnNode):
    """(ok, rtt_ms, error)"""
    try:
        rtt = probe_reality(n) if n.kind == VpnNode.KIND_REALITY else probe_xhttp(n)
        return True, rtt, ""
    except Exception as e:  # noqa: BLE001 — любая сетевая беда = узел недоступен
        return False, None, f"{type(e).__name__}: {e}"[:300]


def run_once(out=None):
    now = timezone.now()
    for n in VpnNode.objects.filter(enabled=True):
        ok, rtt, err = probe(n)
        if ok != n.ok:
            log.warning("vpn узел %s: %s (%s)", n.slug, "ЖИВ" if ok else "УПАЛ", err or f"{rtt} мс")
        fields = {"ok": ok, "rtt_ms": rtt, "checked_at": now, "last_error": err}
        if ok:
            fields["last_ok_at"] = now
        ips = resolve(n.host, n.port)
        if ips:
            fields["ips"] = ",".join(ips)
        VpnNode.objects.filter(pk=n.pk).update(**fields)
        if out:
            out.write(f"{'ok ' if ok else 'ERR'} {n.slug:<24} {n.kind:<8} {n.host}:{n.port}  {rtt if ok else err}")


class Command(BaseCommand):
    help = "Проверка узлов Сети WYX из Москвы (раз в минуту)"

    def add_arguments(self, parser):
        parser.add_argument("--once", action="store_true")

    def handle(self, *args, **opts):
        if opts["once"]:
            run_once(self.stdout)
            return
        self.stdout.write("vpn_probe: старт, интервал %d с" % INTERVAL)
        tick = 0
        while True:
            try:
                run_once()
                tick += 1
                if tick % 60 == 0:
                    prune_reports()
            except Exception as e:  # noqa: BLE001 — не умирать от разового сбоя базы
                log.exception("vpn_probe: %s", e)
            time.sleep(INTERVAL)
