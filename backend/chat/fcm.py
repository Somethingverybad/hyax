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


# Заглушки, которые видит Apple/Google и которые покажет система, если
# устройство не смогло расшифровать пуш.
PLACEHOLDER_TITLE = "ХУЯКС"
PLACEHOLDER_BODY = "Новое сообщение"


def _encrypt(secret_b64: str, payload: dict) -> str | None:
    """AES-256-GCM ключом устройства: base64(nonce ‖ ciphertext ‖ tag).
    Ключ сгенерировало само устройство и хранит в Keychain/Keystore, так что
    текст пуша по дороге через Apple/Google не читается."""
    try:
        import base64 as b64
        import os as _os
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM

        key = b64.b64decode(secret_b64)
        if len(key) != 32:
            return None
        nonce = _os.urandom(12)
        ct = AESGCM(key).encrypt(nonce, json.dumps(payload, ensure_ascii=False).encode("utf-8"), None)
        return b64.b64encode(nonce + ct).decode("ascii")
    except Exception:
        logger.exception("push encrypt")
        return None


def _deliver_encrypted(entries, title: str, body: str, data: dict, sound: str | None):
    """Пуш с текстом внутри шифрованного блоба. Android — data-only, уведомление
    строит CallMessagingService; iOS — alert с mutable-content и заглушкой,
    текст подставляет Notification Service Extension. Звук не секрет — он в
    открытых полях, чтобы система сыграла его как обычно."""
    from firebase_admin import messaging

    ios_sound = f"{sound}.caf" if sound else "receive.caf"
    android_channel = f"snd_{sound}" if sound else "messages_v2"
    dead = []
    for token, secret, platform in entries:
        blob = _encrypt(secret, {"title": title, "body": body, **{k: str(v) for k, v in data.items()}, "sound": sound or ""})
        if not blob:
            continue
        payload = {"e": blob, "ch": android_channel}
        if platform == "android":
            msg = messaging.Message(token=token, data=payload, android=messaging.AndroidConfig(priority="high"))
        else:
            msg = messaging.Message(
                token=token,
                data=payload,
                apns=messaging.APNSConfig(
                    payload=messaging.APNSPayload(aps=messaging.Aps(
                        alert=messaging.ApsAlert(title=PLACEHOLDER_TITLE, body=PLACEHOLDER_BODY),
                        sound=ios_sound, mutable_content=True,
                    ))
                ),
            )
        try:
            messaging.send(msg)
        except Exception as e:
            code = getattr(e, "code", "") or type(e).__name__
            if code in ("UNREGISTERED", "INVALID_ARGUMENT", "NOT_FOUND", "registration-token-not-registered"):
                dead.append(token)
            else:
                logger.warning("FCM(enc) %s…: %s", token[:12], code)
    if dead:
        from .models import PushToken
        PushToken.objects.filter(token__in=dead).delete()


