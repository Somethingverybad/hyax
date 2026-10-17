from django.db import migrations, models


def neutral_pack_descriptions(apps, schema_editor):
    """Описание импортированных наборов — без названия чужого сервиса."""
    StickerPack = apps.get_model("chat", "StickerPack")
    for p in StickerPack.objects.filter(description__startswith="Импорт из Telegram:"):
        p.description = "Импорт по ссылке:" + p.description[len("Импорт из Telegram:"):]
        p.save(update_fields=["description"])


class Migration(migrations.Migration):

    dependencies = [
        ('chat', '0107_profile_hide_from_search'),
    ]

    operations = [
        migrations.AddField(
            model_name='profile',
            name='bot_private',
            field=models.BooleanField(default=False),
        ),
        migrations.RunPython(neutral_pack_descriptions, migrations.RunPython.noop),
    ]
