"""Одноразовый вход аккаунта Telegram для зеркал каналов.

    docker compose run --rm -it tg python manage.py tg_login

Спросит телефон, код из Telegram и пароль двухэтапной защиты, если включён.
Сессия ляжет в private/tg.session (том ./backend примонтирован в контейнер),
дальше её использует tg_mirror. API_ID/API_HASH — с my.telegram.org, в .env
как TG_API_ID и TG_API_HASH.
"""
import asyncio
import os

from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = "Войти в Telegram-аккаунт зеркала (интерактивно, один раз)"

    def handle(self, *args, **options):
        from telethon import TelegramClient
        api_id = os.environ.get("TG_API_ID")
        api_hash = os.environ.get("TG_API_HASH")
        if not api_id or not api_hash:
            raise CommandError("Нужны TG_API_ID и TG_API_HASH в окружении (my.telegram.org → API development tools)")
        session = os.environ.get("TG_SESSION", "/app/private/tg")
        os.makedirs(os.path.dirname(session), exist_ok=True)

        async def run():
            client = TelegramClient(session, int(api_id), api_hash, use_ipv6=os.environ.get("TG_IPV6", "1") == "1")
            await client.start()  # телефон, код, пароль — спросит в консоли
            me = await client.get_me()
            self.stdout.write(self.style.SUCCESS(f"Вошли как {me.first_name} (@{me.username or '—'}), сессия: {session}.session"))
            await client.disconnect()

        asyncio.run(run())
