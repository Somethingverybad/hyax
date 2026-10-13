"""Перенос ключей секретных чатов на другое устройство того же аккаунта.

Ключи никогда не покидают устройства в открытом виде. Новое устройство делает
одноразовую пару ECDH и показывает QR (ссылка /kt/<id>#<pub>) и 6-значный
код. Старое устройство (где ключи есть) сканирует QR или вводит код, берёт
открытый ключ сеанса, выводит общий секрет (ECDH → HKDF, соль — id сеанса) и
шифрует им ключи всех своих секретных чатов одним блобом (AES-256-GCM). Блоб
лежит здесь до 10 минут и выдаётся новому устройству один раз, после чего
сеанс удаляется.

Сервер видит: открытые ключи и шифротекст. Подмена открытого ключа сервером
ловится кодом проверки — SHA-256 от открытого ключа нового устройства, 6
цифр, которые показывают оба экрана. Через QR ключ приходит с экрана, минуя
сервер, и подменить его нечем.

Собеседникам перенесённых чатов уходит служебное сообщение «добавил
устройство»: проверить они это не могут, но хотя бы знают.
"""
import secrets
from datetime import timedelta

from django.db.models import Q
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Chat, KeyTransfer, Message
from .secret import _valid_pub

TTL = timedelta(minutes=10)
MAX_BLOB = 512 * 1024  # сотни чатов с запасом


def _me(request):
    return getattr(request.user, "profile", None)


def _cleanup(profile):
    KeyTransfer.objects.filter(Q(owner=profile) & Q(created_at__lt=timezone.now() - TTL)).delete()


def _payload(t):
    return {"id": str(t.id), "code": t.code, "pub": t.new_pub, "ready": bool(t.blob),
            "expires_at": (t.created_at + TTL).isoformat()}


class KeyTransferCreateView(APIView):
    """POST {pub} — новое устройство открывает сеанс. Старые сеансы владельца закрываются."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        me = _me(request)
        if not me:
            return Response({"error": "Нет профиля"}, status=403)
        pub = (request.data.get("pub") or "").strip()
        if not _valid_pub(pub):
            return Response({"error": "Неверный открытый ключ"}, status=400)
        KeyTransfer.objects.filter(owner=me).delete()
        t = KeyTransfer.objects.create(owner=me, new_pub=pub, code=f"{secrets.randbelow(10**6):06d}")
        return Response(_payload(t))


class KeyTransferLookupView(APIView):
    """GET by id или по коду — старое устройство узнаёт открытый ключ сеанса."""
    permission_classes = [IsAuthenticated]

    def get(self, request, ref):
        me = _me(request)
        if not me:
            return Response({"error": "Нет профиля"}, status=403)
        _cleanup(me)
        q = KeyTransfer.objects.filter(owner=me)
        t = q.filter(code=ref).first() if ref.isdigit() and len(ref) == 6 else q.filter(id=ref).first()
        if not t:
            return Response({"error": "Сеанс не найден или истёк"}, status=404)
        return Response(_payload(t))


class KeyTransferBlobView(APIView):
    """POST {blob, old_pub, chats} — старое устройство кладёт запечатанные ключи;
    GET — новое устройство забирает их один раз, сеанс удаляется."""
    permission_classes = [IsAuthenticated]

    def post(self, request, ref):
        me = _me(request)
        if not me:
            return Response({"error": "Нет профиля"}, status=403)
        _cleanup(me)
        t = KeyTransfer.objects.filter(owner=me, id=ref).first()
        if not t:
            return Response({"error": "Сеанс не найден или истёк"}, status=404)
        if t.blob:
            return Response({"error": "Ключи уже отправлены"}, status=409)
        blob = request.data.get("blob") or ""
        old_pub = (request.data.get("old_pub") or "").strip()
        if not blob or len(blob) > MAX_BLOB or not _valid_pub(old_pub):
            return Response({"error": "Неверные данные"}, status=400)
        t.blob, t.old_pub, t.sent_at = blob, old_pub, timezone.now()
        t.save(update_fields=["blob", "old_pub", "sent_at"])
        # Собеседникам — служебное сообщение. Только по чатам, где я участник.
        ids = [str(c) for c in (request.data.get("chats") or [])][:500]
        notified = 0
        for chat in Chat.objects.filter(id__in=ids, kind="secret", participants=me).distinct():
            try:
                msg = Message.objects.create(chat=chat, sender=None, content="🔑 Собеседник добавил устройство к этому секретному чату")
                from .views import _notify_new_message
                _notify_new_message(msg, me, request)
                notified += 1
            except Exception:
                pass
        return Response({"ok": True, "notified": notified})

    def get(self, request, ref):
        me = _me(request)
        if not me:
            return Response({"error": "Нет профиля"}, status=403)
        _cleanup(me)
        t = KeyTransfer.objects.filter(owner=me, id=ref).first()
        if not t:
            return Response({"error": "Сеанс не найден или истёк"}, status=404)
        if not t.blob:
            return Response({"ready": False})
        data = {"ready": True, "blob": t.blob, "old_pub": t.old_pub, "pub": t.new_pub}
        t.delete()
        return Response(data)
