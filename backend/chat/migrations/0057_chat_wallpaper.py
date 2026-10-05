from django.db import migrations, models


class Migration(migrations.Migration):
    """Обои чата: общие у чата и личная замена у участника."""

    dependencies = [
        ('chat', '0056_message_poster_url'),
    ]

    operations = [
        migrations.AddField(model_name='chat', name='wallpaper_url', field=models.TextField(blank=True, null=True)),
        migrations.AddField(model_name='chat', name='wallpaper_kind', field=models.CharField(blank=True, default='', max_length=8)),
        migrations.AddField(model_name='chat', name='wallpaper_poster', field=models.TextField(blank=True, null=True)),
        migrations.AddField(model_name='chatparticipant', name='wallpaper_url', field=models.TextField(blank=True, null=True)),
        migrations.AddField(model_name='chatparticipant', name='wallpaper_kind', field=models.CharField(blank=True, default='', max_length=8)),
        migrations.AddField(model_name='chatparticipant', name='wallpaper_poster', field=models.TextField(blank=True, null=True)),
    ]
