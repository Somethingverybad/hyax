from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0080_device_sessions"),
    ]

    operations = [
        migrations.AddField(model_name="profile", name="language", field=models.CharField(blank=True, default="", max_length=5)),
        migrations.AddField(model_name="chatparticipant", name="translate_in", field=models.BooleanField(default=False)),
        migrations.AddField(model_name="chatparticipant", name="translate_out", field=models.BooleanField(default=False)),
        migrations.AddField(model_name="message", name="translations", field=models.JSONField(blank=True, default=dict)),
    ]
