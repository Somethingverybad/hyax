from django.db import migrations, models


class Migration(migrations.Migration):
    """Кнопки под сообщением — их ставит бот, нажатие уходит ему событием."""

    dependencies = [
        ('chat', '0048_playlists'),
    ]

    operations = [
        migrations.AddField(
            model_name='message',
            name='buttons',
            field=models.JSONField(blank=True, default=list),
        ),
    ]
