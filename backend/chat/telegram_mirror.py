"""Зеркала публичных Telegram-каналов.

Общая часть для API (подключение канала по ссылке) и воркера tg_mirror
(Telethon под реальным аккаунтом, отдельный контейнер): разбор ссылки,
сохранение поста с медиа как обычного сообщения канала и рассылка
подписчикам. Реакции и комментарии к таким постам — наши, из Telegram они
не переносятся.
"""
import logging
import os
import re
import shutil
import uuid

from django.utils import timezone

logger = logging.getLogger(__name__)

# Пространство имён для album_id: одна и та же группа в Telegram — один и тот
# же альбом у нас, сколько бы раз воркер ни перезапускался.
ALBUM_NS = uuid.UUID("7d6b1c1e-6f3a-4a6e-9a1a-4c9d2b8e5f10")
MAX_MEDIA_BYTES = 100 * 1024 * 1024

_REF = re.compile(
    r"^(?:https?://)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)/(?:s/)?@?([A-Za-z][A-Za-z0-9_]{3,31})/?(?:[?#].*)?$",
    re.I,
)
_HANDLE = re.compile(r"^@?([A-Za-z][A-Za-z0-9_]{3,31})$")


def parse_channel_ref(text: str):
    """t.me/durov, https://t.me/s/durov?x=1, @durov, durov → 'durov'. Приглашения
    (+abc, joinchat) и ссылки на пост (t.me/durov/123) не принимаем: первые —
    приватные каналы, вторые — не канал, а сообщение."""
    s = (text or "").strip()
    if not s:
        return None
    m = _REF.match(s) or _HANDLE.match(s)
    if not m:
        return None
    name = m.group(1)
    if name.lower() in ("joinchat", "share", "addstickers", "proxy", "socks", "iv", "s"):
        return None
    return name


def album_uuid(chat_id, grouped_id):
    return uuid.uuid5(ALBUM_NS, f"{chat_id}:{grouped_id}")


def text_from_tg(message):
    """Текст поста с адресами скрытых ссылок: «текст (https://…)». Telegram
    отдаёт entities отдельно, у нас ссылки живут в тексте."""
    text = getattr(message, "message", None) or ""
    ents = getattr(message, "entities", None) or []
    urls = []
    for e in ents:
        url = getattr(e, "url", None)
        if url:
            piece = text[e.offset:e.offset + e.length]
            if piece.strip() and url not in piece:
                urls.append((piece, url))
    for piece, url in urls:
        text = text.replace(piece, f"{piece} ({url})", 1)
    return text.strip()


def store_media(tmp_path, ctype, name, subdir="messages", local_only=False):
    """Файл из Telegram → наше хранилище. Медиа постов — в S3, как у обычных
    сообщений (клиент подписывает ссылки s3://); аватар канала — только
    локально в /media/avatars: аватары клиент не подписывает, а подставляет
    как есть. Возвращает (file_url, size, (w, h) | None)."""
    from django.conf import settings
    from .s3 import s3_enabled, upload_file as s3_upload
    from .views import _probe_dims

    size = os.path.getsize(tmp_path)
    ext = os.path.splitext(name)[1] or os.path.splitext(tmp_path)[1] or ""
    rel = os.path.join(subdir, f"{uuid.uuid4()}{ext}")
    dims = None
    try:
        dims = _probe_dims(tmp_path)
    except Exception:
        dims = None
    file_url = f"/media/{rel}"
    if s3_enabled() and not local_only:
        try:
            file_url = s3_upload(tmp_path, rel, ctype)
            os.remove(tmp_path)
            return file_url, size, dims
        except Exception:
            logger.exception("tg-mirror: S3 недоступен, оставляю локально")
    dst = os.path.join(settings.MEDIA_ROOT, rel)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.move(tmp_path, dst)  # /tmp и /app/media — разные ФС, os.replace тут падает
    return file_url, size, dims


def video_poster(tmp_path, local_only=False):
    """Кадр-превью для видео из Telegram — тем же способом, что у загрузок."""
    from .views import _make_poster
    return _make_poster(tmp_path, os.path.join("messages", f"{uuid.uuid4()}.mp4"), local_only)


