"""Прослушивания и лайки плейлистов.

Прослушивание — человек запустил чужой плейлист: со страницы плейлиста, по
ссылке, из карточки в чате или пришёл в эфир, где он играет. Свои запуски
владельца не считаем, повтор одним человеком в течение LISTEN_WINDOW — тоже.
Лайк — +PLAYLIST_LIKE_VIBE к вайбометру создателя; снял лайк — столько же
обратно, так что накрутить лайком-снятием нельзя.
"""
from __future__ import annotations

import logging
from datetime import timedelta

from django.db import IntegrityError, models, transaction
from django.utils import timezone

from .models import PLAYLIST_LIKE_VIBE, Playlist, PlaylistLike, PlaylistListen, Profile

logger = logging.getLogger(__name__)

LISTEN_WINDOW = timedelta(minutes=30)


def count_play(pl: Playlist, me: Profile | None) -> bool:
    """Засчитать прослушивание. True — счётчик вырос."""
    if not me or me.is_bot or pl.owner_id == me.id:
        return False
    now = timezone.now()
    with transaction.atomic():
        row, created = PlaylistListen.objects.select_for_update().get_or_create(
            playlist=pl, profile=me, defaults={"last_at": now})
        if not created:
            if row.last_at > now - LISTEN_WINDOW:
                return False
            row.last_at = now
            row.save(update_fields=["last_at"])
        # update(), а не save(): updated_at плейлиста — «когда меняли музыку».
        Playlist.objects.filter(id=pl.id).update(plays=models.F("plays") + 1)
    pl.refresh_from_db(fields=["plays"])
    return True


def state(pl: Playlist, me: Profile | None) -> dict:
    return {
        "plays": pl.plays,
        "likes": pl.likes.count(),
        "liked": bool(me) and pl.likes.filter(profile=me).exists(),
    }


def like(pl: Playlist, me: Profile) -> bool:
    """Поставить лайк. True — новый (вайб создателю начислен)."""
    owner = pl.owner
    try:
        with transaction.atomic():
            PlaylistLike.objects.create(playlist=pl, profile=me)
            if not owner.is_bot:
                Profile.objects.filter(id=owner.id).update(vibe=models.F("vibe") + PLAYLIST_LIKE_VIBE)
    except IntegrityError:
        return False
    if owner.is_bot:
        return True
    owner.refresh_from_db(fields=["vibe"])
    # Пуш — не чаще раза в 10 минут от одного человека одному создателю:
    # лайкнул подряд несколько его плейлистов — одно уведомление.
    recent = PlaylistLike.objects.filter(
        profile=me, playlist__owner=owner, created_at__gte=timezone.now() - timedelta(minutes=10),
    ).exclude(playlist=pl).exists()
    from .ideabox import _notify_vibe
    _notify_vibe(owner, me, anonymous=False, playlist=pl.name, push=not recent)
    return True


def unlike(pl: Playlist, me: Profile) -> bool:
    """Снять лайк. True — был (вайб у создателя снят обратно)."""
    with transaction.atomic():
        n, _ = PlaylistLike.objects.filter(playlist=pl, profile=me).delete()
        if n and not pl.owner.is_bot:
            Profile.objects.filter(id=pl.owner_id).update(vibe=models.F("vibe") - PLAYLIST_LIKE_VIBE)
    return bool(n)
