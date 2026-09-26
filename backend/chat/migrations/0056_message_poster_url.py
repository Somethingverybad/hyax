from django.db import migrations, models


class Migration(migrations.Migration):
    """Превью видео: кадр-постер рядом с файлом."""

    dependencies = [
        ('chat', '0055_message_via_bot'),
    ]

    operations = [
        migrations.AddField(model_name='message', name='poster_url', field=models.TextField(blank=True, null=True)),
    ]
