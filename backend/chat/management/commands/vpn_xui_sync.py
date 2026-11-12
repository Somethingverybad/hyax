"""Синхронизация клиентов «Сети WYX» с панелью 3x-ui (chat/vpn_xui.py).

    python manage.py vpn_xui_sync             # завести незаведённых, убрать отозванных
    python manage.py vpn_xui_sync --all       # сверить всех (поправить UUID, если в панели чужой)
    python manage.py vpn_xui_sync --restart   # и перезапустить xray (рвёт туннели на секунды!)
    python manage.py vpn_xui_sync --list      # показать клиентов панели
"""
from django.core.management.base import BaseCommand

from chat.vpn_xui import Panel, configured, sync_pending


class Command(BaseCommand):
    help = "Синхронизация клиентов Сети WYX с панелью 3x-ui"

    def add_arguments(self, parser):
        parser.add_argument("--restart", action="store_true", help="перезапустить xray после изменений")
        parser.add_argument("--all", action="store_true", help="сверить всех, не только новых")
        parser.add_argument("--list", action="store_true")

    def handle(self, *args, **opts):
        if not configured():
            raise SystemExit("нужны XUI_URL, XUI_USER, XUI_PASS в окружении")
        if opts["list"]:
            p = Panel()
            p.login()
            for c in sorted(p.clients(), key=lambda c: c.get("email") or ""):
                self.stdout.write(f"  {c.get('email'):<24} {c.get('id') or c.get('uuid')}  enable={c.get('enable')}")
            return
        n = sync_pending(restart=opts["restart"], out=self.stdout.write, force_all=opts["all"])
        self.stdout.write(f"изменений: {n}")
