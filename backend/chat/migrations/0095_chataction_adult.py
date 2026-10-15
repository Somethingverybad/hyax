from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0094_profile_vibe_saved"),
    ]

    operations = [
        migrations.AddField(
            model_name="chataction",
            name="adult",
            field=models.BooleanField(default=False),
        ),
    ]
