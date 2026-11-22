"""Вход в Бупень через аккаунт WYX — без пароля.

Клиент Бупеня называет ник (или почту) и получает номер запроса и секрет.
Бот «Бупень» пишет человеку в WYX «Подтвердить вход через аккаунт WYX?» с
кнопками «Да» и «Нет». Клиент раз в пару секунд спрашивает, что решили, —
предъявляя секрет, который знает только он (в базе — его sha256). На «Да»
первый же опрос получает пару JWT с did этого устройства (как обычный вход,
chat/devices.py), второй раз токены не выдаются.

  POST /api/vpn/login/start/ {username, device_id, device_name, platform, app_version}
       → {id, secret, expires_in, interval}
  POST /api/vpn/login/poll/  {id, secret}
       → {status: pending|approved|denied|expired|used, access?, refresh?, username?}

Защита от рассылки чужим людям «подтвердите вход»: не чаще раза в 15 секунд
и не больше 6 запросов за 10 минут на человека, 20 — с одного адреса. Новый
запрос с того же устройства гасит прежний (кнопки у старого сообщения
пропадают). Нажать «Да» может только тот, кому пришло сообщение.
"""
import hashlib
import hmac
import logging
import secrets
from datetime import timedelta

from django.contrib.auth.models import User
from django.db import transaction
from django.utils import timezone
from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Chat, ChatParticipant, Message, Profile, VpnLogin

log = logging.getLogger(__name__)

BOT_USERNAME = "Бупень"
BOT_LOGIN = "bypen_bot"
BOT_BIO = "Подтверждает вход в Бупень — VPN-клиент сети WYX."
TTL = timedelta(minutes=5)
POLL_INTERVAL = 2           # секунд — подсказка клиенту
MIN_GAP = timedelta(seconds=15)
WINDOW = timedelta(minutes=10)
PER_PROFILE = 6
PER_IP = 20
PLATFORMS = {"ios": "iPhone", "mac": "Mac", "android": "Android", "windows": "Windows", "linux": "Linux"}


def bypen_bot() -> Profile:
    user = User.objects.filter(username=BOT_LOGIN).first()
    if user and hasattr(user, "profile"):
        return user.profile
    if not user:
        user = User.objects.create(username=BOT_LOGIN, email=f"{BOT_LOGIN}@bot.local", is_active=False)
        user.set_unusable_password()
        user.save()
    name = BOT_USERNAME
    if Profile.objects.filter(username=name).exists():   # ник занят человеком — не отбираем
        name = f"{BOT_USERNAME} WYX"
    return Profile.objects.create(user=user, username=name, is_bot=True, bio=BOT_BIO,
                                  bot_token=secrets.token_urlsafe(32))


def is_bypen_bot(profile) -> bool:
    return bool(profile and profile.is_bot and profile.user_id
                and User.objects.filter(id=profile.user_id, username=BOT_LOGIN).exists())


def user_chat(profile: Profile, bot: Profile) -> Chat:
    chat = Chat.objects.filter(kind="direct", participants=profile).filter(participants=bot).first()
    if chat:
        if not chat.bot_started:
            Chat.objects.filter(id=chat.id).update(bot_started=True)
        return chat
    with transaction.atomic():
        chat = Chat.objects.create(kind="direct", bot_started=True)
        ChatParticipant.objects.create(chat=chat, user=profile)
        ChatParticipant.objects.create(chat=chat, user=bot)
    return chat


