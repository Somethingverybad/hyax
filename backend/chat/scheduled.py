"""Отложенные сообщения: «Отложенная отправка» в меню по удержанию «Отправить».

Сообщение лежит в ScheduledMessage до send_at, потом фоновый цикл (по потоку
в каждом процессе api, как сэмплер метрик) отправляет его от имени автора
обычным POST /api/messages/ — тем же кодом, что и живую отправку: пуши,
упоминания, эффекты, проверка прав на тот момент. Процессов несколько, поэтому
сообщение сначала захватывается условным UPDATE: взял один — другой не возьмёт.

API:
  GET    /api/scheduled/?chat=<id>    — мои отложенные (в чате или все)
  POST   /api/scheduled/              — {chat, send_at, content, entities?,
                                         reply_to_id?, effect?, silent?}
  PATCH  /api/scheduled/<id>/         — {send_at} — перенести (и снять ошибку)
  DELETE /api/scheduled/<id>/         — не отправлять
  POST   /api/scheduled/<id>/send/    — отправить сейчас
"""
from __future__ import annotations

import logging
import os
import threading
import time
from datetime import timedelta, timezone as dt_timezone

from django.db import close_old_connections
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.views import APIView

logger = logging.getLogger(__name__)

POLL_EVERY = 10
MAX_PER_USER = 200
MAX_AHEAD = timedelta(days=366)
# Захвачено и не отправлено дольше этого — процесс упал посреди: повторно не
# шлём (вдруг ушло), а показываем ошибку — автор решит сам.
STALE_CLAIM = timedelta(minutes=5)
KINDS = ("direct", "group", "channel", "saved")
# Что из тела запроса уходит в отправку.
PAYLOAD_KEYS = ("content", "entities", "reply_to_id", "reply_quote", "effect", "silent")


def _item(s) -> dict:
    p = s.payload or {}
    return {
        "id": str(s.id), "chat": str(s.chat_id), "send_at": s.send_at.isoformat(),
        "content": p.get("content") or "", "entities": p.get("entities") or [],
        "reply_to_id": p.get("reply_to_id"), "effect": p.get("effect") or "",
        "silent": bool(p.get("silent")), "error": s.error or "",
    }


def _profile(request):
    return getattr(request.user, "profile", None)


def _can_schedule(chat, me) -> str | None:
    """Причина отказа или None. Окончательно права проверит отправка."""
    from .models import ChatParticipant
    if chat.kind not in KINDS:
        return "Сюда нельзя отложить сообщение"
    if chat.pending_for_id:
        return "Собеседник ещё не принял запрос на переписку"
    cp = ChatParticipant.objects.filter(chat=chat, user=me).first()
    if not cp:
        return "Вы не участник этого чата"
    if chat.kind == "channel" and cp.role not in ("owner", "admin"):
        return "Публиковать в канал могут только его админы"
    return None


def deliver(item) -> tuple[bool, str]:
    """Отправить отложенное обычным POST /api/messages/ от имени автора.
    → (ушло ли, id сообщения или текст ошибки)."""
    from rest_framework.test import APIRequestFactory, force_authenticate
    from .views import MessageViewSet
    body = {k: v for k, v in (item.payload or {}).items() if k in PAYLOAD_KEYS and v not in (None, "", [])}
    body["chat"] = str(item.chat_id)
    req = APIRequestFactory().post("/api/messages/", body, format="json", HTTP_HOST="localhost")
    force_authenticate(req, user=item.sender.user)
    try:
        resp = MessageViewSet.as_view({"post": "create"})(req)
    except Exception as e:  # отправка не должна ронять цикл
        logger.exception("отложенное %s: отправка упала", item.id)
        return False, str(e)[:200] or "Не удалось отправить"
    data = getattr(resp, "data", None) or {}
    if 200 <= resp.status_code < 300:
        return True, str(data.get("id") or "")
    err = data.get("error") if isinstance(data, dict) else None
    return False, str(err or f"Не удалось отправить ({resp.status_code})")[:300]


def deliver_due(now=None, limit: int = 20) -> int:
    """Отправить созревшие; → сколько ушло."""
    from .models import ScheduledMessage
    now = now or timezone.now()
    sent = 0
    due = list(ScheduledMessage.objects.filter(send_at__lte=now, claimed_at__isnull=True, error="")
               .select_related("sender__user").order_by("send_at")[:limit])
    for item in due:
        if not ScheduledMessage.objects.filter(pk=item.pk, claimed_at__isnull=True).update(claimed_at=timezone.now()):
            continue  # взял другой процесс
        ok, info = deliver(item)
        if ok:
            logger.info("отложенное %s ушло: сообщение %s", item.pk, info)
            item.delete()
            sent += 1
        else:
            ScheduledMessage.objects.filter(pk=item.pk).update(error=info or "Не удалось отправить", claimed_at=None)
            logger.warning("отложенное %s не ушло: %s", item.pk, info)
    ScheduledMessage.objects.filter(claimed_at__lt=now - STALE_CLAIM, error="").update(
        error="Не удалось отправить вовремя", claimed_at=None)
    return sent


