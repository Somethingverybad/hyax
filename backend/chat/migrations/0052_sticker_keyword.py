from django.db import migrations, models


class Migration(migrations.Migration):
    """Макрос стикера: слово, по которому он подсказывается при наборе."""

    dependencies = [
        ('chat', '0051_last_seen'),
    ]

    operations = [
        migrations.AddField(
            model_name='sticker',
            name='keyword',
            field=models.CharField(blank=True, default='', max_length=40),
        ),
    ]
