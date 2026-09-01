from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("chat", "0018_message_download_only")]
    operations = [
        migrations.AddField(
            model_name="message",
            name="video_mirror",
            field=models.BooleanField(default=False),
        ),
    ]
