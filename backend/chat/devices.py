"""Устройства и сеансы: кто вошёл в аккаунт, выход с конкретного устройства
и со всех сразу.

Токен несёт claim did (device_id клиента). На каждом запросе
DeviceJWTAuthentication сверяет: устройство не отозвано (Device.revoked_at)
и токен выдан не раньше Profile.sessions_valid_from (это «выйти со всех»,
накрывает и старые токены без did). Проверка кэшируется на 20 секунд в
процессе — одного лишнего запроса к базе на каждый вызов API не нужно.

Отозванное устройство получает по личному сокету {"type": "session_revoked"}
и само стирает кэш и выходит (клиент: lib/forceLogout.ts).
"""
from django.utils import timezone
from rest_framework import exceptions, permissions
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.serializers import TokenRefreshSerializer
from rest_framework_simplejwt.tokens import RefreshToken

from .models import Device, Profile

from .device_auth import DEVICE_RE, _cache, check_token  # noqa: F401


class DeviceTokenRefreshSerializer(TokenRefreshSerializer):
    """Обновление access по refresh — с той же проверкой сеанса."""
    def validate(self, attrs):
        refresh = RefreshToken(attrs["refresh"])
        user_id = refresh.get("user_id")
        pid = Profile.objects.filter(user_id=user_id).values_list("id", flat=True).first()
        if pid:
            check_token(pid, refresh.payload)
            did = refresh.get("did")
            if did:
                Device.objects.filter(profile_id=pid, device_id=did).update(last_seen=timezone.now())
        return super().validate(attrs)


def attach_device(user, data):
    """При входе: запомнить устройство и вернуть did для claim (или '')."""
    did = (data.get("device_id") or "").strip()
    if not DEVICE_RE.match(did):
        return ""
    profile = getattr(user, "profile", None)
    if not profile:
        return ""
    Device.objects.update_or_create(
        profile=profile, device_id=did,
        defaults={
            "name": (data.get("device_name") or "")[:120],
            "platform": (data.get("platform") or "")[:16],
            "app_version": (data.get("app_version") or "")[:32],
            "last_seen": timezone.now(),
            "revoked_at": None,
        },
    )
    _cache.pop((profile.id, did), None)
    return did


def _notify(profile, data):
    from asgiref.sync import async_to_sync
    from channels.layers import get_channel_layer
    layer = get_channel_layer()
    if not layer:
        return
    try:
        async_to_sync(layer.group_send)(f"user_{profile.id}", {"type": "notification", "data": {"type": "session_revoked", **data}})
    except Exception:
        pass


def _current_did(request):
    tok = getattr(request, "auth", None)
    try:
        return tok.get("did") or "" if tok is not None else ""
    except Exception:
        return ""


class DevicesView(APIView):
    """GET — устройства с действующим входом; текущее помечено."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        me = getattr(request.user, "profile", None)
        if not me:
            return Response({"error": "Нет профиля"}, status=403)
        cur = _current_did(request)
        rows = Device.objects.filter(profile=me, revoked_at__isnull=True).order_by("-last_seen")
        return Response({
            "current": cur,
            "devices": [{
                "device_id": d.device_id, "name": d.name, "platform": d.platform, "app_version": d.app_version,
                "created_at": d.created_at.isoformat(), "last_seen": d.last_seen.isoformat(), "current": d.device_id == cur,
            } for d in rows],
        })


class DeviceRevokeView(APIView):
    """POST account/devices/<device_id>/revoke/ — завершить сеанс на устройстве."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, device_id):
        me = getattr(request.user, "profile", None)
        if not me:
            return Response({"error": "Нет профиля"}, status=403)
        d = Device.objects.filter(profile=me, device_id=device_id).first()
        if not d:
            return Response({"error": "Устройство не найдено"}, status=404)
        d.revoked_at = timezone.now()
        d.save(update_fields=["revoked_at"])
        _cache.pop((me.id, device_id), None)
        _notify(me, {"device_id": device_id})
        return Response({"ok": True, "self": device_id == _current_did(request)})


class DevicesRevokeOthersView(APIView):
    """POST account/devices/revoke-others/ — выйти везде, кроме этого устройства.
    Старые токены без did тоже перестают работать (sessions_valid_from)."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        me = getattr(request.user, "profile", None)
        if not me:
            return Response({"error": "Нет профиля"}, status=403)
        cur = _current_did(request)
        now = timezone.now()
        n = Device.objects.filter(profile=me, revoked_at__isnull=True).exclude(device_id=cur).update(revoked_at=now)
        me.sessions_valid_from = now
        me.save(update_fields=["sessions_valid_from"])
        # Текущий токен выдан раньше now — переоформляем его, чтобы это
        # устройство не вылетело вместе с остальными.
        for k in [k for k in _cache if k[0] == me.id]:
            _cache.pop(k, None)
        refresh = RefreshToken.for_user(request.user)
        if cur:
            refresh["did"] = cur
            Device.objects.filter(profile=me, device_id=cur).update(revoked_at=None, last_seen=now)
        _notify(me, {"all_except": cur})
        return Response({"ok": True, "revoked": n, "refresh": str(refresh), "access": str(refresh.access_token)})
