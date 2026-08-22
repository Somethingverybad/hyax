from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0011_notificationsound_message_sound"),
    ]

    operations = [
        migrations.AlterField(
            model_name="pushtoken",
            name="platform",
            field=models.CharField(
                choices=[("ios", "iOS"), ("android", "Android"), ("ios_voip", "iOS VoIP (PushKit)")],
                max_length=10,
            ),
        ),
    ]
