"""Анимированный WebP для уже загруженных анимированных аватаров и стикеров.

Новые получают его при загрузке (views._animated_media → anim_webp). Здесь —
те, что загружены раньше: все «*.mp4» рядом с кадром «*.mp4.jpg», у которых
ещё нет «*.mp4.webp». Повторный запуск ничего не переделывает.
"""
import os
from concurrent.futures import ThreadPoolExecutor

from django.conf import settings
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Сделать анимированный WebP рядом с mp4 аватаров и стикеров"

    def handle(self, *args, **opts):
        from chat.views import anim_webp
        todo = []
        for sub in ("avatars", "stickers", "covers"):
            root = os.path.join(settings.MEDIA_ROOT, sub)
            if not os.path.isdir(root):
                continue
            for dirpath, _, files in os.walk(root):
                for f in files:
                    p = os.path.join(dirpath, f)
                    if f.endswith(".mp4") and os.path.exists(p + ".jpg") and not os.path.exists(p + ".webp"):
                        todo.append(p)
        self.stdout.write(f"без WebP: {len(todo)}")
        with ThreadPoolExecutor(max_workers=3) as pool:
            done = sum(pool.map(anim_webp, todo))
        self.stdout.write(self.style.SUCCESS(f"сделано: {done} из {len(todo)}"))
