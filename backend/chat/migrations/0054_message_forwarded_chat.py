from django.db import migrations, models
import django.db.models.deletion


def backfill(apps, schema_editor):
    """Старые пересылки из каналов хранили только имя канала: подставляем
    канал, если по имени он находится однозначно."""
    Message = apps.get_model('chat', 'Message')
    Chat = apps.get_model('chat', 'Chat')
    titles = (Message.objects.filter(forwarded_from__isnull=True, forwarded_chat__isnull=True)
              .exclude(forwarded_title='').values_list('forwarded_title', flat=True).distinct())
    for title in titles:
        chans = list(Chat.objects.filter(kind='channel', name=title)[:2])
        if len(chans) == 1:
            Message.objects.filter(forwarded_from__isnull=True, forwarded_chat__isnull=True, forwarded_title=title).update(forwarded_chat=chans[0])


class Migration(migrations.Migration):
    """Пересылка из канала: ссылка на канал-первоисточник."""

    dependencies = [
        ('chat', '0053_telegram_mirror'),
    ]

    operations = [
        migrations.AddField(model_name='message', name='forwarded_chat', field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to='chat.chat')),
        migrations.RunPython(backfill, migrations.RunPython.noop),
    ]
