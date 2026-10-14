from django.db import migrations, models


def unset_explicit_false(apps, schema_editor):
    """Флаги, которых никто не трогал, были False по умолчанию — делаем их
    «как в профиле» (None), чтобы заработали настройки по умолчанию."""
    CP = apps.get_model("chat", "ChatParticipant")
    CP.objects.filter(translate_in=False).update(translate_in=None)
    CP.objects.filter(translate_out=False).update(translate_out=None)


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0081_translations"),
    ]

    operations = [
        migrations.AddField(model_name="profile", name="translate_in_default", field=models.BooleanField(default=False)),
        migrations.AddField(model_name="profile", name="translate_out_default", field=models.BooleanField(default=False)),
        migrations.AlterField(model_name="chatparticipant", name="translate_in", field=models.BooleanField(blank=True, default=None, null=True)),
        migrations.AlterField(model_name="chatparticipant", name="translate_out", field=models.BooleanField(blank=True, default=None, null=True)),
        migrations.RunPython(unset_explicit_false, migrations.RunPython.noop),
    ]
