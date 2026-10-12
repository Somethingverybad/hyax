"""«Стена» — общая лента на всех: один системный чат kind="wall", без
участников (читают все, кто её не выключил). Посты — обычные Message в этом
чате, так что реакции, комментарии и просмотры — те же, что у каналов.

Правила видимости (см. feed_queryset):
- без отметки «Контент 4+» (wall_safe) пост считается 18+ и виден только тем,
  кто включил «Показывать 18+», и самому автору;
- wall_hidden (скрыл админ) видят только админы и автор;
- авторов, которых человек скрыл (WallMute) и заблокировал (Block), не видно.

Постить и комментировать может любой, кроме забаненных (WallBan: до даты
или навсегда). Репост из своего канала: копия поста с forwarded_chat — по
тапу на отправителя клиент открывает канал.
"""
import logging

from django.db.models import Q
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Chat, ChatParticipant, Message, Profile, WallBan, WallMute
from .moderation import blocked_ids
from .serializers import is_admin_profile

logger = logging.getLogger(__name__)

WALL_NAME = "Стена"


def wall_chat():
    chat = Chat.objects.filter(kind="wall").first()
    if not chat:
        chat = Chat.objects.create(kind="wall", name=WALL_NAME, is_public=True, sign_posts=True)
    return chat


def wall_ban(profile):
    """Действующий бан профиля или None. Просроченный — снимаем по пути."""
    if not profile:
        return None
    ban = WallBan.objects.filter(user=profile).first()
    if not ban:
        return None
    if not ban.active:
        ban.delete()
        return None
    return ban


def ban_payload(ban):
    return {"until": ban.until.isoformat() if ban.until else None, "reason": ban.reason,
            "created_at": ban.created_at.isoformat()}


def _prof(request):
    return getattr(request.user, "profile", None)


def feed_queryset(me, chat, admin=False):
    """Посты Стены, которые видит me (без удалённых у всех)."""
    qs = Message.objects.filter(chat=chat, deleted_for_all=False).select_related("sender", "sound", "forwarded_chat")
    hidden = Q(sender_id__in=list(WallMute.objects.filter(user=me).values_list("author_id", flat=True)) + list(blocked_ids(me)))
    qs = qs.exclude(hidden)
    mine = Q(sender_id=me.id)
    if not me.allow_adult:
        qs = qs.filter(Q(wall_safe=True) | mine)
    if not admin:
        qs = qs.filter(Q(wall_hidden=False) | mine)
    return qs


def _state(me, chat):
    from .models import WallBan as _WB  # noqa — для единообразия импорта
    admin = is_admin_profile(me)
    new_count = 0
    if me.wall_enabled:
        q = feed_queryset(me, chat, admin).exclude(sender_id=me.id)
        if me.wall_seen_at:
            q = q.filter(created_at__gt=me.wall_seen_at)
        new_count = min(q.count(), 99)
    ban = wall_ban(me)
    return {
        "id": str(chat.id), "name": chat.name or WALL_NAME, "kind": "wall",
        "enabled": me.wall_enabled, "new_count": new_count,
        "ban": ban_payload(ban) if ban else None,
        "is_admin": admin,
        "muted_authors": [
            {"id": str(m.author_id), "username": m.author.username, "avatar_url": m.author.avatar_url}
            for m in WallMute.objects.filter(user=me).select_related("author")
        ],
    }


class WallView(APIView):
    """GET — состояние Стены для меня; PATCH {enabled} — включить/выключить."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        me = _prof(request)
        if not me:
            return Response({"error": "Profile not found"}, status=400)
        return Response(_state(me, wall_chat()))

    def patch(self, request):
        me = _prof(request)
        if not me:
            return Response({"error": "Profile not found"}, status=400)
        if "enabled" in request.data:
            me.wall_enabled = bool(request.data.get("enabled"))
            me.save(update_fields=["wall_enabled"])
        return Response(_state(me, wall_chat()))


class WallSeenView(APIView):
    """POST — я открыл Стену: «новых постов» снова ноль."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        me = _prof(request)
        if not me:
            return Response({"error": "Profile not found"}, status=400)
        me.wall_seen_at = timezone.now()
        me.save(update_fields=["wall_seen_at"])
        return Response({"ok": True})


