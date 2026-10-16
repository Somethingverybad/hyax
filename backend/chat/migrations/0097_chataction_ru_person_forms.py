from django.db import migrations

# Глаголы, которые просят «кого» (адресату — «Вас обнимает …»); остальным — «Вам».
ACC_VERBS = {"обнимает", "целует", "гладит", "кусает", "жалеет", "щекочет", "тыкает", "щипает"}


def forward(apps, schema_editor):
    """Русские формы «Вы …» и «Вам/Вас …» для уже заведённых действий. Без
    сети: en/ko для этих лиц заполняет команда fill_action_phrases."""
    from chat.action_text import ru_self, ru_you
    ChatAction = apps.get_model("chat", "ChatAction")
    for a in ChatAction.objects.all():
        changed = []
        if not a.phrase_ru_self:
            a.phrase_ru_self = ru_self(a.verb)[:120]
            changed.append("phrase_ru_self")
        if not a.phrase_ru_you:
            a.phrase_ru_you = ru_you(a.verb, (a.verb or "").split(" ")[0] in ACC_VERBS)[:120]
            changed.append("phrase_ru_you")
        if changed:
            a.save(update_fields=changed)


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0096_chataction_person_phrases"),
    ]

    operations = [migrations.RunPython(forward, migrations.RunPython.noop)]
