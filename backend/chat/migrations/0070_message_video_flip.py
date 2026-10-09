from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("chat", "0069_vibe_levels")]
    operations = [
        migrations.AddField(
            model_name="message",
            name="video_flip",
            field=models.BooleanField(default=False),
        ),
    ]
