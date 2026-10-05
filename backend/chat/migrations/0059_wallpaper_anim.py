from django.db import migrations, models


class Migration(migrations.Migration):
    """Обои: анимированный WebP для iOS (не зависит от автозапуска видео)."""

    dependencies = [
        ('chat', '0058_message_effect'),
    ]

    operations = [
        migrations.AddField(model_name='chat', name='wallpaper_anim', field=models.TextField(blank=True, null=True)),
        migrations.AddField(model_name='chatparticipant', name='wallpaper_anim', field=models.TextField(blank=True, null=True)),
    ]
