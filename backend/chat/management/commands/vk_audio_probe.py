from django.core.management.base import BaseCommand, CommandError

from chat.vk_music import VkAudioClient, VkAudioError


class Command(BaseCommand):
    help = "Проверить доступ VK_AUDIO_TOKEN к audio.search без скачивания файлов"

    def add_arguments(self, parser):
        parser.add_argument("query", nargs="?", default="test", help="Тестовый поисковый запрос")
        parser.add_argument("--count", type=int, default=3, help="Число результатов (1–10)")

    def handle(self, *args, **options):
        try:
            tracks = VkAudioClient().search(
                options["query"],
                count=max(1, min(options["count"], 10)),
            )
        except VkAudioError as exc:
            suffix = f" (VK error {exc.code})" if exc.code else ""
            raise CommandError(f"Проверка не прошла{suffix}: {exc}") from exc

        self.stdout.write(self.style.SUCCESS(f"VK audio.search доступен; найдено: {len(tracks)}"))
        for index, track in enumerate(tracks, 1):
            self.stdout.write(f"{index}. {track.artist} — {track.title} [{track.raw_id}]")