class WallPostsView(APIView):
    """GET — лента, как у канала: limit, before=<ISO>, since=<ISO> →
    {posts, deleted, has_more, now}. В since-режиме скрытые и исчезнувшие
    для меня посты приходят в deleted, чтобы клиент убрал их из кэша."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        from .views import _post_payload
        me = _prof(request)
        if not me:
            return Response({"error": "Profile not found"}, status=400)
        chat = wall_chat()
        admin = is_admin_profile(me)
        try:
            limit = max(1, min(int(request.query_params.get("limit") or 50), 200))
        except ValueError:
            limit = 50
        now = timezone.now()
        visible = feed_queryset(me, chat, admin)
        since = parse_datetime(request.query_params.get("since") or "")
        if since:
            changed = list(Message.objects.filter(chat=chat, updated_at__gt=since).order_by("created_at"))
            ok_ids = set(visible.filter(updated_at__gt=since).values_list("id", flat=True))
            return Response({
                "posts": [_post_payload(m, request) for m in changed if m.id in ok_ids],
                "deleted": [str(m.id) for m in changed if m.id not in ok_ids],
                "has_more": False, "now": now.isoformat(),
            })
        before = parse_datetime(request.query_params.get("before") or "")
        qs = visible.filter(created_at__lt=before) if before else visible
        page = list(qs.order_by("-created_at")[: limit + 1])
        has_more = len(page) > limit
        posts = page[:limit][::-1]
        return Response({"posts": [_post_payload(m, request) for m in posts], "deleted": [],
                         "has_more": has_more, "now": now.isoformat()})


class WallMuteView(APIView):
    """POST {profile_id} — скрыть автора; DELETE {profile_id} — вернуть."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        me = _prof(request)
        author = Profile.objects.filter(id=request.data.get("profile_id")).first()
        if not me or not author:
            return Response({"error": "Профиль не найден"}, status=404)
        if author.id == me.id:
            return Response({"error": "Себя скрыть нельзя"}, status=400)
        WallMute.objects.get_or_create(user=me, author=author)
        return Response(_state(me, wall_chat()))

    def delete(self, request):
        me = _prof(request)
        if not me:
            return Response({"error": "Profile not found"}, status=400)
        WallMute.objects.filter(user=me, author_id=request.data.get("profile_id")).delete()
        return Response(_state(me, wall_chat()))


class WallRepostView(APIView):
    """POST {message_id, wall_safe} — репост поста своего канала на Стену.
    Только владелец/админ канала-источника: по тапу на отправителя читатели
    попадут в этот канал."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        from .views import _forward_copy, _post_payload
        me = _prof(request)
        if not me:
            return Response({"error": "Profile not found"}, status=400)
        ban = wall_ban(me)
        if ban:
            return Response({"error": "Вам запрещено писать на Стену", "wall_ban": ban_payload(ban)}, status=403)
        src = Message.objects.filter(id=request.data.get("message_id"), deleted_for_all=False).select_related("chat").first()
        if not src or src.chat.kind != "channel":
            return Response({"error": "Пост канала не найден"}, status=404)
        role = ChatParticipant.objects.filter(chat=src.chat, user=me).values_list("role", flat=True).first()
        if role not in ("owner", "admin"):
            return Response({"error": "На Стену можно репостить только из своего канала"}, status=403)
        chat = wall_chat()
        msg = _forward_copy(src, chat, me)
        # Репост всегда подписан каналом — по нему и переходят.
        msg.forwarded_chat = src.chat
        msg.forwarded_title = (src.chat.name or "Канал")[:120]
        msg.wall_safe = str(request.data.get("wall_safe") or "").lower() in ("1", "true", "yes")
        msg.save(update_fields=["forwarded_chat", "forwarded_title", "wall_safe", "updated_at"])
        return Response(_post_payload(msg, request), status=201)


def _admin_or_403(request):
    me = _prof(request)
    if not me or not is_admin_profile(me):
        return None, Response({"error": "Только для админов"}, status=403)
    return me, None


class WallAdminPostView(APIView):
    """PATCH {hidden?, wall_safe?} — админ меняет видимость поста."""
    permission_classes = [permissions.IsAuthenticated]

    def patch(self, request, pk):
        from .views import _post_payload
        me, err = _admin_or_403(request)
        if err:
            return err
        msg = Message.objects.filter(id=pk, chat__kind="wall").first()
        if not msg:
            return Response({"error": "Пост не найден"}, status=404)
        fields = []
        if "hidden" in request.data:
            msg.wall_hidden = bool(request.data.get("hidden")); fields.append("wall_hidden")
        if "wall_safe" in request.data:
            msg.wall_safe = bool(request.data.get("wall_safe")); fields.append("wall_safe")
        if fields:
            msg.save(update_fields=fields + ["updated_at"])
        return Response(_post_payload(msg, request))


class WallAdminBansView(APIView):
    """GET — действующие баны; POST {profile_id, hours?, reason?} — запретить
    (hours пусто — навсегда); DELETE {profile_id} — снять."""
    permission_classes = [permissions.IsAuthenticated]

    def _row(self, ban):
        return {"profile": {"id": str(ban.user_id), "username": ban.user.username, "avatar_url": ban.user.avatar_url},
                **ban_payload(ban)}

    def get(self, request):
        _, err = _admin_or_403(request)
        if err:
            return err
        rows = [b for b in WallBan.objects.select_related("user").order_by("-created_at") if b.active]
        return Response({"bans": [self._row(b) for b in rows]})

    def post(self, request):
        me, err = _admin_or_403(request)
        if err:
            return err
        target = Profile.objects.filter(id=request.data.get("profile_id")).first()
        if not target:
            return Response({"error": "Профиль не найден"}, status=404)
        if is_admin_profile(target):
            return Response({"error": "Админа забанить нельзя"}, status=400)
        until = None
        hours = request.data.get("hours")
        if hours not in (None, "", 0, "0"):
            try:
                until = timezone.now() + timezone.timedelta(hours=float(hours))
            except (TypeError, ValueError):
                return Response({"error": "Неверный срок"}, status=400)
        ban, _ = WallBan.objects.update_or_create(
            user=target, defaults={"until": until, "reason": str(request.data.get("reason") or "")[:200],
                                   "created_by": me, "created_at": timezone.now()})
        return Response(self._row(ban), status=201)

    def delete(self, request):
        _, err = _admin_or_403(request)
        if err:
            return err
        WallBan.objects.filter(user_id=request.data.get("profile_id")).delete()
        return Response({"ok": True})