def upsert_post(chat, tg_id, *, text="", created_at=None, grouped_id=None, media=None):
    """Пост Telegram → Message канала. Повторный вызов с тем же tg_id ничего не
    дублирует. media: {"file_url","file_name","file_size","dims"} или None.
    Возвращает (message, created)."""
    from .models import Message

    existing = Message.objects.filter(chat=chat, tg_id=tg_id).first()
    if existing:
        return existing, False
    if not text and not media:
        return None, False
    fields = dict(
        chat=chat, sender=None, tg_id=tg_id,
        content=text or None,
        created_at=created_at or timezone.now(),
        album_id=album_uuid(chat.id, grouped_id) if grouped_id else None,
    )
    if media:
        fields.update(file_url=media["file_url"], file_name=media["file_name"][:255], file_size=media.get("file_size"), poster_url=media.get("poster_url"))
        dims = media.get("dims")
        if dims:
            fields.update(file_width=dims[0], file_height=dims[1])
    msg = Message.objects.create(**fields)
    chat.__class__.objects.filter(id=chat.id).update(updated_at=timezone.now())
    return msg, True


def notify_mirror_post(message):
    """Как _notify_new_message, но без отправителя: пост в сокет канала и пуш
    всем подписчикам с именем канала в заголовке."""
    from channels.layers import get_channel_layer
    from asgiref.sync import async_to_sync
    from .serializers import MessageSerializer, message_preview
    from .fcm import notify_profiles
    from .presence import viewers
    from .views import _without_muted

    try:
        layer = get_channel_layer()
        if layer:
            data = MessageSerializer(message).data
            async_to_sync(layer.group_send)(f"chat_{message.chat.id}", {"type": "chat_message", "message": data})
    except Exception:
        logger.exception("tg-mirror: сокет не ответил")
    try:
        watching = viewers(message.chat.id)
        recipients = _without_muted(message.chat, message.chat.participants.all())
        if watching:
            recipients = recipients.exclude(id__in=watching)
        chat = message.chat
        notify_profiles(
            recipients, title=chat.name, body=message_preview(message)[:150],
            extra={"chat_id": str(chat.id)},
            sound=chat.notify_sound.slug if getattr(chat, "notify_sound_id", None) else None,
            hide_body_for=set(recipients.filter(push_preview=False).values_list("id", flat=True)),
        )
    except Exception:
        logger.exception("tg-mirror: пуш не ушёл")


# ── Отписка нашего аккаунта от каналов (очередь TgLeave) ─────────────────────

# Ошибки Telegram, после которых выходить уже не из чего: мы не подписаны,
# канала больше нет или он закрыт для нас.
_GONE = ("UserNotParticipant", "ChannelPrivate", "ChannelInvalid", "UsernameNotOccupied", "UsernameInvalid")


def _pending_leaves():
    from .models import TgLeave
    return list(TgLeave.objects.filter(done_at__isnull=True, attempts__lt=TgLeave.MAX_ATTEMPTS).order_by("created_at")[:20])


def _close_leave(row, error="", final=True):
    """Записать попытку. final=False — временная ошибка: повторим, пока не
    кончатся попытки (TgLeave.MAX_ATTEMPTS)."""
    row.attempts += 1
    row.error = (error or "")[:300]
    if final or row.attempts >= row.MAX_ATTEMPTS:
        row.done_at = timezone.now()
    row.save(update_fields=["attempts", "error", "done_at"])


async def leave_pending(client, leave_request):
    """Выйти из каналов по очереди TgLeave. client — Telethon (воркер
    tg_mirror), leave_request — channels.LeaveChannelRequest. Канал, который
    за это время снова подключили зеркалом, не трогаем. Возвращает tg_peer_id
    каналов, из которых вышли: воркер перестаёт их слушать."""
    from asgiref.sync import sync_to_async
    from .models import Chat
    left = []
    for row in await sync_to_async(_pending_leaves)():
        mirrored = await sync_to_async(lambda: Chat.objects.filter(tg_username__iexact=row.tg_username).exists())()
        if mirrored:
            await sync_to_async(_close_leave)(row, "Канал снова зеркалится — не выходим")
            continue
        try:
            try:
                entity = await client.get_entity(row.tg_username)
            except Exception:
                if not row.tg_peer_id:
                    raise
                from telethon.tl.types import PeerChannel  # ник сменили — найдём по id из сессии
                entity = await client.get_entity(PeerChannel(row.tg_peer_id))
            await client(leave_request(entity))
        except Exception as e:
            name = type(e).__name__
            if any(g in name for g in _GONE):
                await sync_to_async(_close_leave)(row, "")  # уже не подписаны — цель достигнута
                left.append(row.tg_peer_id)
                logger.info("tg leave @%s: уже не подписаны (%s)", row.tg_username, name)
            else:
                await sync_to_async(_close_leave)(row, f"{name}: {e}", final=False)
                logger.warning("tg leave @%s: %s: %s", row.tg_username, name, e)
            continue
        await sync_to_async(_close_leave)(row, "")
        left.append(row.tg_peer_id or getattr(entity, "id", None))
        logger.info("tg leave @%s: вышли", row.tg_username)
    return [p for p in left if p]
