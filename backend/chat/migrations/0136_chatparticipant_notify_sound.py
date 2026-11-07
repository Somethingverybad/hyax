from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0135_chataction_fx"),
    ]

    operations = [
        migrations.AddField(
            model_name="chatparticipant",
            name="notify_sound",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+", to="chat.notificationsound"),
        ),
    ]
