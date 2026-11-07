from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0136_chatparticipant_notify_sound"),
    ]

    operations = [
        migrations.AddField(
            model_name="postcomment",
            name="entities",
            field=models.JSONField(blank=True, default=list),
        ),
    ]
