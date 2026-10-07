"""«Долгий ящик» — бот для идей и предложений.

У каждого свой чат с ботом (Chat.kind == "ideabox"); клиент показывает его
отдельной строкой наверху списка чатов, а в общий список не кладёт. Всё, что
человек туда пишет, пересылается в системный чат «Идеи» — к тем же людям, что
получают жалобы и баг-репорты (роли support и admin, см. moderation.py).
Пересылкой, а не пересказом: видно автора (тап — его профиль), фото и голосовые
доходят как есть.

Бот отвечает человеку, что идея принята, — не чаще раза в десять минут, чтобы
серия сообщений не превращалась в переписку с автоответчиком.
"""
import logging
import secrets
from datetime import timedelta

from django.contrib.auth.models import User
from django.db import transaction
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Chat, ChatParticipant, Message, Profile

logger = logging.getLogger(__name__)

KIND = "ideabox"
BOT_USERNAME = "Долгий ящик"
BOT_LOGIN = "ideabox_bot"
BOT_BIO = "Сюда — идеи и предложения для WhoYaX. Всё читает разработчик."
IDEAS_CHAT_NAME = "Идеи"
REPLY_EVERY = timedelta(minutes=10)

WELCOME = (
    "Привет! Это долгий ящик — сюда можно бросать идеи и предложения: что добавить, "
    "что поменять, что бесит. Текстом, голосом, картинкой — как удобно.\n\n"
    "Всё попадает прямо к разработчику. Ответ не обещаю, но каждую идею прочитаю."
)
THANKS = "Положил в долгий ящик 📦 Спасибо! Если вспомнится ещё что-то — пиши сюда же."


def ideabox_bot() -> Profile:
    bot = Profile.objects.filter(username=BOT_USERNAME, is_bot=True).first()
    if bot:
        return bot
    user = User.objects.filter(username=BOT_LOGIN).first()
    if not user:
        user = User.objects.create(username=BOT_LOGIN, email=f"{BOT_LOGIN}@bot.local", is_active=False)
        user.set_unusable_password()
        user.save()
    return Profile.objects.create(user=user, username=BOT_USERNAME, is_bot=True, bio=BOT_BIO,
                                  bot_token=secrets.token_urlsafe(32))


def user_chat(profile: Profile) -> Chat:
    """Чат человека с ботом; создаётся при первом обращении, с приветствием."""
    chat = Chat.objects.filter(kind=KIND, participants=profile).first()
    if chat:
        return chat
    bot = ideabox_bot()
    with transaction.atomic():
        chat = Chat.objects.create(kind=KIND, is_group=False, name=BOT_USERNAME)
        ChatParticipant.objects.create(chat=chat, user=profile)
        ChatParticipant.objects.create(chat=chat, user=bot)
        Message.objects.create(chat=chat, sender=bot, content=WELCOME)
    return chat


def deliver_idea(message: Message, author: Profile) -> None:
    """Пересылаем идею в «Идеи» и при необходимости благодарим автора.
    Сбой доставки не мешает самой отправке: сообщение у человека уже есть."""
    from .moderation import sync_staff_membership, system_chat, system_bot
    from .views import _forward_copy, _notify_new_message
    try:
        ideas = sync_staff_membership(system_chat(IDEAS_CHAT_NAME))
        bot = system_bot()
        fwd = _forward_copy(message, ideas, bot)
        Chat.objects.filter(id=ideas.id).update(updated_at=timezone.now())
        _notify_new_message(fwd, bot, None)
    except Exception:
        logger.exception("Идея %s сохранена, но не доставлена в «Идеи»", message.id)
    try:
        box_bot = ideabox_bot()
        last_reply = (Message.objects.filter(chat=message.chat, sender=box_bot)
                      .exclude(content=WELCOME).order_by("-created_at").values_list("created_at", flat=True).first())
        if not last_reply or timezone.now() - last_reply > REPLY_EVERY:
            reply = Message.objects.create(chat=message.chat, sender=box_bot, content=THANKS)
            Chat.objects.filter(id=message.chat_id).update(updated_at=timezone.now())
            _notify_new_message(reply, box_bot, None)
    except Exception:
        logger.exception("Не ответил на идею %s", message.id)


class IdeaboxView(APIView):
    """GET /api/ideabox/ — чат человека с «Долгим ящиком» (создаётся при первом заходе)."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        me = getattr(request.user, "profile", None)
        if not me or me.is_bot:
            return Response({"error": "Нет профиля"}, status=403)
        from .serializers import ChatSerializer
        chat = user_chat(me)
        return Response(ChatSerializer(chat, context={"request": request}).data)
