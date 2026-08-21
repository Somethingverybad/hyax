"""Отправка пушей через Firebase Cloud Messaging.

Firebase выбран вместо прямого APNs осознанно: планируется Android-версия,
а FCM обслуживает обе платформы одним кодом. На iOS Firebase SDK сам меняет
APNs-токен на FCM-овский (клиент использует @capacitor-firebase/messaging,
а не @capacitor/push-notifications — тот отдаёт сырой APNs-токен, который
FCM отправить не может).

Конфигурация через .env на сервере:
  FIREBASE_CREDENTIALS_B64 — service-account JSON в base64.

Если переменная не задана, отправка молча выключена — сервер работает как
раньше, удобно для локальной разработки.
"""
import base64
import json
import logging
import os
import threading

logger = logging.getLogger(__name__)

_app_lock = threading.Lock()
_app = None
_init_failed = False


def _firebase_app():
    global _app, _init_failed
    with _app_lock:
        if _app is not None or _init_failed:
            return _app
        raw = os.getenv("FIREBASE_CREDENTIALS_B64", "").strip()
        if not raw:
            _init_failed = True
            logger.info("FIREBASE_CREDENTIALS_B64 не задан — пуши выключены")
            return None
        try:
            import firebase_admin
            from firebase_admin import credentials

            cred = credentials.Certificate(json.loads(base64.b64decode(raw)))
            _app = firebase_admin.initialize_app(cred)
            logger.info("Firebase Admin инициализирован")
        except Exception:
            _init_failed = True
            logger.exception("Firebase Admin не инициализировался — пуши выключены")
        return _app


def _deliver(tokens, title: str, body: str, data: dict):
    """Выполняется в отдельном потоке: пуш не должен задерживать ответ API."""
    app = _firebase_app()
    if app is None:
        return
    from firebase_admin import messaging

    message = messaging.MulticastMessage(
        tokens=tokens,
        notification=messaging.Notification(title=title, body=body),
        data={k: str(v) for k, v in data.items()},
        # Звук — тот же receive, что играет в самом приложении при новом
        # сообщении. iOS ищет файл в бандле (receive.caf), Android — в
        # res/raw через канал "messages"; на сборках без файла обе системы
        # откатываются на стандартный звук.
        apns=messaging.APNSConfig(
            payload=messaging.APNSPayload(aps=messaging.Aps(sound="receive.caf"))
        ),
        android=messaging.AndroidConfig(
            priority="high",
            notification=messaging.AndroidNotification(
                sound="receive", channel_id="messages"
            ),
        ),
    )
    try:
        response = messaging.send_each_for_multicast(message)
    except Exception:
        logger.exception("FCM: отправка не удалась")
        return

    dead = []
    for idx, resp in enumerate(response.responses):
        if resp.success:
            continue
        code = getattr(resp.exception, "code", "") or type(resp.exception).__name__
        if code in ("UNREGISTERED", "INVALID_ARGUMENT", "registration-token-not-registered"):
            dead.append(tokens[idx])
        else:
            logger.warning("FCM %s…: %s", tokens[idx][:12], code)

    if dead:
        from .models import PushToken

        PushToken.objects.filter(token__in=dead).delete()
        logger.info("FCM: удалено мёртвых токенов: %d", len(dead))


def notify_profiles(profiles, title: str, body: str, extra: dict | None = None):
    """Пуш всем активным устройствам перечисленных профилей. Уходит в фоне."""
    from .models import PushToken

    tokens = list(
        PushToken.objects.filter(user__in=profiles).values_list("token", flat=True)
    )
    if not tokens:
        return
    threading.Thread(
        target=_deliver, args=(tokens, title, body, extra or {}), daemon=True
    ).start()
