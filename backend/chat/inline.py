"""Inline-боты — как в Telegram: «@ytbot mp3 название» в любом чате.

Ход дела:
  1. Клиент, увидев в поле «@бот запрос», зовёт POST bots/inline/query/ —
     боту в личный сокет уходит событие inline_query с query_id.
  2. Бот отвечает POST bots/inline/<query_id>/answer/ списком результатов —
     они уходят событием inline_results в личный сокет спросившего.
  3. Человек выбирает результат: POST bots/inline/<query_id>/choose/ создаёт
     в чате сообщение-заглушку от его имени с пометкой via_bot, а боту
     уходит inline_chosen с message_id.
  4. Бот готовит содержимое и заполняет заглушку: POST bots/inline/messages/<id>/.

Состояние запросов живёт в памяти процесса: api — один процесс daphne, и
слой каналов там тоже in-memory. Запросы живут десять минут.
"""
import logging
import secrets
import time

from django.utils import timezone
from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Chat, Message, Profile
from .serializers import MessageSerializer

logger = logging.getLogger(__name__)

QUERIES: dict[str, dict] = {}
TTL = 600
MAX_RESULTS = 20


def _prune():
    now = time.time()
    for k in [k for k, q in QUERIES.items() if now - q["at"] > TTL]:
        QUERIES.pop(k, None)


def _notify(profile_id, data):
    from channels.layers import get_channel_layer
    from asgiref.sync import async_to_sync
    layer = get_channel_layer()
    if layer:
        async_to_sync(layer.group_send)(f"user_{profile_id}", {"type": "notification", "data": data})


def _me(request):
    return getattr(request.user, "profile", None)


def _clean_result(r):
    if not isinstance(r, dict):
        return None
    rid = str(r.get("id") or "").strip()[:64]
    title = str(r.get("title") or "").strip()[:120]
    if not rid or not title:
        return None
    out = {"id": rid, "title": title}
    desc = str(r.get("description") or "").strip()[:200]
    if desc:
        out["description"] = desc
    thumb = str(r.get("thumb_url") or "").strip()[:500]
    if thumb.startswith("https://") or thumb.startswith("http://"):
        out["thumb_url"] = thumb
    return out


class InlineQueryView(APIView):
    """POST {bot, query, chat_id} — от человека. Ответ: {query_id}."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        me = _me(request)
        if not me or me.is_bot:
            return Response({"error": "Нет профиля"}, status=403)
        username = str(request.data.get("bot") or "").strip().lstrip("@")
        query = str(request.data.get("query") or "").strip()[:256]
        bot = Profile.objects.filter(is_bot=True, username__iexact=username).first()
        if not bot:
            return Response({"error": "Бот не найден"}, status=404)
        chat = Chat.objects.filter(id=request.data.get("chat_id")).first()
        from .views import _can_post_to
        if not chat or not _can_post_to(chat, me):
            return Response({"error": "В этот чат нельзя написать"}, status=403)
        _prune()
        qid = secrets.token_urlsafe(12)
        QUERIES[qid] = {"bot_id": str(bot.id), "user_id": str(me.id), "chat_id": str(chat.id), "query": query, "results": {}, "at": time.time()}
        _notify(bot.id, {
            "type": "inline_query", "query_id": qid, "query": query, "chat_id": str(chat.id),
            "from_id": str(me.id), "from_username": me.username,
        })
        return Response({"query_id": qid})


class InlineAnswerView(APIView):
    """POST {results: [{id, title, description?, thumb_url?}]} — от бота."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, query_id):
        bot = _me(request)
        q = QUERIES.get(query_id)
        if not bot or not bot.is_bot or not q or q["bot_id"] != str(bot.id):
            return Response({"error": "Запрос не найден или не ваш"}, status=404)
        raw = request.data.get("results")
        if not isinstance(raw, list):
            return Response({"error": "results — список"}, status=400)
        results = [r for r in (_clean_result(x) for x in raw[:MAX_RESULTS]) if r]
        q["results"] = {r["id"]: r for r in results}
        _notify(q["user_id"], {"type": "inline_results", "query_id": query_id, "bot": bot.username, "results": results})
        return Response({"ok": True, "count": len(results)})


class InlineChooseView(APIView):
    """POST {result_id} — человек выбрал строку. Ответ: сообщение-заглушка."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, query_id):
        me = _me(request)
        q = QUERIES.get(query_id)
        if not me or not q or q["user_id"] != str(me.id):
            return Response({"error": "Запрос не найден"}, status=404)
        rid = str(request.data.get("result_id") or "")
        res = q["results"].get(rid)
        if not res:
            return Response({"error": "Такого результата нет"}, status=400)
        chat = Chat.objects.filter(id=q["chat_id"]).first()
        bot = Profile.objects.filter(id=q["bot_id"], is_bot=True).first()
        from .views import _can_post_to, _notify_new_message
        if not chat or not bot or not _can_post_to(chat, me):
            return Response({"error": "В этот чат нельзя написать"}, status=403)
        msg = Message.objects.create(chat=chat, sender=me, via_bot=bot, content=f"⏳ {res['title']}")
        Chat.objects.filter(id=chat.id).update(updated_at=timezone.now())
        _notify_new_message(msg, me, request)
        _notify(bot.id, {
            "type": "inline_chosen", "query_id": query_id, "result_id": rid, "chat_id": str(chat.id),
            "message_id": str(msg.id), "from_id": str(me.id), "from_username": me.username,
        })
        return Response(MessageSerializer(msg, context={"request": request}).data, status=201)


class InlineFillView(APIView):
    """POST {content?, file_url?, file_name?, file_width?, file_height?} — бот
    заполняет свою заглушку. Полчаса на подготовку, потом заглушка чужая."""
    permission_classes = [permissions.IsAuthenticated]
    FIELDS = ("content", "file_url", "file_name", "file_width", "file_height", "voice_url", "voice_duration", "video_url", "video_duration", "download_only")

    def post(self, request, message_id):
        bot = _me(request)
        msg = Message.objects.filter(id=message_id).select_related("chat", "sender").first()
        if not bot or not bot.is_bot or not msg or msg.via_bot_id != bot.id:
            return Response({"error": "Сообщение не найдено или не ваше"}, status=404)
        if (timezone.now() - msg.created_at).total_seconds() > 1800:
            return Response({"error": "Слишком поздно"}, status=400)
        data = {k: request.data.get(k) for k in self.FIELDS if k in request.data}
        if not data:
            return Response({"error": "Нечего заполнять"}, status=400)
        if "content" not in data:
            data["content"] = ""
        if data.get("file_name"):
            data["file_name"] = str(data["file_name"])[:255]
        for k, v in data.items():
            setattr(msg, k, v)
        msg.save()  # updated_at — клиенты подтянут по sync
        from .views import _socket_new_message
        _socket_new_message(msg, request)
        return Response(MessageSerializer(msg, context={"request": request}).data)
