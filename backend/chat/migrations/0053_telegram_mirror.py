from django.db import migrations, models


class Migration(migrations.Migration):
    """Зеркала Telegram-каналов: поля канала и id поста в Telegram."""

    dependencies = [
        ('chat', '0052_sticker_keyword'),
    ]

    operations = [
        migrations.AddField(model_name='chat', name='tg_username', field=models.CharField(blank=True, max_length=64, null=True, unique=True)),
        migrations.AddField(model_name='chat', name='tg_peer_id', field=models.BigIntegerField(blank=True, null=True)),
        migrations.AddField(model_name='chat', name='tg_state', field=models.CharField(blank=True, default='', max_length=10)),
        migrations.AddField(model_name='chat', name='tg_error', field=models.CharField(blank=True, default='', max_length=300)),
        migrations.AddField(model_name='message', name='tg_id', field=models.BigIntegerField(blank=True, null=True)),
        migrations.AddIndex(model_name='message', index=models.Index(fields=['chat', 'tg_id'], name='msg_chat_tg_idx')),
    ]
