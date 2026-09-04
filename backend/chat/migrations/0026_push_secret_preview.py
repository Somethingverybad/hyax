from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0025_message_updated_at"),
    ]

    operations = [
        migrations.AddField(
            model_name="pushtoken",
            name="secret",
            field=models.CharField(blank=True, default="", max_length=64),
        ),
        migrations.AddField(
            model_name="profile",
            name="push_preview",
            field=models.BooleanField(default=True),
        ),
    ]
