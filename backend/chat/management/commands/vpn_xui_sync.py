"""Заводит клиентов «Сети WYX» в панели 3x-ui на crystal (по UUID из VpnAccess).

Панель: XUI_URL (например https://nemilf.hyax.ru/panel/ — через мост, по IPv4
crystal из Москвы недоступен), XUI_USER, XUI_PASS в .env. Узел (VpnNode) знает,
в какие inbound'ы класть клиента (xui_inbounds, id через запятую); клиент
кладётся во все inbound'ы всех включённых узлов, одним UUID.

    python manage.py vpn_xui_sync             # завести недостающих, выключить отозванных
    python manage.py vpn_xui_sync --restart   # и перезапустить xray (рвёт туннели на секунды!)
    python manage.py vpn_xui_sync --list      # показать клиентов панели

Без --restart xray о новых клиентах узнаёт только если панель умеет добавлять
их на лету (api-inbound); если новый пользователь не подключается — повторить
с --restart в тихое время. Те же вызовы, что в /home/vpn/newuser.py на crystal.
"""
import http.cookiejar
import json
import os
import re
import urllib.parse
import urllib.request

from django.core.management.base import BaseCommand
from django.utils import timezone

from chat.models import VpnAccess, VpnNode


class Panel:
    def __init__(self, base, user, pw):
        self.base = base.rstrip("/")  # …/panel
        self.user, self.pw = user, pw
        self.jar = http.cookiejar.CookieJar()
        self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.csrf = ""

    def _csrf(self):
        with self.op.open(urllib.request.Request(self.base + "/"), timeout=20) as r:
            m = re.search(r'csrf-token" content="([^"]*)"', r.read().decode())
        self.csrf = m.group(1) if m else ""

    def call(self, path, data=None, method=None):
        hdrs = {"X-CSRF-Token": self.csrf, "Referer": self.base + "/"}
        body = None
        if path.endswith("/login"):
            body = urllib.parse.urlencode(data).encode()
        elif data is not None:
            hdrs["Content-Type"] = "application/json"
            body = json.dumps(data).encode()
        req = urllib.request.Request(self.base + path, body, hdrs, method=method)
        with self.op.open(req, timeout=20) as r:
            return json.loads(r.read().decode())

    def login(self):
        self._csrf()
        if not self.call("/login", {"username": self.user, "password": self.pw}).get("success"):
            raise SystemExit("панель: не удалось войти")
        self._csrf()

    def clients(self):
        return self.call("/panel/api/clients/list").get("obj", []) or []

    def add(self, email, uid, inbound_ids):
        client = {"email": email, "uuid": uid, "subId": email, "flow": "", "enable": True,
                  "limitIp": 0, "totalGB": 0, "expiryTime": 0, "tgId": 0, "reset": 0}
        return self.call("/panel/api/clients/add", {"client": client, "inboundIds": inbound_ids})

    def delete(self, email):
        return self.call(f"/panel/api/clients/del/{urllib.parse.quote(email)}", {})

    def restart(self):
        return self.call("/panel/api/server/restartXrayService", {})


class Command(BaseCommand):
    help = "Синхронизация клиентов Сети WYX с панелью 3x-ui"

    def add_arguments(self, parser):
        parser.add_argument("--restart", action="store_true", help="перезапустить xray после изменений")
        parser.add_argument("--list", action="store_true")

    def handle(self, *args, **opts):
        base, user, pw = os.getenv("XUI_URL", ""), os.getenv("XUI_USER", ""), os.getenv("XUI_PASS", "")
        if not (base and user and pw):
            raise SystemExit("нужны XUI_URL, XUI_USER, XUI_PASS в окружении")
        p = Panel(base, user, pw)
        p.login()
        existing = {c["email"]: c for c in p.clients()}
        if opts["list"]:
            for e, c in sorted(existing.items()):
                self.stdout.write(f"  {e:<24} {c.get('uuid')}  enable={c.get('enable')}")
            return
        inbound_ids = sorted({int(x) for n in VpnNode.objects.filter(enabled=True) for x in n.xui_inbounds.split(",") if x.strip().isdigit()})
        if not inbound_ids:
            raise SystemExit("ни у одного узла не задан xui_inbounds")
        changed = 0
        for acc in VpnAccess.objects.select_related("profile"):
            email = acc.email
            if acc.enabled and email not in existing:
                r = p.add(email, str(acc.uuid), inbound_ids)
                ok = bool(r.get("success"))
                self.stdout.write(f"+ {email}: {'заведён' if ok else r}")
                if ok:
                    VpnAccess.objects.filter(pk=acc.pk).update(xui_synced_at=timezone.now())
                    changed += 1
            elif not acc.enabled and email in existing:
                r = p.delete(email)
                self.stdout.write(f"- {email}: {'удалён' if r.get('success') else r}")
                changed += 1
            elif acc.enabled and not acc.xui_synced_at:
                VpnAccess.objects.filter(pk=acc.pk).update(xui_synced_at=timezone.now())
        self.stdout.write(f"изменений: {changed}")
        if opts["restart"] and changed:
            r = p.restart()
            self.stdout.write("xray перезапущен" if r.get("success") else f"перезапуск не удался: {r}")