def _hash(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


def _u16(s: str) -> int:
    return len(s.encode("utf-16-le")) // 2


def _ip(request) -> str:
    fwd = (request.META.get("HTTP_X_FORWARDED_FOR") or "").split(",")[0].strip()
    return (request.META.get("HTTP_X_REAL_IP") or fwd or request.META.get("REMOTE_ADDR") or "")[:64]


def _device(login: VpnLogin) -> str:
    name = login.device_name or f"Бупень · {PLATFORMS.get(login.platform, login.platform or 'устройство')}"
    return f"{name} ({login.app_version})" if login.app_version else name


def _find_profile(username: str):
    """Как обычный вход (CustomTokenObtainPairSerializer): ник без учёта
    регистра или подтверждённая почта. Ботов и выключенных не берём."""
    u = (username or "").strip().lstrip("@")[:150]
    if not u:
        return None
    qs = Profile.objects.select_related("user").filter(is_bot=False, user__is_active=True)
    if "@" in u:
        return qs.filter(email__iexact=u, email_verified_at__isnull=False).first()
    return qs.filter(username=u).first() or qs.filter(username__iexact=u).first()


def _set_text(login: VpnLogin, text: str, request=None):
    """Заменить текст сообщения бота и убрать кнопки; участникам — chat_changed."""
    m = login.message
    if not m:
        return None
    title = text.split("\n", 1)[0]
    m.content, m.entities, m.buttons = text, [{"type": "bold", "offset": 0, "length": _u16(title)}], []
    m.save(update_fields=["content", "entities", "buttons", "updated_at"])
    from .views import _chat_changed
    try:
        _chat_changed(m.chat)
    except Exception:
        log.exception("bypen login: chat_changed")
    return m


def _expire(login: VpnLogin, why="Запрос на вход устарел"):
    if VpnLogin.objects.filter(pk=login.pk, status=VpnLogin.PENDING).update(status=VpnLogin.EXPIRED, decided_at=timezone.now()):
        login.status = VpnLogin.EXPIRED
        _set_text(login, f"⌛ {why}\n{_device(login)}")


class LoginStartView(APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes = []

    def post(self, request):
        d = request.data if isinstance(request.data, dict) else {}
        profile = _find_profile(str(d.get("username") or ""))
        if not profile:
            return Response({"detail": "Нет такого аккаунта WYX — проверьте ник"}, status=404)
        now = timezone.now()
        ip = _ip(request)
        recent = VpnLogin.objects.filter(profile=profile, created_at__gte=now - WINDOW)
        last = recent.first()
        if last and now - last.created_at < MIN_GAP:
            wait = int((MIN_GAP - (now - last.created_at)).total_seconds()) + 1
            return Response({"detail": f"Запрос уже отправлен — повторить можно через {wait} с", "retry_after": wait}, status=429)
        if recent.count() >= PER_PROFILE or (ip and VpnLogin.objects.filter(ip=ip, created_at__gte=now - WINDOW).count() >= PER_IP):
            return Response({"detail": "Слишком много запросов на вход — попробуйте через 10 минут"}, status=429)

        device_id = str(d.get("device_id") or "")[:64]
        # Прежний запрос с этого же устройства больше не нужен.
        if device_id:
            for old in VpnLogin.objects.filter(profile=profile, device_id=device_id, status=VpnLogin.PENDING).select_related("message"):
                _expire(old, "Запрос заменён новым")

        secret = secrets.token_urlsafe(32)
        bot = bypen_bot()
        chat = user_chat(profile, bot)
        login = VpnLogin.objects.create(
            profile=profile, secret_hash=_hash(secret), device_id=device_id,
            device_name=str(d.get("device_name") or "")[:120], platform=str(d.get("platform") or "")[:16],
            app_version=str(d.get("app_version") or "")[:32], ip=ip, expires_at=now + TTL,
        )
        title = "Вход в Бупень"
        text = (f"{title}\n\nПодтвердить вход через аккаунт WYX?\n\n"
                f"Устройство: {_device(login)}\n" + (f"Адрес: {ip}\n" if ip else "") +
                "\nЕсли входите не вы — нажмите «Нет».")
        buttons = [[{"text": "✅ Да, это я", "data": f"bl:y:{login.id}"}, {"text": "Нет", "data": f"bl:n:{login.id}"}]]
        m = Message.objects.create(chat=chat, sender=bot, content=text, buttons=buttons,
                                   entities=[{"type": "bold", "offset": 0, "length": _u16(title)}])
        VpnLogin.objects.filter(pk=login.pk).update(message=m)
        Chat.objects.filter(id=chat.id).update(updated_at=timezone.now())
        from .views import _notify_new_message
        try:
            _notify_new_message(m, bot, None)
        except Exception:
            log.exception("bypen login: не удалось разослать сообщение бота")
        log.info("bypen login: запрос %s для %s (%s, %s)", login.id, profile.username, login.platform, ip)
        return Response({"id": str(login.id), "secret": secret, "expires_in": int(TTL.total_seconds()),
                         "interval": POLL_INTERVAL, "bot": bot.username})


class LoginPollView(APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes = []

    def post(self, request):
        d = request.data if isinstance(request.data, dict) else {}
        try:
            login = VpnLogin.objects.select_related("profile__user", "message").get(pk=str(d.get("id") or ""))
        except Exception:   # нет такого или id не UUID
            return Response({"detail": "Запрос не найден"}, status=404)
        if not hmac.compare_digest(login.secret_hash, _hash(str(d.get("secret") or ""))):
            return Response({"detail": "Запрос не найден"}, status=404)
        if login.status == VpnLogin.PENDING and login.expires_at < timezone.now():
            _expire(login)
        if login.status != VpnLogin.APPROVED:
            return Response({"status": login.status})
        # Токены — один раз: кто первым перевёл approved → used, тот и получил.
        if not VpnLogin.objects.filter(pk=login.pk, status=VpnLogin.APPROVED).update(status=VpnLogin.USED):
            return Response({"status": VpnLogin.USED})
        from rest_framework_simplejwt.tokens import RefreshToken
        from .devices import attach_device
        user = login.profile.user
        did = attach_device(user, {"device_id": login.device_id, "device_name": login.device_name,
                                   "platform": login.platform, "app_version": login.app_version})
        refresh = RefreshToken.for_user(user)
        if did:
            refresh["did"] = did
        log.info("bypen login: вход %s выдан %s", login.id, login.profile.username)
        return Response({"status": VpnLogin.APPROVED, "access": str(refresh.access_token), "refresh": str(refresh),
                         "username": login.profile.username})


def handle_press(msg, profile, data, request=None):
    """Кнопка «Да»/«Нет» под сообщением бота. Ответ клиенту WYX: {ok, toast?, message?}."""
    from .serializers import MessageSerializer
    parts = data.split(":")
    if len(parts) != 3 or parts[0] != "bl" or parts[1] not in ("y", "n"):
        return {"error": "Такой кнопки нет"}
    login = VpnLogin.objects.select_related("message").filter(pk=parts[2]).first() if len(parts[2]) == 36 else None
    if not login or login.message_id != msg.id or login.profile_id != profile.id:
        return {"error": "Такой кнопки нет"}
    out = {"ok": True}
    now = timezone.now()
    if login.status == VpnLogin.PENDING and login.expires_at < now:
        _expire(login)
        out.update(toast="Запрос устарел — войдите в Бупене заново", toast_kind="error")
    elif login.status != VpnLogin.PENDING:
        out.update(toast="Этот запрос уже обработан", toast_kind="error")
    elif parts[1] == "y":
        if VpnLogin.objects.filter(pk=login.pk, status=VpnLogin.PENDING).update(status=VpnLogin.APPROVED, decided_at=now):
            _set_text(login, f"✅ Вход в Бупень подтверждён\n{_device(login)}")
            out.update(toast="Вход подтверждён", toast_kind="success")
    else:
        if VpnLogin.objects.filter(pk=login.pk, status=VpnLogin.PENDING).update(status=VpnLogin.DENIED, decided_at=now):
            _set_text(login, f"🚫 Вход в Бупень отклонён\n{_device(login)}")
            out.update(toast="Вход отклонён", toast_kind="success")
    msg.refresh_from_db()
    out["message"] = MessageSerializer(msg, context={"request": request}).data
    return out


def prune():
    """Старше суток — не нужны."""
    VpnLogin.objects.filter(created_at__lt=timezone.now() - timedelta(days=1)).delete()
