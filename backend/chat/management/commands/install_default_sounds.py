"""Звук уведомления по умолчанию — «Уведомление» (chat/default_sounds/uved.mp3).

Кладёт файл в MEDIA_ROOT/sounds/ и заводит NotificationSound slug=uved в паке
по умолчанию (is_default): сохранение само делает .caf для iOS. Его слышат
получатели сообщений от тех, кто не выбрал свой звук (views._default_notify_sound),
— и по пушу (каталог / докачка по требованию), и в приложении.

    python manage.py install_default_sounds
"""
import os
import shutil

from django.conf import settings
from django.core.management.base import BaseCommand

from chat.models import NotificationSound, SoundPack

# silent — «Без звука»: беззвучный файл, чтобы и старые версии приложения,
# скачав его, играли тишину; сервер такие пуши шлёт вовсе без звука (views).
SOUNDS = [("uved", "Уведомление", "uved.mp3"), ("silent", "Без звука", "silent.mp3")]


class Command(BaseCommand):
    help = "Звук уведомления по умолчанию: файл и запись в паке по умолчанию"

    def handle(self, *args, **opts):
        src_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "default_sounds")
        pack = SoundPack.objects.filter(is_default=True).order_by("id").first()
        for slug, name, fname in SOUNDS:
            dst_rel = f"sounds/{fname}"
            dst = os.path.join(settings.MEDIA_ROOT, dst_rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copyfile(os.path.join(src_dir, fname), dst)
            snd = NotificationSound.objects.filter(slug=slug).first() or NotificationSound(slug=slug)
            snd.name = name
            snd.pack = pack
            snd.file = dst_rel
            snd.is_active = True
            snd.order = 0
            snd.save()  # .caf для iOS — в save()
            self.stdout.write(f"{slug}: {snd.file.name}, caf={snd.caf_url or '—'}, пак={pack.name if pack else '—'}")