def _deliver(tokens, title: str, body: str, data: dict, sound: str | None = None):
    """Выполняется в отдельном потоке: пуш не должен задерживать ответ API."""
    app = _firebase_app()
    if app is None:
        return
    from firebase_admin import messaging
    if not tokens:
        return

    # По умолчанию — тот же receive, что играет в самом приложении при новом
    # сообщении. Аудио-стикер подменяет его слагом из каталога
    # NotificationSound: iOS ищет <slug>.caf в бандле и Library/Sounds
    # (докачивается клиентом), Android — канал snd_<slug>. Если файла или
    # канала на устройстве нет, обе системы откатываются на стандартный звук.
    ios_sound = f"{sound}.caf" if sound else "receive.caf"
    android_sound = sound or "receive"
    # На Android звук живёт в канале: обычные сообщения идут в messages_v2,
    # аудио-стикер — в свой канал snd_<slug>, который клиент заводит после
    # скачивания файла. Если канала на устройстве ещё нет, система возьмёт
    # канал по умолчанию — звук будет обычный, но уведомление не потеряется.
    android_channel = f"snd_{sound}" if sound else "messages_v2"

    message = messaging.MulticastMessage(
        tokens=tokens,
        notification=messaging.Notification(title=title, body=body),
        data={k: str(v) for k, v in data.items()},
        apns=messaging.APNSConfig(
            payload=messaging.APNSPayload(aps=messaging.Aps(sound=ios_sound))
        ),
        android=messaging.AndroidConfig(
            priority="high",
            notification=messaging.AndroidNotification(
                sound=android_sound, channel_id=android_channel
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
        if code in ("UNREGISTERED", "INVALID_ARGUMENT", "NOT_FOUND", "registration-token-not-registered"):
            dead.append(tokens[idx])
        else:
            logger.warning("FCM %s…: %s", tokens[idx][:12], code)

    if dead:
        from .models import PushToken

        PushToken.objects.filter(token__in=dead).delete()
        logger.info("FCM: удалено мёртвых токенов: %d", len(dead))


def _fcm_tokens(profiles, platforms=None):
    """FCM-токены профилей. PushKit-токены (ios_voip) — не FCM, их исключаем."""
    from .models import PushToken

    qs = PushToken.objects.filter(user__in=profiles).exclude(platform="ios_voip")
    if platforms:
        qs = qs.filter(platform__in=platforms)
    return list(qs.values_list("token", flat=True))


def notify_profiles(profiles, title: str, body: str, extra: dict | None = None,
                    sound: str | None = None, platforms=None, hide_body_for=None):
    """Пуш всем активным устройствам перечисленных профилей. Уходит в фоне.
    platforms — ограничить платформы (например, только android, если iOS
    уже получил VoIP-пуш о звонке). hide_body_for — id профилей, которым
    вместо текста показать «Новое сообщение» (выключили превью)."""
    from .models import PushToken

    qs = PushToken.objects.filter(user__in=profiles).exclude(platform="ios_voip")
    if platforms:
        qs = qs.filter(platform__in=platforms)
    rows = list(qs.values_list("token", "secret", "platform", "user_id"))
    if not rows:
        return
    hide = set(hide_body_for or ())
    extra = extra or {}

    def run():
        for body_text, group in ((body, [r for r in rows if r[3] not in hide]), (PLACEHOLDER_BODY, [r for r in rows if r[3] in hide])):
            if not group:
                continue
            plain = [r[0] for r in group if not r[1]]
            enc = [(r[0], r[1], r[2]) for r in group if r[1]]
            if plain:
                _deliver(plain, title, body_text, extra, sound)
            if enc and _firebase_app() is not None:
                _deliver_encrypted(enc, title, body_text, extra, sound)

    threading.Thread(target=run, daemon=True).start()


def _deliver_data(tokens, data: dict, ttl: int | None = None):
    """Тихий data-пуш: без баннера и звука, только разбудить приложение
    (iOS content-available, Android high priority). ttl — секунды жизни:
    приглашение на звонок не должно «догонять» телефон через минуту."""
    app = _firebase_app()
    if app is None:
        return
    from datetime import timedelta
    from firebase_admin import messaging

    android_kwargs = {"priority": "high"}
    if ttl:
        android_kwargs["ttl"] = timedelta(seconds=ttl)
    message = messaging.MulticastMessage(
        tokens=tokens,
        data={k: str(v) for k, v in data.items()},
        apns=messaging.APNSConfig(
            headers={"apns-push-type": "background", "apns-priority": "5"},
            payload=messaging.APNSPayload(aps=messaging.Aps(content_available=True)),
        ),
        android=messaging.AndroidConfig(**android_kwargs),
    )
    try:
        messaging.send_each_for_multicast(message)
    except Exception:
        logger.exception("FCM data: отправка не удалась")


def notify_data(profiles, data: dict, platforms=None, ttl: int | None = None):
    """Тихий пуш данными — отбой звонка (убрать экран вызова) или сам
    входящий звонок для Android: там экран вызова рисует нативный сервис."""
    tokens = _fcm_tokens(profiles, platforms)
    logger.info("FCM data %s: устройств %d", data.get("type", "?"), len(tokens))
    if not tokens:
        return
    threading.Thread(target=_deliver_data, args=(tokens, data, ttl), daemon=True).start()
