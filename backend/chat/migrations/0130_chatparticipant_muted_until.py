from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0129_profile_nav_tabs"),
    ]

    operations = [
        migrations.AddField(
            model_name="chatparticipant",
            name="muted_until",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
