from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0072_chat_comments_enabled"),
    ]

    operations = [
        migrations.AddField(model_name="profile", name="ringtone", field=models.CharField(blank=True, default="", max_length=80)),
    ]
