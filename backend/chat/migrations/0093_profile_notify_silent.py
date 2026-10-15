from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0092_profile_translate_wall"),
    ]

    operations = [
        migrations.AddField(
            model_name="profile",
            name="notify_silent",
            field=models.BooleanField(default=False),
        ),
    ]
