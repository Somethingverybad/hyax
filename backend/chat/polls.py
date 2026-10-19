"""Опросы в постах Стены.

Создаются вместе с постом: POST /api/messages/ с полем poll = {options,
anonymous}, вопрос — текст поста (content). Голосуют через
/api/posts/<id>/poll/ (POST {option} — голос или новый выбор, DELETE —
отозвать), кто голосовал — /api/posts/<id>/poll/voters/?option=<id>, только
в открытом опросе.

Результаты (сколько у каждого варианта) видит тот, кто уже проголосовал, и
автор; до голоса — только сколько всего голосов, чтобы чужие цифры не
подталкивали к выбору. Один вариант на человека.
"""
import json

from django.db import transaction
from django.db.models import Count

QUESTION_MAX = 300
OPTION_MAX = 100
MIN_OPTIONS, MAX_OPTIONS = 2, 10


def parse_poll(raw, question):
    """Что прислал клиент → ({options, anonymous}, None) или (None, ошибка)."""
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            return None, "Неверный опрос"
    if not isinstance(raw, dict):
        return None, "Неверный опрос"
    q = (question or "").strip()
    if not q:
        return None, "Напишите вопрос"
    if len(q) > QUESTION_MAX:
        return None, f"Вопрос — не длиннее {QUESTION_MAX} символов"
    options, seen = [], set()
    for o in raw.get("options") or []:
        text = str(o or "").strip()[:OPTION_MAX]
        if text and text.casefold() not in seen:
            seen.add(text.casefold())
            options.append(text)
    if len(options) < MIN_OPTIONS:
        return None, "Нужно хотя бы два разных варианта ответа"
    if len(options) > MAX_OPTIONS:
        return None, f"Вариантов — не больше {MAX_OPTIONS}"
    anonymous = raw.get("anonymous", True)
    if isinstance(anonymous, str):
        anonymous = anonymous.lower() not in ("0", "false", "no")
    return {"options": options, "anonymous": bool(anonymous)}, None


def create_poll(data):
    from .models import Poll, PollOption
    with transaction.atomic():
        poll = Poll.objects.create(anonymous=data["anonymous"])
        PollOption.objects.bulk_create([PollOption(poll=poll, text=t, order=i) for i, t in enumerate(data["options"])])
    return poll


def poll_payload(poll, me_id=None, author_id=None):
    """Опрос для клиента: варианты, мой голос; числа — проголосовавшим и автору."""
    from .models import PollVote
    counts = dict(PollVote.objects.filter(poll=poll).values_list("option_id").annotate(n=Count("id")))
    mine = set(PollVote.objects.filter(poll=poll, user_id=me_id).values_list("option_id", flat=True)) if me_id else set()
    results = bool(mine) or (me_id is not None and str(me_id) == str(author_id))
    return {
        "id": str(poll.id),
        "anonymous": poll.anonymous,
        "total": sum(counts.values()),
        "voted": [str(o) for o in mine],
        "results": results,
        "options": [{"id": str(o.id), "text": o.text, "votes": counts.get(o.id, 0) if results else None}
                    for o in poll.options.all()],
    }


# ---- голосование ----

from rest_framework import permissions  # noqa: E402
from rest_framework.response import Response  # noqa: E402
from rest_framework.views import APIView  # noqa: E402


def _post_for(request, pk):
    """(пост с опросом, я) или (None, ответ с ошибкой). Пост должен быть мне
    виден: на Стене — по правилам ленты (18+, скрытые, заблокированные)."""
    from .models import Message
    from .serializers import is_admin_profile
    from .views import _can_see_chat
    me = getattr(request.user, "profile", None)
    if not me:
        return None, Response({"error": "Profile not found"}, status=400)
    msg = Message.objects.filter(pk=pk, deleted_for_all=False).select_related("chat", "poll").first()
    if not msg or not msg.poll_id or not _can_see_chat(msg.chat, me):
        return None, Response({"error": "Опрос не найден"}, status=404)
    if msg.chat.kind == "wall":
        from .wall import feed_queryset
        if not feed_queryset(me, msg.chat, is_admin_profile(me)).filter(id=msg.id).exists():
            return None, Response({"error": "Опрос не найден"}, status=404)
    return (msg, me), None


class PollVoteView(APIView):
    """POST {option} — проголосовать или выбрать другой вариант; DELETE —
    отозвать голос. Ответ — {poll} с результатами."""
    permission_classes = [permissions.IsAuthenticated]

    def _done(self, request, msg, me):
        from .views import _touch_post
        # Сводка поста изменилась — пусть её принесёт обычная синхронизация.
        _touch_post(msg)
        return Response({"poll": poll_payload(msg.poll, me.id, msg.sender_id)})

    def post(self, request, pk):
        from .models import PollVote
        found, err = _post_for(request, pk)
        if err:
            return err
        msg, me = found
        option = msg.poll.options.filter(id=str(request.data.get("option") or "")).first() if request.data.get("option") else None
        if not option:
            return Response({"error": "Такого варианта нет"}, status=400)
        with transaction.atomic():
            PollVote.objects.filter(poll=msg.poll, user=me).exclude(option=option).delete()
            PollVote.objects.get_or_create(poll=msg.poll, user=me, defaults={"option": option})
        return self._done(request, msg, me)

    def delete(self, request, pk):
        from .models import PollVote
        found, err = _post_for(request, pk)
        if err:
            return err
        msg, me = found
        PollVote.objects.filter(poll=msg.poll, user=me).delete()
        return self._done(request, msg, me)


class PollVotersView(APIView):
    """GET ?option=<id> — кто выбрал вариант. Только в открытом опросе и только
    тем, кто видит результаты (проголосовал или автор)."""
    permission_classes = [permissions.IsAuthenticated]
    LIMIT = 200

    def get(self, request, pk):
        from .models import PollVote
        found, err = _post_for(request, pk)
        if err:
            return err
        msg, me = found
        if msg.poll.anonymous:
            return Response({"error": "Опрос анонимный"}, status=403)
        if msg.sender_id != me.id and not PollVote.objects.filter(poll=msg.poll, user=me).exists():
            return Response({"error": "Сначала проголосуйте"}, status=403)
        option = msg.poll.options.filter(id=str(request.query_params.get("option") or "")).first() if request.query_params.get("option") else None
        if not option:
            return Response({"error": "Такого варианта нет"}, status=400)
        votes = option.votes.select_related("user").order_by("-created_at")
        return Response({
            "count": votes.count(),
            "voters": [{"id": str(v.user_id), "username": v.user.username, "avatar_url": v.user.avatar_url}
                       for v in votes[: self.LIMIT]],
        })
