"""Узлы «Сети WYX» как они есть на 11.11.2026 (crystal за мостом nemilf.hyax.ru).
Идемпотентно: существующие узлы не трогает, только добавляет недостающие.

    python manage.py vpn_seed
"""
from django.core.management.base import BaseCommand

from chat.models import VpnNode

NODES = [
    # Мост Москва (Windows, portproxy v4→v6) → crystal:443 → vpn-front → 3x-ui.
    dict(slug="msk-bridge-reality", name="Москва → NL · Reality", kind=VpnNode.KIND_REALITY,
         host="nemilf.hyax.ru", port=443, sni="dl.google.com",
         public_key="RGIRo2jp-XSIn4JnwQhovW-18UrUG4l_sE17da1uFVk", short_id="0123abcd", fingerprint="chrome", flow="",
         xui_inbounds="5", weight=20, note="inbound reality-new-users (8443) через мост 195.58.153.245"),
    dict(slug="msk-bridge-xhttp", name="Москва → NL · XHTTP", kind=VpnNode.KIND_XHTTP,
         host="nemilf.hyax.ru", port=443, sni="nemilf.hyax.ru", path="/vless-xhttp", mode="auto", alpn="h2",
         probe_url="https://nemilf.hyax.ru/retro-cloud/health",
         xui_inbounds="8", weight=15, note="inbound legacy-xhttp (3002) через мост"),
    # Прямой адрес NL: с 11.11.2026 режется ТСПУ по IPv4, пробник держит его в хвосте.
    dict(slug="nl-direct-reality", name="NL напрямую · Reality", kind=VpnNode.KIND_REALITY,
         host="148.253.213.224", port=443, sni="dl.google.com",
         public_key="RGIRo2jp-XSIn4JnwQhovW-18UrUG4l_sE17da1uFVk", short_id="0123abcd", fingerprint="chrome", flow="",
         xui_inbounds="5", weight=5, note="тот же inbound, без моста; жив не из всех сетей"),
]


class Command(BaseCommand):
    help = "Добавить известные узлы Сети WYX (идемпотентно)"

    def handle(self, *args, **opts):
        for d in NODES:
            n, created = VpnNode.objects.get_or_create(slug=d["slug"], defaults=d)
            self.stdout.write(f"{'+' if created else '='} {n.slug}")
