import django.db.models.deletion
from django.db import migrations, models

SEED = [('wink', 'Подмигнуть', 'подмигивает', '😉'), ('hug', 'Обнять', 'обнимает', '🤗'), ('kiss', 'Поцеловать', 'целует', '😘'), ('pat', 'Погладить', 'гладит', '\U0001faf6'), ('bite', 'Укусить', 'кусает', '😬'), ('kick', 'Дать пинка', 'даёт пинка', '🦵'), ('pity', 'Пожалеть', 'жалеет', '🥺'), ('tickle', 'Пощекотать', 'щекочет', '🪶'), ('highfive', 'Дать пять', 'даёт пять', '🙌'), ('wave', 'Помахать', 'машет', '👋'), ('poke', 'Ткнуть', 'тыкает', '👉'), ('pinch', 'Ущипнуть', 'щипает', '🤏'), ('flower', 'Подарить цветок', 'дарит цветок', '🌸'), ('tea', 'Налить чаю', 'наливает чаю', '🍵'), ('rays', 'Послать лучи добра', 'посылает лучи добра', '✨'), ('facepalm', 'Фейспалм', 'делает фейспалм из-за', '🤦'), ('finger', 'Погрозить пальцем', 'грозит пальцем', '☝️'), ('spin', 'Покрутить у виска', 'крутит пальцем у виска, глядя на', '🌀')]


def seed(apps, schema_editor):
    ChatAction = apps.get_model("chat", "ChatAction")
    for i, (slug, name, verb, emoji) in enumerate(SEED):
        ChatAction.objects.get_or_create(slug=slug, defaults={"name": name, "verb": verb, "emoji": emoji, "order": (i + 1) * 10})


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0074_profile_identity_updated_at"),
    ]

    operations = [
        migrations.CreateModel(
            name="ChatAction",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("slug", models.SlugField(max_length=40, unique=True)),
                ("name", models.CharField(max_length=40)),
                ("verb", models.CharField(max_length=60)),
                ("emoji", models.CharField(default="✨", max_length=8)),
                ("order", models.PositiveSmallIntegerField(default=100)),
                ("is_active", models.BooleanField(default=True)),
                ("premium", models.BooleanField(default=False)),
            ],
            options={"ordering": ["order", "name"]},
        ),
        migrations.AddField(model_name="message", name="action", field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+", to="chat.chataction")),
        migrations.AddField(model_name="message", name="action_target", field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+", to="chat.profile")),
        migrations.RunPython(seed, migrations.RunPython.noop),
    ]
