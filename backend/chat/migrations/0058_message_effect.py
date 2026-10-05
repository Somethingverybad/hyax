from django.db import migrations, models


class Migration(migrations.Migration):
    """Эффект сообщения (burst — стикер высыпается по экрану)."""

    dependencies = [
        ('chat', '0057_chat_wallpaper'),
    ]

    operations = [
        migrations.AddField(model_name='message', name='effect', field=models.CharField(blank=True, default='', max_length=16)),
    ]
