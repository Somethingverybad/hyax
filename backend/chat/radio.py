"""Радиостанции: плейлист в эфире, который слушают вместе.

Звук не транслируется — каждый слушатель играет тот же файл с той же секунды.
Сервер хранит только расписание (Station: «трек anchor_track начался в
anchor_at», дальше по порядку плейлиста по кругу) и отдаёт клиенту текущий
трек с моментом его начала по своим часам. Клиент сверяет часы и
перематывает на нужное место (sux-chat-app/src/lib/radio.ts).

Кто видит эфир: личный — собеседники владельца по личке (те же, что видят
открытые плейлисты, views._music_contacts); от канала — его подписчики.
"""
from __future__ import annotations

import logging
import os
import subprocess
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

from django.conf import settings
from django.db import close_old_connections
from django.db.models import Q
from django.utils import timezone
from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Chat, ChatParticipant, Playlist, PlaylistTrack, Station, StationListener
from .serializers import PlaylistTrackSerializer

logger = logging.getLogger(__name__)

#: Слушатель отмечается раз в 15 с; кто молчит дольше — уже не слушает.
LISTENER_TTL = timedelta(seconds=45)
#: Сколько следующих треков показываем в «Дальше».
UPCOMING = 3
#: Короче — не трек (или длительность не узнали): в эфир не берём.
MIN_DURATION = 1


def _ms(dt) -> int:
    return int(dt.timestamp() * 1000)


# ---- Длительности ----

def _probe(file_url: str) -> float | None:
    """Длительность файла через ffprobe: по ней строится расписание эфира.
    Приватный файл в S3 читаем по временной подписанной ссылке."""
    src = None
    if file_url.startswith("s3://"):
        from .s3 import s3_enabled, presigned_get
        if s3_enabled():
            src = presigned_get(file_url[len("s3://"):], 600)
    elif file_url.startswith("/media/"):
        src = os.path.join(str(settings.MEDIA_ROOT), file_url[len("/media/"):])
    elif file_url.startswith(("http://", "https://")):
        src = file_url
    if not src:
        return None
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", src],
            capture_output=True, text=True, timeout=10,
        ).stdout.strip()
        d = float(out or 0)
        return d if d > MIN_DURATION else None
    except Exception:
        logger.warning("radio: ffprobe не узнал длительность %s", file_url[:80])
        return None


def fill_durations(playlist_id, limit=200) -> None:
    """Узнать длительность треков, у которых её нет (у музыки из переписки её
    нет никогда). Пишем во все строки с тем же файлом: трек часто лежит в
    нескольких плейлистах. Трек с длительностью сразу встаёт в очередь эфира —
    поэтому сначала закрепляем текущий трек у всех затронутых эфиров."""
    rows = (PlaylistTrack.objects.filter(playlist_id=playlist_id, duration__isnull=True)
            .order_by("position", "added_at").values_list("file_url", flat=True))
    urls = list(dict.fromkeys(rows))[:limit]
    if not urls:
        return
    with ThreadPoolExecutor(max_workers=6) as pool:
        found = {u: d for u, d in zip(urls, pool.map(_probe, urls)) if d}
    if not found:
        return
    targets = PlaylistTrack.objects.filter(file_url__in=list(found), duration__isnull=True)
    for pid in set(targets.values_list("playlist_id", flat=True)):
        before_playlist_change(pid)
    for url, d in found.items():
        PlaylistTrack.objects.filter(file_url=url, duration__isnull=True).update(duration=round(d, 2))


def fill_track_duration(track) -> None:
    """Длительность одного трека — сразу: добавили в плейлист, который в
    эфире, и он должен встать в очередь (а «следующим» — прямо сейчас)."""
    if track.duration:
        return
    d = _probe(track.file_url)
    if not d:
        return
    for pid in set(PlaylistTrack.objects.filter(file_url=track.file_url, duration__isnull=True)
                   .values_list("playlist_id", flat=True)):
        before_playlist_change(pid)
    PlaylistTrack.objects.filter(file_url=track.file_url, duration__isnull=True).update(duration=round(d, 2))
    track.duration = round(d, 2)


def fill_durations_later(playlist_id) -> None:
    """То же в фоне — когда трек добавили в плейлист, который уже в эфире."""
    def run():
        try:
            fill_durations(playlist_id)
        except Exception:
            logger.exception("radio: длительности в фоне")
        finally:
            close_old_connections()
    threading.Thread(target=run, daemon=True).start()


# ---- Расписание ----

def _queue(st):
    return list(
        PlaylistTrack.objects.filter(playlist_id=st.playlist_id, duration__gt=MIN_DURATION)
        .order_by("position", "added_at")
    )


