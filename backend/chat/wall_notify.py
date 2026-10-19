"""Пуш «собеседник написал на Стене».

Кому: тем, у кого с автором живая личка — обычный чат на двоих, принятый (не
запрос), не секретный. Не шлём тем, кто:
- выключил такие уведомления (Profile.notify_wall) или саму Стену;
- заглушил этого автора в меню поста (WallNotifyMute) или скрыл его (WallMute);
- заблокировал автора или заблокирован им;
- не видит 18+, а пост не помечен 4+;
- прямо сейчас смотрит Стену.

Пишет подряд — одно уведомление на THROTTLE: следующий пост в эти минуты пуш
не шлёт, иначе серия постов звенела бы у друзей каждым.
"""
from __future__ import annotations

import logging
from datetime import timedelta

from .models import Chat, ChatParticipant, Message, Profile, WallMute, WallNotifyMute

logger = logging.getLogger(__name__)

THROTTLE = timedelta(minutes=15)


def recipients(post: Message, author: Profile):
    chats = Chat.objects.filter(participants=author, kind="direct", pending_for__isnull=True)
    ids = ChatParticipant.objects.filter(chat__in=chats).exclude(user=author).values_list("user_id", flat=True)
    qs = (
        Profile.objects.filter(id__in=ids, is_bot=False, notify_wall=True, wall_enabled=True)
        .exclude(id__in=WallMute.objects.filter(author=author).values("user_id"))
        .exclude(id__in=WallNotifyMute.objects.filter(author=author).values("user_id"))
        .exclude(blocks__blocked_id=author.id)
    )
    from .moderation import blocked_ids
    blocked = blocked_ids(author)
    if blocked:
        qs = qs.exclude(id__in=blocked)
    if not post.wall_safe:
        qs = qs.filter(allow_adult=True)
    from .presence import viewers
    watching = viewers(post.chat_id)
    if watching:
        qs = qs.exclude(id__in=watching)
    return qs


def notify_wall_post(post: Message, author: Profile) -> int:
    """Разослать пуш о новом посте. Возвращает, скольким он ушёл."""
    if author.is_bot or post.wall_hidden:
        return 0
    earlier = (Message.objects.filter(chat_id=post.chat_id, sender=author, deleted_for_all=False,
                                      created_at__gte=post.created_at - THROTTLE, created_at__lt=post.created_at)
               .exclude(id=post.id).exists())
    if earlier:
        return 0
    to = recipients(post, author)
    n = to.count()
    if not n:
        return 0
    from .fcm import notify_profiles
    from .formatting import mask_preview
    from .i18n import L, clip
    text = mask_preview(post.content or "", getattr(post, "entities", None)).strip()
    preview = text or (L("Опрос") if post.poll_id else L("Новый пост"))
    notify_profiles(
        to,
        title=L("{name} на Стене", name=author.username),
        body=clip(preview, 150),
        # chat_id — Стена: по тапу клиент откроет её (и на старых сборках,
        # где тип пуша нативная часть не передаёт).
        extra={"kind": "wall_post", "chat_id": str(post.chat_id), "message_id": str(post.id)},
        hide_body_for=set(to.filter(push_preview=False).values_list("id", flat=True)),
    )
    logger.info("wall push: пост %s от %s — %d получателям", post.id, author.username, n)
    return n