_started = False
_lock = threading.Lock()


def _loop():
    while True:
        time.sleep(POLL_EVERY)
        try:
            close_old_connections()
            deliver_due()
        except Exception:
            logger.exception("отложенные: цикл")
        finally:
            close_old_connections()


def start_scheduler():
    """Один поток на процесс; зовёт asgi.py. Повторный вызов ничего не делает."""
    global _started
    if os.environ.get("HYAX_SCHEDULER_OFF"):
        return
    with _lock:
        if _started:
            return
        _started = True
    threading.Thread(target=_loop, name="scheduled-messages", daemon=True).start()
    logger.info("отложенные: цикл запущен, шаг %s с", POLL_EVERY)


def _parse_when(raw):
    when = parse_datetime(str(raw or ""))
    if not when:
        return None
    if timezone.is_naive(when):
        when = timezone.make_aware(when, dt_timezone.utc)
    return when


class ScheduledListView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        from .models import ScheduledMessage
        me = _profile(request)
        if not me:
            return Response({"error": "Нет профиля"}, status=403)
        qs = ScheduledMessage.objects.filter(sender=me)
        chat = request.query_params.get("chat")
        if chat:
            qs = qs.filter(chat_id=chat)
        return Response({"scheduled": [_item(s) for s in qs.order_by("send_at")[:500]]})

    def post(self, request):
        from .models import Chat, ScheduledMessage
        me = _profile(request)
        if not me:
            return Response({"error": "Нет профиля"}, status=403)
        chat = Chat.objects.filter(id=request.data.get("chat")).first() if request.data.get("chat") else None
        if not chat:
            return Response({"error": "Чат не найден"}, status=404)
        why = _can_schedule(chat, me)
        if why:
            return Response({"error": why}, status=403)
        content = str(request.data.get("content") or "").strip()
        if not content:
            return Response({"error": "Пустое сообщение"}, status=400)
        when = _parse_when(request.data.get("send_at"))
        now = timezone.now()
        if not when or when <= now + timedelta(seconds=5):
            return Response({"error": "Время отправки должно быть в будущем"}, status=400)
        if when > now + MAX_AHEAD:
            return Response({"error": "Не дальше чем через год"}, status=400)
        if ScheduledMessage.objects.filter(sender=me).count() >= MAX_PER_USER:
            return Response({"error": "Слишком много отложенных сообщений"}, status=409)
        payload = {k: request.data.get(k) for k in PAYLOAD_KEYS if request.data.get(k) not in (None, "", [])}
        payload["content"] = content
        payload["silent"] = request.data.get("silent") in (True, "true", "1", 1)
        s = ScheduledMessage.objects.create(chat=chat, sender=me, send_at=when, payload=payload)
        return Response(_item(s), status=201)


class ScheduledItemView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def _mine(self, request, pk):
        from .models import ScheduledMessage
        return ScheduledMessage.objects.filter(id=pk, sender=_profile(request)).first()

    def patch(self, request, pk):
        s = self._mine(request, pk)
        if not s or s.claimed_at:
            return Response({"error": "Сообщение уже отправляется или его нет"}, status=404)
        when = _parse_when(request.data.get("send_at"))
        now = timezone.now()
        if not when or when <= now + timedelta(seconds=5) or when > now + MAX_AHEAD:
            return Response({"error": "Время отправки должно быть в будущем"}, status=400)
        s.send_at = when
        s.error = ""
        s.save(update_fields=["send_at", "error"])
        return Response(_item(s))

    def delete(self, request, pk):
        s = self._mine(request, pk)
        if not s:
            return Response(status=204)
        from .models import ScheduledMessage
        # Уже взято на отправку — поздно отменять.
        if not ScheduledMessage.objects.filter(pk=s.pk, claimed_at__isnull=True).delete()[0]:
            return Response({"error": "Сообщение уже отправляется"}, status=409)
        return Response(status=204)


class ScheduledSendView(APIView):
    """Отправить отложенное прямо сейчас."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        from .models import ScheduledMessage
        s = ScheduledMessage.objects.filter(id=pk, sender=_profile(request)).select_related("sender__user").first()
        if not s:
            return Response({"error": "Сообщения нет"}, status=404)
        if not ScheduledMessage.objects.filter(pk=s.pk, claimed_at__isnull=True).update(claimed_at=timezone.now()):
            return Response({"error": "Сообщение уже отправляется"}, status=409)
        ok, info = deliver(s)
        if ok:
            s.delete()
            return Response({"ok": True, "message_id": info})
        ScheduledMessage.objects.filter(pk=s.pk).update(error=info, claimed_at=None)
        return Response({"error": info}, status=400)
