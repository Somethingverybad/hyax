"""Согласие с правилами и удаление аккаунта.

Удаление — требование App Store (гайдлайн 5.1.1(v)): завёл аккаунт в
приложении — должен иметь возможность удалить его там же, без писем в поддержку.
"""
import logging
import os

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Chat, EmailCode, Message, NotificationSound, Profile, SoundPack, Sticker
from .serializers import OwnProfileSerializer

logger = logging.getLogger(__name__)


class AcceptTermsView(APIView):
    """POST — человек принял правила и политику. Для тех, кто регистрировался
    до их появления (или со старой сборки без галочки)."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        profile = getattr(request.user, "profile", None)
        if not profile:
            return Response({"error": "Profile not found"}, status=404)
        if not profile.terms_accepted_at:
            profile.terms_accepted_at = timezone.now()
            profile.save(update_fields=["terms_accepted_at"])
        return Response(OwnProfileSerializer(profile).data)


def _remove_local(url):
    """Удаляет файл из MEDIA_ROOT по ссылке вида /media/…; чужие пути не трогает."""
    if not url or not url.startswith(settings.MEDIA_URL):
        return
    root = os.path.realpath(settings.MEDIA_ROOT)
    path = os.path.realpath(os.path.join(root, url[len(settings.MEDIA_URL):]))
    if not path.startswith(root + os.sep):
        return
    try:
        if os.path.isfile(path):
            os.remove(path)
    except OSError:
        logger.warning("Удаление аккаунта: не удалился файл %s", path)


def _collect_files(profile):
    """Ссылки на файлы человека: собираем ДО удаления строк, удаляем ПОСЛЕ
    коммита — откат транзакции не должен оставить базу со ссылками в никуда."""
    local, s3_keys = [profile.avatar_url, profile.cover_url], []
    for file_url, voice_url in Message.objects.filter(sender=profile).values_list("file_url", "voice_url"):
        for url in (file_url, voice_url):
            if not url:
                continue
            if url.startswith("s3://"):
                s3_keys.append(url[len("s3://"):])
            else:
                local.append(url)
    local += list(Sticker.objects.filter(pack__author=profile).values_list("file_url", flat=True))
    sounds = list(NotificationSound.objects.filter(pack__creator=profile))
    return local, s3_keys, sounds


class DeleteAccountView(APIView):
    """POST {password} — удалить свой аккаунт безвозвратно.

    Уходит всё, что держится на профиле: сообщения, личные чаты, «Избранное»,
    созданные каналы, стикерпаки, паки звуков, боты, пуш-токены, блокировки.
    Группы остаются участникам (без сообщений удалённого). Жалобы на него и от
    него остаются модераторам обезличенными (SET_NULL).
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        user = request.user
        profile = getattr(user, "profile", None)
        if not profile or profile.is_bot:
            return Response({"error": "Profile not found"}, status=404)
        if not user.check_password(request.data.get("password") or ""):
            return Response({"error": "Неверный пароль"}, status=400)
        if user.is_superuser:
            # Единственный вход в админку не должен исчезнуть от тапа в приложении.
            return Response({"error": "Аккаунт администратора удаляется через админку"}, status=400)

        local, s3_keys, sounds = _collect_files(profile)
        username = profile.username

        with transaction.atomic():
            # Личка без собеседника и «Избранное» никому не нужны; каналы —
            # контент владельца, уходят вместе с ним. kind — источник истины,
            # у старых личек он тоже direct (значение по умолчанию).
            Chat.objects.filter(participants=profile, kind__in=["direct", "saved"], is_group=False).delete()
            Chat.objects.filter(creator=profile, kind="channel").delete()
            # creator у пака звуков — SET_NULL: без явного удаления паки остались
            # бы бесхозными. Звуки пака — тоже SET_NULL, удаляем сами.
            NotificationSound.objects.filter(pack__creator=profile).delete()
            SoundPack.objects.filter(creator=profile).delete()
            # Профили ботов уйдут каскадом по bot_owner, их User — нет.
            bot_user_ids = list(Profile.objects.filter(bot_owner=profile).values_list("user_id", flat=True))
            user.__class__.objects.filter(id__in=bot_user_ids).delete()
            user.delete()  # каскад: Profile → сообщения, участия, токены, подписки…

        for url in local:
            _remove_local(url)
        for snd in sounds:
            from .views import _delete_sound_files
            _delete_sound_files(snd)
        if s3_keys:
            # У роли приложения в S3 нет права на удаление объектов. Без строки
            # Message подписанную ссылку на них уже не получить; сами ключи
            # складываем в журнал — чистит администратор.
            try:
                # Не в media: тот каталог nginx раздаёт наружу.
                log_dir = os.path.join(settings.BASE_DIR, "private")
                os.makedirs(log_dir, exist_ok=True)
                with open(os.path.join(log_dir, "s3_orphans.log"), "a", encoding="utf-8") as f:
                    stamp = timezone.now().isoformat(timespec="seconds")
                    f.writelines(f"{stamp}\t{key}\n" for key in s3_keys)
            except OSError:
                logger.exception("Удаление аккаунта: не записался журнал ключей S3")

        logger.warning("Аккаунт удалён по запросу владельца: %s (файлов: %d, ключей S3: %d)",
                       username, len(local), len(s3_keys))
        return Response({"ok": True})


# ---------------------------------------------------------------------------
# Почта для восстановления пароля
# ---------------------------------------------------------------------------
import re
import secrets
from datetime import timedelta

