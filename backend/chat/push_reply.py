"""Ответ прямо из уведомления на iPhone (кнопка «Ответить» под пушем).

Приложение в этот момент может быть выгружено: страница не запущена, токена
входа у нативной части нет. Зато у каждого iPhone есть ключ шифрования пушей
(PushToken.secret, 32 байта в Keychain — см. fcm.py и PushSecretPlugin.swift):
сервер знает его только для этого устройства. Им нативная часть и подписывает
ответ — сервер узнаёт устройство по FCM-токену, проверяет подпись и отправляет
сообщение от владельца устройства тем же путём, что и обычная отправка
(MessageViewSet.create: права, блокировки, каналы, пуши получателям).

    POST /api/push/reply/
    {"token": <FCM-токен>, "chat_id": <uuid>, "text": "…", "ts": <unix, с>,
     "sig": base64(HMAC-SHA256(ключ, "token\\nchat_id\\nts\\ntext"))}

Подпись живёт REPLY_TTL секунд и принимается один раз (повтор — 409).
Выход с устройства удаляет его PushToken (chat/devices.py) — ответы с него
больше не принимаются.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import time

from django.core.cache import cache
from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Chat, ChatParticipant, PushToken

logger = logging.getLogger(__name__)

#: Сколько живёт подпись: телефон мог отправить ответ с задержкой (плохая сеть).
REPLY_TTL = 600
#: Длиннее ответ из уведомления не бывает — поле ввода системное и короткое.
TEXT_MAX = 4000
#: В каких чатах можно отвечать из уведомления (в пуше — поле reply=1).
REPLY_KINDS = ("direct", "group")


def can_reply(chat) -> bool:
    """Кнопка «Ответить» под пушем: личка и группа. Канал — пишут админы,
    секретный чат — текст шифрует само приложение, «Избранное» — пушей нет."""
    return getattr(chat, "kind", "") in REPLY_KINDS


def sign(secret_b64: str, token: str, chat_id: str, ts: int, text: str) -> str:
    key = base64.b64decode(secret_b64)
    msg = f"{token}\n{chat_id}\n{ts}\n{text}".encode()
    return base64.b64encode(hmac.new(key, msg, hashlib.sha256).digest()).decode()


class PushReplyView(APIView):
    authentication_classes = []
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        d = request.data if isinstance(request.data, dict) else {}
        token = str(d.get("token") or "").strip()
        chat_id = str(d.get("chat_id") or "").strip()
        text = str(d.get("text") or "")
        sig = str(d.get("sig") or "").strip()
        try:
            ts = int(d.get("ts"))
        except (TypeError, ValueError):
            ts = 0
        if not token or not chat_id or not sig or not text.strip():
            return Response({"error": "Пустой ответ"}, status=400)
        if len(text) > TEXT_MAX:
            return Response({"error": "Слишком длинный ответ"}, status=400)
        if abs(time.time() - ts) > REPLY_TTL:
            return Response({"error": "Подпись устарела"}, status=403)
        pt = (PushToken.objects.filter(token=token).exclude(platform="ios_voip")
              .select_related("user", "user__user").first())
        if not pt or not pt.secret:
            return Response({"error": "Устройство не найдено"}, status=403)
        try:
            good = hmac.compare_digest(sign(pt.secret, token, chat_id, ts, text), sig)
        except (ValueError, TypeError):
            good = False
        if not good:
            return Response({"error": "Неверная подпись"}, status=403)
        # Одна подпись — одно сообщение: перехваченный запрос не повторить.
        if not cache.add(f"push_reply:{sig}", 1, REPLY_TTL * 2):
            return Response({"error": "Уже отправлено"}, status=409)
        profile = pt.user
        chat = Chat.objects.filter(id=chat_id).only("id", "kind").first()
        if not chat or not can_reply(chat) or not ChatParticipant.objects.filter(chat=chat, user=profile).exists():
            return Response({"error": "Чат недоступен"}, status=403)
        return self._send(profile, chat, text)

    def _send(self, profile, chat, text):
        """Отправка тем же кодом, что и из приложения: внутренний запрос в
        MessageViewSet.create от имени владельца устройства."""
        from rest_framework.test import APIRequestFactory, force_authenticate
        from .views import MessageViewSet
        inner = APIRequestFactory().post("/api/messages/", {"chat": str(chat.id), "content": text}, format="json")
        force_authenticate(inner, user=profile.user)
        resp = MessageViewSet.as_view({"post": "create"})(inner)
        if resp.status_code >= 400:
            err = getattr(resp, "data", None)
            logger.info("push reply: %s → %s %s", str(profile.id)[:8], resp.status_code, err)
            msg = err.get("error") if isinstance(err, dict) else None
            return Response({"error": msg or "Не удалось отправить"}, status=resp.status_code)
        logger.info("push reply: %s ответил в %s", str(profile.id)[:8], str(chat.id)[:8])
        mid = resp.data.get("id") if isinstance(resp.data, dict) else None
        return Response({"ok": True, "id": str(mid) if mid else None}, status=201)
