"""Панель 3x-ui на crystal: заводим туда клиентов «Сети WYX» по UUID из VpnAccess.

Панель: XUI_URL (https://nemilf.hyax.ru/panel/ — через мост), XUI_USER, XUI_PASS.
Узел (VpnNode) знает, в какие inbound'ы класть клиента (xui_inbounds); клиент
кладётся во все inbound'ы всех включённых узлов одним UUID. У vless-клиента
в панели ключ зовётся id (поле uuid панель молча игнорирует и придумывает свой).

sync_pending() — завести незаведённых, убрать отозванных; зовётся при выдаче
доступа (фоном) и раз в минуту из vpn_probe. Перезапуск xray (restart=True)
рвёт туннели на секунды — только по явной просьбе (manage.py vpn_xui_sync --restart).
"""
import http.cookiejar
import json
import logging
import os
import re
import urllib.parse
import urllib.request

from django.utils import timezone

log = logging.getLogger(__name__)


def configured() -> bool:
    return bool(os.getenv("XUI_URL") and os.getenv("XUI_USER") and os.getenv("XUI_PASS"))


class Panel:
    def __init__(self, base=None, user=None, pw=None):
        self.base = (base or os.getenv("XUI_URL", "")).rstrip("/")  # …/panel
        self.user, self.pw = user or os.getenv("XUI_USER", ""), pw or os.getenv("XUI_PASS", "")
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
            raise RuntimeError("панель: не удалось войти")
        self._csrf()

    def clients(self):
        return self.call("/panel/api/clients/list").get("obj", []) or []

    def add(self, email, uid, inbound_ids):
        client = {"email": email, "id": uid, "subId": email, "flow": "", "enable": True,
                  "limitIp": 0, "totalGB": 0, "expiryTime": 0, "tgId": 0, "reset": 0}
        return self.call("/panel/api/clients/add", {"client": client, "inboundIds": inbound_ids})

    def delete(self, email):
        return self.call(f"/panel/api/clients/del/{urllib.parse.quote(email)}", {})

    def restart(self):
        return self.call("/panel/api/server/restartXrayService", {})


def inbound_ids():
    from .models import VpnNode
    return sorted({int(x) for n in VpnNode.objects.filter(enabled=True) for x in n.xui_inbounds.split(",") if x.strip().isdigit()})


def sync_pending(restart=False, out=None, force_all=False):
    """Завести в панели доступы без xui_synced_at (или все, force_all), удалить отозванные.
    Возвращает число изменений; без XUI_* в окружении — 0 и ничего не делает."""
    from .models import VpnAccess
    if not configured():
        if out:
            out("нет XUI_URL / XUI_USER / XUI_PASS — панель не синхронизируется")
        return 0
    ids = inbound_ids()
    if not ids:
        if out:
            out("ни у одного узла не задан xui_inbounds")
        return 0
    p = Panel()
    p.login()
    existing = {c.get("email"): c for c in p.clients()}
    changed = 0
    qs = VpnAccess.objects.select_related("profile")
    if not force_all:
        qs = qs.filter(xui_synced_at__isnull=True) | qs.filter(enabled=False, xui_synced_at__isnull=False)
    for acc in qs.distinct():
        email = acc.email
        if acc.enabled and email not in existing:
            r = p.add(email, str(acc.uuid), ids)
            ok = bool(r.get("success"))
            (out or log.info)(f"+ {email}: {'заведён' if ok else r}")
            if ok:
                VpnAccess.objects.filter(pk=acc.pk).update(xui_synced_at=timezone.now())
                changed += 1
        elif acc.enabled and email in existing:
            # в /clients/list поле id — номер строки, UUID клиента лежит в uuid
            if str(existing[email].get("uuid") or "") != str(acc.uuid):
                p.delete(email)
                r = p.add(email, str(acc.uuid), ids)
                (out or log.info)(f"~ {email}: UUID исправлен ({'ок' if r.get('success') else r})")
                changed += 1
            VpnAccess.objects.filter(pk=acc.pk).update(xui_synced_at=timezone.now())
        elif not acc.enabled and email in existing:
            r = p.delete(email)
            (out or log.info)(f"- {email}: {'удалён' if r.get('success') else r}")
            VpnAccess.objects.filter(pk=acc.pk).update(xui_synced_at=None)
            changed += 1
    if restart and changed:
        r = p.restart()
        (out or log.info)("xray перезапущен" if r.get("success") else f"перезапуск не удался: {r}")
    return changed


def sync_soon():
    """Фоном, после выдачи доступа: чтобы человек мог подключиться сразу."""
    if not configured():
        return
    from .bgthread import spawn

    def run():
        try:
            sync_pending()
        except Exception as e:  # noqa: BLE001
            log.warning("vpn: панель не синхронизирована: %s", e)
    spawn(run, name="vpn-xui-sync")
