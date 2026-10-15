from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0091_pushtoken_unique_platform"),
    ]

    operations = [
        migrations.AddField(
            model_name="profile",
            name="translate_wall",
            field=models.BooleanField(blank=True, default=None, null=True),
        ),
    ]
