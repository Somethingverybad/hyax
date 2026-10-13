from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0076_chat_bot_started"),
    ]

    operations = [
        migrations.AddField(model_name="profile", name="aura_anim", field=models.BooleanField(default=True)),
    ]
