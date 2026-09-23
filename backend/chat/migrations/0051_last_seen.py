from django.db import migrations, models


class Migration(migrations.Migration):
    """Время последнего входа и настройка его показа."""

    dependencies = [
        ('chat', '0050_playlist_share'),
    ]

    operations = [
        migrations.AddField(
            model_name='profile',
            name='last_seen',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='profile',
            name='show_last_seen',
            field=models.BooleanField(default=True),
        ),
    ]
