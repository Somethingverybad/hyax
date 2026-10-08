"""Завести «Долгий ящик» всем: чат с ботом и приветствие у каждого человека.

    python manage.py ideabox_seed [--dry-run]

Повторный запуск безопасен: у кого чат уже есть — не трогаем, кроме старого
текста приветствия (его меняем на текущий). Пушей не шлём: чат просто
появляется в списке с непрочитанным приветствием.
"""
from django.core.management.base import BaseCommand

from django.utils import timezone

from chat.ideabox import KIND, MENU, OLD_WELCOMES, THANKS, WELCOME, ideabox_bot, user_chat
from chat.models import Chat, Message, Profile


class Command(BaseCommand):
    help = "Создать чат «Долгий ящик» всем пользователям"

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **opts):
        bot = ideabox_bot()
        people = Profile.objects.filter(is_bot=False, user__is_active=True)
        have = set(Chat.objects.filter(kind=KIND).values_list("participants", flat=True))
        todo = [p for p in people if p.id not in have]
        self.stdout.write(f"людей: {people.count()}, уже с ящиком: {len(have & set(people.values_list('id', flat=True)))}, создать: {len(todo)}")
        old = Message.objects.filter(chat__kind=KIND, sender=bot, content__in=OLD_WELCOMES)
        self.stdout.write(f"старых приветствий обновить: {old.count()}")
        if opts["dry_run"]:
            return
        for p in todo:
            user_chat(p)
        old.update(content=WELCOME, buttons=MENU, updated_at=timezone.now())
        # Текущему приветствию и «спасибо» — кнопки списка идей.
        Message.objects.filter(chat__kind=KIND, sender=bot, content__in=(WELCOME, THANKS), buttons=[]).update(buttons=MENU, updated_at=timezone.now())
        self.stdout.write(self.style.SUCCESS(f"готово: создано {len(todo)}"))
