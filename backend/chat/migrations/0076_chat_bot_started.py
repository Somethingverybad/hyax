from django.db import migrations, models


def mark_existing(apps, schema_editor):
    """Личка с ботом, созданная до появления «Начать», считается начатой —
    иначе работающие боты замолчали бы."""
    Chat = apps.get_model("chat", "Chat")
    Chat.objects.filter(kind="direct", participants__is_bot=True).distinct().update(bot_started=True)


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0075_chataction"),
    ]

    operations = [
        migrations.AddField(model_name="chat", name="bot_started", field=models.BooleanField(default=False)),
        migrations.RunPython(mark_existing, migrations.RunPython.noop),
    ]
