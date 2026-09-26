"""Воркер зеркал Telegram-каналов (контейнер sux_chat_tg).

Реальный аккаунт (сессия из tg_login) вступает в каналы, которые люди
подключили ссылкой (Chat.tg_state = pending), забирает название, описание,
аватар и последние посты, а дальше слушает обновления: новые посты — в
канал WhoYaX с медиа и альбомами, правки — в текст, удаления — «удалено у
всех». Список каналов перечитывается раз в 15 секунд, поэтому подключение
из приложения подхватывается без перезапуска.
"""
import asyncio
import logging
import mimetypes
import os
import tempfile

from asgiref.sync import sync_to_async
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

logger = logging.getLogger("tg_mirror")

BACKFILL = 30           # сколько последних постов забрать при подключении
REFRESH_SEC = 15        # как часто смотреть, не подключили ли новый канал


class Command(BaseCommand):
    help = "Зеркалить подключённые Telegram-каналы в WhoYaX"

    def handle(self, *args, **options):
        logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
        api_id = os.environ.get("TG_API_ID")
        api_hash = os.environ.get("TG_API_HASH")
        if not api_id or not api_hash:
            raise CommandError("Нужны TG_API_ID и TG_API_HASH в окружении")
        session = os.environ.get("TG_SESSION", "/app/private/tg")
        asyncio.run(self.run(session, int(api_id), api_hash))

    async def run(self, session, api_id, api_hash):
        from telethon import TelegramClient, events, utils
        from telethon.tl.functions.channels import JoinChannelRequest, GetFullChannelRequest
        from chat.models import Chat
        from chat.telegram_mirror import text_from_tg, store_media, upsert_post, notify_mirror_post, MAX_MEDIA_BYTES

        client = TelegramClient(session, api_id, api_hash, use_ipv6=os.environ.get("TG_IPV6", "1") == "1")
        await client.connect()
        if not await client.is_user_authorized():
            raise CommandError("Сессии нет — сначала: docker compose run --rm -it tg python manage.py tg_login")
        me = await client.get_me()
        logger.info("вошли как %s (@%s)", me.first_name, me.username)

        peers: dict[int, str] = {}   # tg_peer_id → Chat.id (str)

        @sync_to_async
        def load_channels():
            return list(Chat.objects.filter(tg_username__isnull=False).exclude(tg_state="error"))

        @sync_to_async
        def save_channel(ch, **fields):
            for k, v in fields.items():
                setattr(ch, k, v)
            ch.save(update_fields=list(fields.keys()) + ["updated_at"])

        async def download(msg):
            """Медиа поста → наше хранилище. None — если медиа нет или оно слишком большое."""
            media = msg.media
            if not media:
                return None
            size = None
            name = None
            ctype = None
            doc = getattr(media, "document", None)
            if doc is not None:
                size = getattr(doc, "size", None)
                ctype = getattr(doc, "mime_type", None)
                for a in getattr(doc, "attributes", []) or []:
                    if getattr(a, "file_name", None):
                        name = a.file_name
                # Стикеры и голосовые Telegram у нас не показываем — только фото, видео, файлы.
                if ctype in ("application/x-tgsticker",) or any(type(a).__name__ == "DocumentAttributeSticker" for a in doc.attributes):
                    return None
            elif getattr(media, "photo", None) is not None:
                ctype = "image/jpeg"
                name = f"photo_{msg.id}.jpg"
            else:
                return None  # опросы, геометки, веб-превью — только текст
            if size and size > MAX_MEDIA_BYTES:
                return None
            if not name:
                ext = mimetypes.guess_extension(ctype or "") or ""
                name = f"file_{msg.id}{ext}"
            tmp_dir = tempfile.mkdtemp(prefix="tg-")
            path = await client.download_media(msg, file=os.path.join(tmp_dir, name))
            if not path:
                return None
            file_url, got, dims = await sync_to_async(store_media)(path, ctype or "application/octet-stream", name)
            try:
                os.rmdir(tmp_dir)
            except OSError:
                pass
            return {"file_url": file_url, "file_name": name, "file_size": got, "dims": dims}

        async def process(msg, chat_id):
            """Один пост Telegram → сообщение канала + рассылка."""
            if getattr(msg, "action", None) is not None:
                return  # служебное: «канал создан», «закреплено» и т.п.
            chat = await sync_to_async(Chat.objects.get)(id=chat_id)
            exists = await sync_to_async(lambda: chat.messages.filter(tg_id=msg.id).exists())()
            if exists:
                return
            media = None
            try:
                media = await download(msg)
            except Exception:
                logger.exception("медиа поста %s/%s не скачалось", chat.tg_username, msg.id)
            text = text_from_tg(msg)
            message, created = await sync_to_async(upsert_post)(
                chat, msg.id, text=text, created_at=msg.date, grouped_id=getattr(msg, "grouped_id", None), media=media,
            )
            if created and message:
                await sync_to_async(notify_mirror_post)(message)
                logger.info("%s/%s → %s%s", chat.tg_username, msg.id, message.id, " +медиа" if media else "")

        async def activate(ch):
            """Подключение: вступить, забрать карточку канала и последние посты."""
            try:
                entity = await client.get_entity(ch.tg_username)
                if not getattr(entity, "broadcast", False):
                    raise ValueError("это не канал")
                try:
                    await client(JoinChannelRequest(entity))
                except Exception as e:  # уже подписаны или закрыт — не критично
                    logger.info("join %s: %s", ch.tg_username, e)
                full = await client(GetFullChannelRequest(entity))
                avatar_url = ch.avatar_url
                try:
                    tmp = await client.download_profile_photo(entity, file=os.path.join(tempfile.mkdtemp(prefix="tg-"), "avatar.jpg"))
                    if tmp:
                        avatar_url, _, _ = await sync_to_async(store_media)(tmp, "image/jpeg", "avatar.jpg", subdir="avatars", local_only=True)
                except Exception:
                    logger.exception("аватар %s не скачался", ch.tg_username)
                await save_channel(
                    ch, name=(entity.title or ch.tg_username)[:100],
                    description=(getattr(full.full_chat, "about", "") or "")[:500],
                    avatar_url=avatar_url, tg_peer_id=entity.id, tg_state="active", tg_error="",
                )
                peers[entity.id] = str(ch.id)
                history = [m async for m in client.iter_messages(entity, limit=BACKFILL)]
                for m in reversed(history):
                    await process(m, str(ch.id))
                logger.info("подключён %s (%s): %d постов", ch.tg_username, entity.title, len(history))
            except Exception as e:
                logger.exception("не удалось подключить %s", ch.tg_username)
                await save_channel(ch, tg_state="error", tg_error=str(e)[:300])

        async def refresh_loop():
            while True:
                try:
                    for ch in await load_channels():
                        if ch.tg_state == "pending" or not ch.tg_peer_id:
                            await activate(ch)
                        else:
                            peers[ch.tg_peer_id] = str(ch.id)
                except Exception:
                    logger.exception("refresh")
                await asyncio.sleep(REFRESH_SEC)

        def chat_of(event):
            pid = getattr(event, "chat_id", None)
            if pid is None:
                return None
            # chat_id у каналов приходит как -100XXXX; в peers лежит голый id.
            bare = utils.resolve_id(pid)[0] if pid < 0 else pid
            return peers.get(bare)

        @client.on(events.NewMessage())
        async def on_new(event):
            chat_id = chat_of(event)
            if chat_id:
                await process(event.message, chat_id)

        @client.on(events.MessageEdited())
        async def on_edit(event):
            chat_id = chat_of(event)
            if not chat_id:
                return
            from chat.models import Message
            text = text_from_tg(event.message)

            def apply():
                m = Message.objects.filter(chat_id=chat_id, tg_id=event.message.id).first()
                if m and (m.content or "") != text:
                    m.content = text or None
                    m.is_edited = True
                    m.save(update_fields=["content", "is_edited", "updated_at"])
            await sync_to_async(apply)()

        @client.on(events.MessageDeleted())
        async def on_delete(event):
            chat_id = chat_of(event)
            if not chat_id or not event.deleted_ids:
                return
            from chat.models import Message

            def apply():
                qs = Message.objects.filter(chat_id=chat_id, tg_id__in=list(event.deleted_ids), deleted_for_all=False)
                qs.update(deleted_for_all=True, updated_at=timezone.now())
            await sync_to_async(apply)()

        asyncio.create_task(refresh_loop())
        logger.info("слушаем обновления")
        await client.run_until_disconnected()
