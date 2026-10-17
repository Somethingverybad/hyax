"""Сигналы приложения chat (подключаются в ChatConfig.ready)."""
from django.db.models.signals import pre_delete
from django.dispatch import receiver

from .models import Chat, TgLeave


@receiver(pre_delete)
def queue_tg_leave(sender, instance, **kwargs):
    """Удалили зеркало Telegram-канала — как угодно: кнопкой в админке, пачкой,
    из приложения — ставим в очередь отписку нашего аккаунта от источника.
    Без отправителя: у прокси Channel он свой, а не Chat."""
    if isinstance(instance, Chat) and instance.tg_username:
        TgLeave.objects.create(tg_username=instance.tg_username, tg_peer_id=instance.tg_peer_id,
                               title=(instance.name or "")[:100])
