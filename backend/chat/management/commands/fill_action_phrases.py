from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Заполнить пустые переводы действий (en/ko: кнопка и фразы для остальных, отправителя и адресата) переводчиком."

    def handle(self, *args, **opts):
        from chat.models import ChatAction
        from chat.views import _fill_action_translations
        for a in ChatAction.objects.all():
            _fill_action_translations(a)
            a.save()
            self.stdout.write(f"{a.emoji} {a.name}: {a.phrase_en_self or '—'} | {a.phrase_en_you or '—'}")
