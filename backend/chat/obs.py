"""Трансляция звонка в OBS и похожие программы (источник «Браузер»).

Стример добавляет в OBS страницу /obs.html со своим секретным ключом. Звук
звонка в неё пересылает его же приложение на компьютере: оно и так получает
голоса всех участников и свой микрофон и отдаёт их странице отдельным
WebRTC-соединением — на одном компьютере звук не уходит дальше него. Сервер
только сводит их: страница входит в сокет по ключу (ObsConsumer в
consumers.py), сигналы ходят между ней и сокетом владельца (user_<id>).

Ключ — в адресе страницы после «#», серверу он приходит первым сообщением
сокета, а не в URL: адреса попадают в логи. Новый ключ отключает старые
страницы.
"""
import secrets

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Profile


def obs_group(profile_id) -> str:
    return f"obs_{profile_id}"


def _drop_pages(profile_id):
    """Отключить страницы OBS со старым ключом."""
    try:
        async_to_sync(get_channel_layer().group_send)(obs_group(profile_id), {"type": "obs.revoked"})
    except Exception:
        pass


class ObsKeyView(APIView):
    """GET — ключ (или null), POST — новый ключ, DELETE — убрать."""
    permission_classes = [permissions.IsAuthenticated]

    def _me(self, request):
        try:
            return request.user.profile
        except Profile.DoesNotExist:
            return None

    def get(self, request):
        me = self._me(request)
        if not me or me.is_bot:
            return Response({"error": "Profile not found"}, status=400)
        return Response({"key": me.obs_key or None})

    def post(self, request):
        me = self._me(request)
        if not me or me.is_bot:
            return Response({"error": "Profile not found"}, status=400)
        if me.obs_key:
            _drop_pages(me.id)
        me.obs_key = secrets.token_urlsafe(24)
        me.save(update_fields=["obs_key"])
        return Response({"key": me.obs_key})

    def delete(self, request):
        me = self._me(request)
        if not me or me.is_bot:
            return Response({"error": "Profile not found"}, status=400)
        if me.obs_key:
            me.obs_key = ""
            me.save(update_fields=["obs_key"])
            _drop_pages(me.id)
        return Response(status=204)
