"""Обновлямбус — бот-рассылка заметок об обновлении.

    python manage.py announce_update "Текст заметки"
    python manage.py announce_update --from-manifest   # notes из nginx/apk-page/version.json

Бот создаётся при первом запуске (username obnovlyambus, readonly_bot=True —
писать ему нельзя, MessageViewSet.create отбивает). Каждому живому
пользователю (не боту) — личка с ботом (создаётся, если нет) и одно
сообщение; дальше обычный путь: сокет чата, пуш, личные уведомления.
"""
import json
import os
import secrets

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from chat.models import Chat, ChatParticipant, Message, Profile

BOT_USERNAME = "obnovlyambus"
BOT_BIO = "Обновлямбус. Рассказываю, что нового в WhoYaX. Писать мне бесполезно — я только читаю релиз-ноты вслух."


class Command(BaseCommand):
    help = "Разослать всем пользователям заметку об обновлении от бота Обновлямбус"

    def add_arguments(self, parser):
        parser.add_argument("text", nargs="?", default="")
        parser.add_argument("--from-manifest", action="store_true", help="взять version + notes из version.json витрины")
        parser.add_argument("--manifest", default="/app/media/apk/version.json")
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **opts):
        text = (opts["text"] or "").strip()
        if opts["from_manifest"]:
            with open(opts["manifest"], encoding="utf-8") as fh:
                m = json.load(fh)
            text = f"Обновление {m.get('version', '')} (сборка {m.get('build', '')})\n\n{m.get('notes', '')}".strip()
        if not text:
            raise CommandError("Нужен текст или --from-manifest")

        bot = Profile.objects.filter(username=BOT_USERNAME).first()
        if not bot:
            User = get_user_model()
            user = User.objects.create(username=BOT_USERNAME, email=f"{BOT_USERNAME}@bot.local", is_active=True)
            user.set_unusable_password()
            user.save()
            bot = Profile.objects.create(user=user, username=BOT_USERNAME, is_bot=True, readonly_bot=True,
                                         bot_token=secrets.token_urlsafe(32), bio=BOT_BIO)
            self.stdout.write(f"бот создан: {bot.id}")
        elif not bot.readonly_bot:
            bot.readonly_bot = True
            bot.save(update_fields=["readonly_bot"])

        from chat.views import _notify_new_message
        people = Profile.objects.filter(is_bot=False, user__is_active=True).exclude(id=bot.id)
        sent = 0
        for p in people.iterator():
            chat = (Chat.objects.filter(kind="direct", participants=bot).filter(participants=p)
                    .exclude(is_group=True).first())
            if not chat:
                chat = Chat.objects.create(kind="direct", is_group=False, creator=bot)
                ChatParticipant.objects.create(chat=chat, user=bot)
                ChatParticipant.objects.create(chat=chat, user=p)
            if opts["dry_run"]:
                sent += 1
                continue
            msg = Message.objects.create(chat=chat, sender=bot, content=text)
            Chat.objects.filter(id=chat.id).update(updated_at=timezone.now())
            try:
                _notify_new_message(msg, bot, None)
            except Exception as e:  # пуш/сокет не должны ронять рассылку
                self.stderr.write(f"уведомление {p.username}: {e}")
            sent += 1
        self.stdout.write(f"{'(dry-run) ' if opts['dry_run'] else ''}разослано: {sent}")