def _walk(st, tracks, at):
    """Какой трек играет в момент at и когда он начался: от якоря по порядку,
    целые круги плейлиста пропускаем арифметикой."""
    idx = next((i for i, t in enumerate(tracks) if t.id == st.anchor_track_id), None)
    if idx is None:
        # Якорь пропал (трек убрали) — эфир идёт со следующего по месту.
        idx = next((i for i, t in enumerate(tracks) if t.position > st.anchor_position), 0)
    start = st.anchor_at
    total = sum(t.duration for t in tracks)
    elapsed = max(0.0, (at - start).total_seconds())
    if elapsed >= total:
        loops = int(elapsed // total)
        start += timedelta(seconds=loops * total)
        elapsed -= loops * total
    i = idx
    while elapsed >= tracks[i].duration:
        elapsed -= tracks[i].duration
        start += timedelta(seconds=tracks[i].duration)
        i = (i + 1) % len(tracks)
    return i, start


def _rebase(st, now, tracks=None):
    """Якорь — на текущий трек. Тогда правка плейлиста меняет только то, что
    дальше, и обход от якоря всегда короткий. → (треки, индекс текущего)."""
    tracks = _queue(st) if tracks is None else tracks
    if not tracks:
        return tracks, None
    i, start = _walk(st, tracks, st.paused_at or now)
    cur = tracks[i]
    if cur.id != st.anchor_track_id or start != st.anchor_at:
        st.anchor_track = cur
        st.anchor_position = cur.position
        st.anchor_at = start
        st.save(update_fields=["anchor_track", "anchor_position", "anchor_at"])
    return tracks, i


def before_playlist_change(playlist_id) -> None:
    """Перед правкой плейлиста закрепить текущий трек у его эфиров."""
    now = timezone.now()
    for st in Station.objects.filter(playlist_id=playlist_id):
        _rebase(st, now)


def before_track_removed(track) -> None:
    """Убирают трек, который сейчас в эфире, — эфир сразу идёт со следующего,
    с его начала (иначе слушатели попали бы в середину чужого трека)."""
    now = timezone.now()
    for st in Station.objects.filter(playlist_id=track.playlist_id):
        tracks, i = _rebase(st, now)
        if i is None or tracks[i].id != track.id:
            continue
        rest = [t for t in tracks if t.id != track.id]
        if not rest:
            continue
        nxt = tracks[(i + 1) % len(tracks)]
        st.anchor_track = nxt
        st.anchor_position = nxt.position
        st.anchor_at = st.paused_at or now
        st.save(update_fields=["anchor_track", "anchor_position", "anchor_at"])


# ---- Кто видит и кто ведёт ----

def _admin_channels(me):
    return list(ChatParticipant.objects.filter(user=me, chat__kind="channel", role__in=("owner", "admin"))
                .values_list("chat_id", flat=True))


def visible_stations(me):
    """Эфиры, которые мне видны: свой; собеседников по личке; ботов-диджеев,
    с которыми я начал диалог; каналов, на которые я подписан.

    Бот видит только свои эфиры и эфиры каналов, где он админ: слушателей
    он не собирает, а ведёт эфир через API (документация — bots.html)."""
    from .views import _music_contacts
    if not me:
        return Station.objects.none()
    if me.is_bot:
        return Station.objects.filter(Q(owner=me) | Q(channel_id__in=_admin_channels(me))).select_related("owner", "channel", "playlist")
    # Боты-диджеи: личка с ботом, где человек нажал «Начать».
    dj = set(ChatParticipant.objects.filter(
        chat__participants=me, chat__kind="direct", chat__bot_started=True, user__is_bot=True,
    ).values_list("user_id", flat=True))
    owners = _music_contacts(me) | dj | {me.id}
    channels = list(ChatParticipant.objects.filter(user=me, chat__kind="channel").values_list("chat_id", flat=True))
    return Station.objects.filter(
        Q(channel__isnull=True, owner_id__in=owners) | Q(channel_id__in=channels)
    ).select_related("owner", "channel", "playlist")


def next_position(playlist) -> int:
    """Место для трека «следующим»: сразу за тем, что сейчас в эфире этого
    плейлиста (остальные сдвигаются). Плейлист не в эфире — в конец."""
    from django.db.models import F
    st = Station.objects.filter(playlist=playlist).first()
    if st:
        tracks, i = _rebase(st, timezone.now())
        if i is not None:
            p = tracks[i].position
            PlaylistTrack.objects.filter(playlist=playlist, position__gt=p).update(position=F("position") + 1)
            Station.objects.filter(playlist=playlist, anchor_position__gt=p).update(anchor_position=F("anchor_position") + 1)
            return p + 1
    last = PlaylistTrack.objects.filter(playlist=playlist).order_by("-position").values_list("position", flat=True).first() or 0
    return last + 1


def _visible(me, pk):
    return visible_stations(me).filter(id=pk).first()


def _can_control(st, me) -> bool:
    """Ведёт личный эфир владелец, эфир канала — любой его админ."""
    if st.channel_id:
        return ChatParticipant.objects.filter(chat_id=st.channel_id, user=me, role__in=("owner", "admin")).exists()
    return st.owner_id == me.id


def track_on_air_for(me, *, file_url=None, track_id=None) -> bool:
    """Трек из эфира, который мне виден: его можно слушать и забрать себе."""
    qs = PlaylistTrack.objects.filter(playlist__stations__in=visible_stations(me))
    if file_url is not None:
        qs = qs.filter(file_url=file_url)
    if track_id is not None:
        qs = qs.filter(id=track_id)
    return qs.exists()


# ---- Ответ клиенту ----

def _brief(p):
    return {"id": str(p.id), "username": p.username, "avatar_url": p.avatar_url}


def _station_info(st, me, now, tracks=None, idx=None):
    if tracks is None:
        tracks, idx = _rebase(st, now)
    live = StationListener.objects.filter(station=st, seen_at__gte=now - LISTENER_TTL).select_related("profile")
    cur = tracks[idx] if idx is not None else None
    return {
        "id": str(st.id),
        "name": st.playlist.name,
        "is_default": st.playlist.is_default,
        "playlist_id": str(st.playlist_id),
        "owner": _brief(st.owner),
        "channel": ({"id": str(st.channel.id), "name": st.channel.name, "avatar_url": st.channel.avatar_url}
                    if st.channel_id else None),
        "mine": st.owner_id == me.id,
        "can_control": _can_control(st, me),
        "paused": bool(st.paused_at),
        "listeners": live.count(),
        "listeners_preview": [_brief(x.profile) for x in live.order_by("-seen_at")[:5]],
        "now_title": cur.title if cur else "",
        "now_artist": cur.artist if cur else "",
        "tracks_count": len(tracks),
    }


def station_state(st, me):
    """Полное состояние эфира: что играет, с какого момента, что дальше и
    время сервера — по нему клиент сверяет часы."""
    now = timezone.now()
    tracks, idx = _rebase(st, now)
    payload = {"station": _station_info(st, me, now, tracks, idx), "server_now": _ms(now), "now": None, "next": []}
    if idx is None:
        return payload
    cur = tracks[idx]
    payload["now"] = {"track": PlaylistTrackSerializer(cur).data, "started_at": _ms(st.anchor_at)}
    if st.paused_at:
        payload["now"]["position"] = max(0.0, (st.paused_at - st.anchor_at).total_seconds())
    t = st.anchor_at + timedelta(seconds=cur.duration)
    j = idx
    for _ in range(min(UPCOMING, len(tracks) - 1)):
        j = (j + 1) % len(tracks)
        payload["next"].append({"track": PlaylistTrackSerializer(tracks[j]).data, "started_at": _ms(t)})
        t += timedelta(seconds=tracks[j].duration)
    return payload


def _me(request):
    from .views import _prof
    return _prof(request)


# ---- Эндпоинты ----

class StationsView(APIView):
    """GET — эфиры, которые мне видны, и каналы, от имени которых я могу
    вести эфир. POST {playlist_id, channel_id?} — запустить эфир (или
    поставить в уже идущий другой плейлист — с первого трека)."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        me = _me(request)
        if not me:
            return Response({"error": "Нет профиля"}, status=403)
        now = timezone.now()
        rows = [_station_info(st, me, now) for st in visible_stations(me)[:100]]
        rows = [r for r in rows if r["tracks_count"]]
        rows.sort(key=lambda r: (not r["mine"], -r["listeners"]))
        channels = Chat.objects.filter(
            kind="channel", chatparticipant__user=me, chatparticipant__role__in=("owner", "admin"),
        ).distinct()
        return Response({
            "stations": rows,
            "channels": [{"id": str(c.id), "name": c.name, "avatar_url": c.avatar_url} for c in channels],
        })

    def post(self, request):
        me = _me(request)
        if not me:
            return Response({"error": "Нет профиля"}, status=403)
        pl = Playlist.objects.filter(id=request.data.get("playlist_id"), owner=me).first()
        if not pl:
            return Response({"error": "Плейлист не найден"}, status=404)
        channel = None
        if request.data.get("channel_id"):
            channel = Chat.objects.filter(id=request.data.get("channel_id"), kind="channel").first()
            if not channel or not ChatParticipant.objects.filter(chat=channel, user=me, role__in=("owner", "admin")).exists():
                return Response({"error": "Эфир от канала ведут его админы"}, status=403)
        # Расписание строится по длительностям: первые треки узнаём сразу,
        # остальные — в фоне, они встанут в очередь по мере готовности.
        fill_durations(pl.id, limit=12)
        fill_durations_later(pl.id)
        first = PlaylistTrack.objects.filter(playlist=pl, duration__gt=MIN_DURATION).order_by("position", "added_at").first()
        if not first:
            return Response({"error": "В плейлисте нет треков, которые можно поставить в эфир"}, status=400)
        st = (Station.objects.filter(channel=channel).first() if channel
              else Station.objects.filter(owner=me, channel__isnull=True).first())
        fields = dict(playlist=pl, anchor_track=first, anchor_position=first.position,
                      anchor_at=timezone.now(), paused_at=None)
        if st:
            for k, v in fields.items():
                setattr(st, k, v)
            st.owner = me
            st.save()
        else:
            st = Station.objects.create(owner=me, channel=channel, **fields)
        return Response(station_state(st, me), status=201)


class StationView(APIView):
    """GET — состояние эфира. DELETE — остановить эфир (владелец, админ канала)."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk):
        me = _me(request)
        st = _visible(me, pk)
        if not st:
            return Response({"error": "Эфир закончился"}, status=404)
        return Response(station_state(st, me))

    def delete(self, request, pk):
        me = _me(request)
        st = _visible(me, pk)
        if not st or not _can_control(st, me):
            return Response({"error": "Эфир не найден"}, status=404)
        st.delete()
        return Response(status=204)


class StationControlView(APIView):
    """POST {action: skip | pause | resume | play, track_id?} — ведущий
    управляет эфиром. play — сразу включить трек track_id из плейлиста эфира."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        me = _me(request)
        st = _visible(me, pk)
        if not st or not _can_control(st, me):
            return Response({"error": "Эфир не найден"}, status=404)
        action = request.data.get("action")
        now = timezone.now()
        tracks, i = _rebase(st, now)
        if i is None:
            return Response({"error": "В эфире нет треков"}, status=400)
        if action == "skip":
            nxt = tracks[(i + 1) % len(tracks)]
            st.anchor_track = nxt
            st.anchor_position = nxt.position
            st.anchor_at = st.paused_at or now
            st.save(update_fields=["anchor_track", "anchor_position", "anchor_at"])
        elif action == "play":
            target = next((t for t in tracks if str(t.id) == str(request.data.get("track_id"))), None)
            if not target:
                return Response({"error": "Трека нет в эфире (или длительность ещё не узнали)"}, status=404)
            st.anchor_track = target
            st.anchor_position = target.position
            st.anchor_at = st.paused_at or now
            st.save(update_fields=["anchor_track", "anchor_position", "anchor_at"])
        elif action == "pause":
            if not st.paused_at:
                st.paused_at = now
                st.save(update_fields=["paused_at"])
        elif action == "resume":
            if st.paused_at:
                # Эфир продолжается с того же места: сдвигаем начало трека на время паузы.
                st.anchor_at += now - st.paused_at
                st.paused_at = None
                st.save(update_fields=["anchor_at", "paused_at"])
        else:
            return Response({"error": "Неизвестное действие"}, status=400)
        return Response(station_state(st, me))


class StationListenView(APIView):
    """POST — «я слушаю» (раз в 15 с), в ответ — состояние эфира: по нему
    клиент заодно замечает пропуск трека и паузу. DELETE — перестал слушать."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        me = _me(request)
        st = _visible(me, pk)
        if not st:
            return Response({"error": "Эфир закончился"}, status=404)
        if me.is_bot:
            return Response({"error": "Боты эфир не слушают — только ведут"}, status=403)
        _, joined = StationListener.objects.update_or_create(station=st, profile=me, defaults={"seen_at": timezone.now()})
        # Пришёл в эфир — прослушивание его плейлиста (повтор в полчаса не в счёт).
        if joined and st.playlist_id:
            try:
                from .playlist_stats import count_play
                count_play(st.playlist, me)
            except Exception:
                logger.exception("radio: прослушивание плейлиста не засчитано")
        return Response(station_state(st, me))

    def delete(self, request, pk):
        me = _me(request)
        StationListener.objects.filter(station_id=pk, profile=me).delete()
        return Response(status=204)
