from django.db import migrations, models

# Шаблон эффекта у уже заведённых действий: тапки, поцелуй, пинок, тычки —
# «бросок», обнять и пожалеть — «объятие», подмигнуть — «подмигивание»,
# остальные — «плашка» (по умолчанию).
FX_BY_SLUG = {
    "throw-a-slipper": "throw", "throw-two-slippers": "throw", "kiss": "throw", "kick": "throw",
    "poke": "throw", "poke-in-the-nose": "throw",
    "hug": "hug", "pity": "hug",
    "wink": "wink",
}


def set_fx(apps, schema_editor):
    ChatAction = apps.get_model("chat", "ChatAction")
    for slug, fx in FX_BY_SLUG.items():
        ChatAction.objects.filter(slug=slug).update(fx=fx)


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0134_profile_email_prompt_off"),
    ]

    operations = [
        migrations.AddField(
            model_name="chataction",
            name="fx",
            field=models.CharField(choices=[("pop", "Плашка: качается, вокруг копии эмодзи"), ("throw", "Бросок: эмодзи летит в экран и сползает по стеклу"), ("hug", "Объятие: плашку сжимает с боков"), ("wink", "Подмигивание: плашка становится глазом и подмигивает")], default="pop", max_length=12),
        ),
        migrations.RunPython(set_fx, migrations.RunPython.noop),
    ]
