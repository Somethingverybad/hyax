from django.db import migrations, models


class Migration(migrations.Migration):
    """Бот только для чтения (канал объявлений об обновлениях)."""

    dependencies = [
        ('chat', '0059_wallpaper_anim'),
    ]

    operations = [
        migrations.AddField(model_name='profile', name='readonly_bot', field=models.BooleanField(default=False)),
    ]