from .i18n import lang_of
from .mailer import MailNotConfigured, code_email, send_email

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]{2,}$")
CODE_TTL = timedelta(minutes=15)
RESEND_AFTER = timedelta(seconds=60)
MAX_ATTEMPTS = 5


def _issue_code(profile, email, purpose):
    """Новый код в письмо. Не чаще раза в минуту на профиль и назначение —
    иначе чужую почту можно было бы заспамить, зная ник."""
    recent = EmailCode.objects.filter(profile=profile, purpose=purpose, created_at__gt=timezone.now() - RESEND_AFTER).exists()
    if recent:
        return None, "Код уже отправлен — проверьте почту или подождите минуту"
    code = f"{secrets.randbelow(10**6):06d}"
    EmailCode.objects.filter(profile=profile, purpose=purpose, used_at__isnull=True).update(used_at=timezone.now())
    row = EmailCode.objects.create(profile=profile, email=email, code=code, purpose=purpose)
    subject, text, html = code_email(code, purpose, lang_of(profile))
    try:
        send_email(email, subject, text, html)
    except MailNotConfigured:
        row.delete()
        return None, "Отправка писем пока не настроена"
    except Exception:
        logger.exception("письмо %s на %s не ушло", purpose, email)
        row.delete()
        return None, "Не удалось отправить письмо"
    return row, None


def _check_code(profile, purpose, code):
    """Последний живой код этого назначения. Неверный ввод тратит попытку,
    после пяти код сгорает."""
    row = (EmailCode.objects.filter(profile=profile, purpose=purpose, used_at__isnull=True,
                                    created_at__gt=timezone.now() - CODE_TTL)
           .order_by("-created_at").first())
    if not row:
        return None, "Код устарел — запросите новый"
    if row.attempts >= MAX_ATTEMPTS:
        return None, "Слишком много попыток — запросите новый код"
    if (code or "").strip() != row.code:
        row.attempts += 1
        row.save(update_fields=["attempts"])
        return None, "Неверный код"
    row.used_at = timezone.now()
    row.save(update_fields=["used_at"])
    return row, None


def _find_by_login(login):
    """Ник или привязанная почта → профиль. Почта считается только подтверждённая."""
    login = (login or "").strip().lstrip("@")
    if not login:
        return None
    if "@" in login:
        return Profile.objects.filter(email__iexact=login, email_verified_at__isnull=False).first()
    return Profile.objects.filter(username=login).first() or Profile.objects.filter(username__iexact=login).first()


class EmailView(APIView):
    """POST {email} — письмо с кодом на новую почту; DELETE — отвязать."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        profile = getattr(request.user, "profile", None)
        if not profile:
            return Response({"error": "Profile not found"}, status=404)
        email = (request.data.get("email") or "").strip().lower()
        if not EMAIL_RE.match(email) or len(email) > 254:
            return Response({"error": "Это не похоже на адрес почты"}, status=400)
        if Profile.objects.filter(email__iexact=email, email_verified_at__isnull=False).exclude(pk=profile.pk).exists():
            return Response({"error": "Эта почта уже привязана к другому аккаунту"}, status=400)
        _, err = _issue_code(profile, email, "verify")
        if err:
            return Response({"error": err}, status=503 if "не настроена" in err else 429 if "подождите" in err else 502)
        return Response({"sent": True, "email": email})

    def delete(self, request):
        profile = getattr(request.user, "profile", None)
        if not profile:
            return Response({"error": "Profile not found"}, status=404)
        profile.email = ""
        profile.email_verified_at = None
        profile.save(update_fields=["email", "email_verified_at"])
        return Response(OwnProfileSerializer(profile).data)


class EmailConfirmView(APIView):
    """POST {code} — код из письма подтверждает почту из последнего запроса."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        profile = getattr(request.user, "profile", None)
        if not profile:
            return Response({"error": "Profile not found"}, status=404)
        row, err = _check_code(profile, "verify", request.data.get("code"))
        if err:
            return Response({"error": err}, status=400)
        if Profile.objects.filter(email__iexact=row.email, email_verified_at__isnull=False).exclude(pk=profile.pk).exists():
            return Response({"error": "Эта почта уже привязана к другому аккаунту"}, status=400)
        profile.email = row.email
        profile.email_verified_at = timezone.now()
        profile.save(update_fields=["email", "email_verified_at"])
        return Response(OwnProfileSerializer(profile).data)


class PasswordForgotView(APIView):
    """POST {login} — ник или почта. Если у аккаунта есть подтверждённая почта,
    туда уходит код. Ответ одинаковый в любом случае: по нему нельзя узнать,
    есть ли у человека почта."""
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        profile = _find_by_login(request.data.get("login"))
        if profile and profile.email_verified and not profile.is_bot:
            _, err = _issue_code(profile, profile.email, "reset")
            if err and "не настроена" in err:
                return Response({"error": err}, status=503)
        return Response({"sent": True})


class PasswordResetView(APIView):
    """POST {login, code, password} — новый пароль по коду из письма."""
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        profile = _find_by_login(request.data.get("login"))
        password = request.data.get("password") or ""
        if len(password) < 6:
            return Response({"error": "Пароль короче 6 символов"}, status=400)
        if not profile or not profile.email_verified:
            return Response({"error": "Неверный код"}, status=400)
        _, err = _check_code(profile, "reset", request.data.get("code"))
        if err:
            return Response({"error": err}, status=400)
        user = profile.user
        user.set_password(password)
        user.save(update_fields=["password"])
        return Response({"ok": True})
