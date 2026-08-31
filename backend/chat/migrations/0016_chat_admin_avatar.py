from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0015_message_reply_to"),
    ]

    operations = [
        migrations.AddField(
            model_name="chat",
            name="avatar_url",
            field=models.TextField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="chat",
            name="creator",
            field=models.ForeignKey(
                blank=True, null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="created_chats", to="chat.profile",
            ),
        ),
    ]
