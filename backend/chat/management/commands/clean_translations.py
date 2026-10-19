"""Убрать сохранённые «переводы», которые переводом не были.

Модель иногда отвечала сама вместо перевода («I appreciate you testing my
instructions…») или возвращала текст как есть, и это сохранялось в
Message.translations / transcript_translations: человек видел мусор вместо
перевода. Проверка — chat.translate.plausible; убранный перевод клиент
запросит заново.

    python manage.py clean_translations            # только показать
    python manage.py clean_translations --apply    # убрать
"""
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from chat.models import Message
from chat.translate import plausible, same_text


class Command(BaseCommand):
    help = "Убрать сохранённые переводы, которые не похожи на перевод"

    def add_arguments(self, parser):
        parser.add_argument("--days", type=int, default=90, help="за сколько дней смотреть (по умолчанию 90)")
        parser.add_argument("--apply", action="store_true", help="убрать (без него — только показать)")

    def handle(self, *args, days, apply, **kw):
        since = timezone.now() - timedelta(days=days)
        bad = 0
        touched = 0
        qs = Message.objects.filter(created_at__gte=since).only("id", "content", "voice_transcript", "translations", "transcript_translations")
        for m in qs.iterator(chunk_size=500):
            upd = {}
            for field, src in (("translations", m.content), ("transcript_translations", m.voice_transcript)):
                tr = dict(getattr(m, field) or {})
                if not tr or not (src or "").strip():
                    continue
                drop = [lang for lang, out in tr.items() if same_text(out, src) or not plausible(src, out, lang)]
                if not drop:
                    continue
                for lang in drop:
                    bad += 1
                    self.stdout.write(f"{m.id} {field}[{lang}]: {str(tr[lang])[:80]!r}")
                    tr.pop(lang)
                upd[field] = tr
            if upd:
                touched += 1
                if apply:
                    # updated_at — чтобы клиенты забрали сообщение синхронизацией
                    # и перестали показывать мусор из своего кеша.
                    Message.objects.filter(id=m.id).update(**upd, updated_at=timezone.now())
        verb = "убрано" if apply else "найдено (без --apply ничего не меняю)"
        self.stdout.write(self.style.SUCCESS(f"{verb}: {bad} переводов в {touched} сообщениях за {days} дн."))
