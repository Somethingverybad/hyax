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

from .models import Chat, Message, NotificationSound, Profile, SoundPack, Sticker
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
