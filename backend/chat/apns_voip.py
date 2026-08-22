"""VoIP-пуши через APNs (PushKit) — для входящих звонков.

Обычный пуш не годится: iOS не будит убитое приложение и не покажет экран
звонка на заблокированном экране. PushKit-пуш доставляется всегда, а
приложение обязано тут же показать входящий вызов через CallKit — именно
так звонят Telegram и WhatsApp. FCM такие пуши слать не умеет, поэтому
здесь прямой APNs по HTTP/2 с тем же .p8-ключом, что залит в Firebase.

Конфигурация через .env:
  APNS_KEY_B64   — содержимое AuthKey_XXXXXXXXXX.p8 в base64
  APNS_KEY_ID    — Key ID ключа
  APNS_TEAM_ID   — Team ID разработчика
  APNS_BUNDLE_ID — bundle id приложения (topic = <bundle>.voip)

Сборки из Xcode регистрируются в sandbox-APNs, TestFlight/App Store — в
production. Среда токена заранее неизвестна, поэтому шлём в production и при
BadDeviceToken повторяем в sandbox.
"""
import base64
import logging
import os
import threading
import time

logger = logging.getLogger(__name__)

_PROD = "https://api.push.apple.com"
_SANDBOX = "https://api.sandbox.push.apple.com"

_jwt_lock = threading.Lock()
_jwt_cache = {"token": None, "issued": 0.0}


def _config():
    key_b64 = os.getenv("APNS_KEY_B64", "").strip()
    key_id = os.getenv("APNS_KEY_ID", "").strip()
    team_id = os.getenv("APNS_TEAM_ID", "").strip()
    bundle = os.getenv("APNS_BUNDLE_ID", "").strip()
    if not (key_b64 and key_id and team_id and bundle):
        return None
    return {
        "key": base64.b64decode(key_b64).decode(),
        "key_id": key_id,
        "team_id": team_id,
        "bundle": bundle,
    }


def _provider_token(cfg):
    """JWT для APNs живёт до часа; Apple просит не перевыпускать чаще 20 минут."""
    import jwt

    with _jwt_lock:
        now = time.time()
        if _jwt_cache["token"] and now - _jwt_cache["issued"] < 50 * 60:
            return _jwt_cache["token"]
        token = jwt.encode(
            {"iss": cfg["team_id"], "iat": int(now)},
            cfg["key"],
            algorithm="ES256",
            headers={"kid": cfg["key_id"]},
        )
        _jwt_cache.update(token=token, issued=now)
        return token


def _push(client, host, cfg, device_token, payload):
    resp = client.post(
        f"{host}/3/device/{device_token}",
        json=payload,
        headers={
            "authorization": f"bearer {_provider_token(cfg)}",
            "apns-topic": f"{cfg['bundle']}.voip",
            "apns-push-type": "voip",
            "apns-priority": "10",
            "apns-expiration": "0",
        },
        timeout=10,
    )
    reason = ""
    if resp.status_code != 200:
        try:
            reason = resp.json().get("reason", "")
        except Exception:
            reason = resp.text[:80]
    return resp.status_code, reason


def _deliver(tokens, payload):
    cfg = _config()
    if cfg is None:
        logger.info("APNS_* не заданы — VoIP-пуши выключены")
        return
    import httpx

    dead = []
    with httpx.Client(http2=True) as client:
        for token in tokens:
            try:
                status, reason = _push(client, _PROD, cfg, token, payload)
                if status == 400 and reason == "BadDeviceToken":
                    status, reason = _push(client, _SANDBOX, cfg, token, payload)
            except Exception:
                logger.exception("APNs VoIP: запрос не удался")
                continue
            if status == 200:
                logger.info("APNs VoIP %s…: доставлен", token[:12])
                continue
            if status == 410 or reason in ("BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic"):
                dead.append(token)
            else:
                logger.warning("APNs VoIP %s…: %s %s", token[:12], status, reason)

    if dead:
        from .models import PushToken

        PushToken.objects.filter(token__in=dead).delete()
        logger.info("APNs VoIP: удалено мёртвых токенов: %d", len(dead))


def notify_voip(profiles, payload: dict) -> int:
    """VoIP-пуш всем iOS-устройствам профилей. Возвращает число токенов —
    по нему вызывающий решает, нужен ли обычный пуш как запасной вариант."""
    from .models import PushToken

    tokens = list(
        PushToken.objects.filter(user__in=profiles, platform="ios_voip").values_list("token", flat=True)
    )
    logger.info("APNs VoIP %s: устройств %d", payload.get("type", "?"), len(tokens))
    if tokens:
        threading.Thread(target=_deliver, args=(tokens, payload), daemon=True).start()
    return len(tokens)
