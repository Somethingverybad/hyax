from django.core.management.base import BaseCommand, CommandError

from chat.vk_music import ensure_music_bot, music_bot_enabled


class Command(BaseCommand):
    help = "Создать системного VK Music Bot (если функция включена)"

    def add_arguments(self, parser):
        parser.add_argument(
            "--force",
            action="store_true",
            help="Создать бота даже без VK_MUSIC_BOT_ENABLED=1",
        )

    def handle(self, *args, **options):
        if not options["force"] and not music_bot_enabled():
            self.stdout.write("VK Music Bot выключен; пропускаю создание")
            return
        try:
            bot = ensure_music_bot(force=options["force"])
        except RuntimeError as exc:
            raise CommandError(str(exc)) from exc
        self.stdout.write(self.style.SUCCESS(f"VK Music Bot готов: @{bot.username} ({bot.id})"))

