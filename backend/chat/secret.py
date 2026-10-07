"""Секретные чаты: сквозное шифрование один на один, ключ на двух устройствах.

Сервер — только почтальон: хранит открытые ключи ECDH обеих сторон
(SecretChat) и шифротекст сообщений (Message.cipher). Содержимое сообщений
он не видит и расшифровать не может: общий ключ вычисляется на устройствах.

Вложения (фото, видео, файлы, голосовые, кружки) шифруются на устройстве
своим ключом и грузятся как непрозрачный .bin; ключ файла едет внутри
зашифрованного сообщения. Нельзя: стикеры и звуки (сервер видел бы, какой),
пересылка, боты. Сервер это проверяет сам (create_secret_message), а не
полагается на клиент.

Поток: инициатор POST /secret-chats/ {peer_id, pub, device_id} → чат pending;
собеседник на одном из устройств POST /secret-chats/<id>/accept/ {pub,
device_id} → active; отказ — /decline/. Обе стороны получают событие
secret_chat в личный сокет и перечитывают чат.
"""
import base64
import re

from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Chat, ChatParticipant, Message, Profile, SecretChat

DEVICE_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
MAX_CIPHER = 256 * 1024  # текст + описание вложения с миниатюрой
# Вложение — шифротекст, загруженный обычной загрузкой как .bin (без обработки).
FILE_RE = re.compile(r"^(s3://messages/|/media/messages/)[0-9a-fA-F-]{36}\.bin$")
MAX_FILE = 55 * 1024 * 1024


def _valid_pub(b64: str) -> bool:
    """Открытый ключ P-256 в «сыром» виде: 65 байт, первый — 0x04."""
    try:
        raw = base64.b64decode(b64 or "", validate=True)
    except Exception:
        return False
    return len(raw) == 65 and raw[0] == 4


def secret_info(chat):
    """То, что клиенту нужно для ключа: состояние, устройства и открытые ключи."""
    s = getattr(chat, "secret", None)
    if not s:
        return None
    return {
        "state": s.state,
        "initiator_id": str(s.initiator_id),
        "initiator_device": s.initiator_device,
        "initiator_pub": s.initiator_pub,
        "responder_device": s.responder_device,
        "responder_pub": s.responder_pub,
        "accepted_at": s.accepted_at.isoformat() if s.accepted_at else None,
    }


def _push_event(chat, data):
    """Событие в личные сокеты участников: чат появился / принят / отклонён."""
    from asgiref.sync import async_to_sync
    from channels.layers import get_channel_layer
    layer = get_channel_layer()
    if not layer:
        return
    for pid in chat.participants.values_list("id", flat=True):
        try:
            async_to_sync(layer.group_send)(f"user_{pid}", {"type": "notification", "data": {"type": "secret_chat", "chat_id": str(chat.id), **data}})
        except Exception:
            pass


def _me(request):
    return getattr(request.user, "profile", None)


class SecretChatCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        me = _me(request)
        if not me:
            return Response({"error": "Профиль не найден"}, status=400)
        peer = Profile.objects.filter(id=request.data.get("peer_id")).first()
        if not peer or peer.id == me.id:
            return Response({"error": "Собеседник не найден"}, status=404)
        if peer.is_bot:
            return Response({"error": "С ботом секретный чат не создать"}, status=400)
        from .moderation import blocked_either_way
        if blocked_either_way(me.id, peer.id):
            return Response({"error": "Нельзя написать этому пользователю"}, status=403)
        pub, device = request.data.get("pub") or "", str(request.data.get("device_id") or "")
        if not _valid_pub(pub) or not DEVICE_RE.match(device):
            return Response({"error": "Неверный ключ или устройство"}, status=400)
        with transaction.atomic():
            chat = Chat.objects.create(kind="secret", is_group=False, name="")
            ChatParticipant.objects.create(chat=chat, user=me)
            ChatParticipant.objects.create(chat=chat, user=peer)
            SecretChat.objects.create(chat=chat, initiator=me, initiator_device=device, initiator_pub=pub)
        _push_event(chat, {"state": SecretChat.STATE_PENDING})
        from .serializers import ChatSerializer
        return Response(ChatSerializer(Chat.objects.get(id=chat.id), context={"request": request}).data, status=201)


