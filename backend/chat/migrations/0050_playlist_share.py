from django.db import migrations, models


class Migration(migrations.Migration):
    """Ссылка на плейлист: ключ вместо id, чтобы доступ можно было отозвать."""

    dependencies = [
        ('chat', '0049_message_buttons'),
    ]

    operations = [
        migrations.AddField(
            model_name='playlist',
            name='share_token',
            field=models.CharField(blank=True, db_index=True, default='', max_length=32),
        ),
    ]
