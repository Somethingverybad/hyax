from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0013_chat_group"),
    ]

    operations = [
        migrations.AddField(
            model_name="message",
            name="video_url",
            field=models.TextField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="message",
            name="video_duration",
            field=models.IntegerField(blank=True, null=True),
        ),
    ]