class SecretChatAcceptView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, chat_id):
        me = _me(request)
        s = SecretChat.objects.select_related("chat").filter(chat_id=chat_id).first()
        if not me or not s or not s.chat.participants.filter(id=me.id).exists():
            return Response({"error": "Чат не найден"}, status=404)
        if s.initiator_id == me.id:
            return Response({"error": "Принимает собеседник"}, status=400)
        if s.state != SecretChat.STATE_PENDING:
            return Response({"error": "Чат уже принят или отклонён"}, status=409)
        pub, device = request.data.get("pub") or "", str(request.data.get("device_id") or "")
        if not _valid_pub(pub) or not DEVICE_RE.match(device):
            return Response({"error": "Неверный ключ или устройство"}, status=400)
        s.responder_pub, s.responder_device = pub, device
        s.state, s.accepted_at = SecretChat.STATE_ACTIVE, timezone.now()
        s.save(update_fields=["responder_pub", "responder_device", "state", "accepted_at"])
        Chat.objects.filter(id=s.chat_id).update(updated_at=timezone.now())
        _push_event(s.chat, {"state": s.state})
        return Response({"secret": secret_info(s.chat)})


class SecretChatDeclineView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, chat_id):
        me = _me(request)
        s = SecretChat.objects.select_related("chat").filter(chat_id=chat_id).first()
        if not me or not s or not s.chat.participants.filter(id=me.id).exists():
            return Response({"error": "Чат не найден"}, status=404)
        if s.state == SecretChat.STATE_PENDING:
            s.state = SecretChat.STATE_DECLINED
            s.save(update_fields=["state"])
            _push_event(s.chat, {"state": s.state})
        return Response({"secret": secret_info(s.chat)})


def create_secret_message(request, profile, chat):
    """Сообщение в секретный чат: только шифротекст (и ответ на сообщение
    этого же чата). Всё остальное — отказ, даже если клиент прислал."""
    from .serializers import MessageSerializer
    from .views import _notify_new_message
    s = getattr(chat, "secret", None) or SecretChat.objects.filter(chat=chat).first()
    if not s or not chat.participants.filter(id=profile.id).exists():
        return Response({"error": "Чат не найден"}, status=404)
    if s.state != SecretChat.STATE_ACTIVE:
        return Response({"error": "Секретный чат ещё не принят"}, status=409)
    for field in ("voice_url", "video_url", "sticker_id", "sound_id", "playlist_track_id", "effect"):
        if request.data.get(field):
            return Response({"error": "Такое в секретный чат не отправить"}, status=400)
    # Вложение: только зашифрованный файл .bin — что внутри, знает лишь сообщение.
    file_url = str(request.data.get("file_url") or "")
    if file_url and not FILE_RE.match(file_url):
        return Response({"error": "Вложение секретного чата — только зашифрованный файл"}, status=400)
    try:
        file_size = int(request.data.get("file_size") or 0)
    except (TypeError, ValueError):
        file_size = 0
    if file_url and not (0 < file_size <= MAX_FILE):
        return Response({"error": "Файл больше 50 МБ"}, status=400)
    if (request.data.get("content") or "").strip():
        return Response({"error": "Текст в секретный чат уходит только зашифрованным"}, status=400)
    cipher = str(request.data.get("cipher") or "")
    if not cipher or len(cipher) > MAX_CIPHER or not re.fullmatch(r"[A-Za-z0-9+/=]+", cipher):
        return Response({"error": "Нет шифротекста"}, status=400)
    reply = None
    if request.data.get("reply_to_id"):
        reply = Message.objects.filter(id=request.data.get("reply_to_id"), chat=chat).first()
    msg = Message.objects.create(
        chat=chat, sender=profile, content=None, cipher=cipher, reply_to=reply,
        file_url=file_url or None, file_size=file_size or None, file_name=None,
        download_only=bool(file_url),
    )
    Chat.objects.filter(id=chat.id).update(updated_at=timezone.now())
    _notify_new_message(msg, profile, request)
    return Response(MessageSerializer(msg, context={"request": request}).data, status=status.HTTP_201_CREATED)
