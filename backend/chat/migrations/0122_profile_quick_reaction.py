from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0121_action_solo"),
    ]

    operations = [
        migrations.AddField(
            model_name="profile",
            name="quick_reaction",
            field=models.JSONField(blank=True, null=True),
        ),
    ]
