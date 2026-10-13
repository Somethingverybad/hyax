"""Проверка сеанса устройства на каждом запросе (см. chat/devices.py).
Отдельный модуль без rest_framework.views: DRF импортирует класс
аутентификации из настроек в момент инициализации views, и импорт APIView
отсюда давал частично инициализированный модуль (2026-10-13 уронило API)."""
import re
import time

from django.utils import timezone
from rest_framework import exceptions
from rest_framework_simplejwt.authentication import JWTAuthentication

from .models import Device, Profile

DEVICE_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
CACHE_TTL = 20
_cache: dict = {}  # (profile_id, did) -> (expires, revoked, valid_from_ts)


def _state(profile_id, did):
    """revoked, valid_from_ts — с кэшем на CACHE_TTL секунд."""
    key = (profile_id, did)
    now = time.time()
    hit = _cache.get(key)
    if hit and hit[0] > now:
        return hit[1], hit[2]
    revoked = False
    if did:
        d = Device.objects.filter(profile_id=profile_id, device_id=did).only("revoked_at", "last_seen").first()
        revoked = bool(d and d.revoked_at)
        if d and not revoked and (timezone.now() - d.last_seen).total_seconds() > 600:
            Device.objects.filter(pk=d.pk).update(last_seen=timezone.now())
    vf = Profile.objects.filter(id=profile_id).values_list("sessions_valid_from", flat=True).first()
    vf_ts = vf.timestamp() if vf else 0
    _cache[key] = (now + CACHE_TTL, revoked, vf_ts)
    if len(_cache) > 5000:
        _cache.clear()
    return revoked, vf_ts


def check_token(profile_id, payload):
    """Бросает AuthenticationFailed, если сеанс завершён."""
    did = payload.get("did") or ""
    iat = payload.get("iat") or 0
    revoked, vf_ts = _state(profile_id, did)
    # iat в токене — целые секунды, граница — с микросекундами: токен,
    # выданный в ту же секунду, что и «выйти везде», должен пройти.
    if revoked or (vf_ts and iat and iat < int(vf_ts)):
        _cache.pop((profile_id, did), None)
        raise exceptions.AuthenticationFailed("Сеанс завершён — войдите снова", code="session_revoked")


class DeviceJWTAuthentication(JWTAuthentication):
    def get_user(self, validated_token):
        user = super().get_user(validated_token)
        profile = getattr(user, "profile", None)
        if profile is not None:
            check_token(profile.id, validated_token)
        return user


