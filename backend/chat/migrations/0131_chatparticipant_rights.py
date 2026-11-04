from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0130_chatparticipant_muted_until"),
    ]

    operations = [
        migrations.AddField(
            model_name="chatparticipant",
            name="rights",
            field=models.JSONField(blank=True, default=list),
        ),
    ]
