from django.db import migrations, models


def mark_legacy_defaults(apps, schema_editor):
    """Прежнее правило «стандартный = без владельца» переносим в явный флаг,
    чтобы поведение не изменилось в момент миграции."""
    SoundPack = apps.get_model("chat", "SoundPack")
    SoundPack.objects.filter(creator__isnull=True).update(is_default=True)


class Migration(migrations.Migration):

    dependencies = [
        ('chat', '0038_soundpack_subscriptions'),
    ]

    operations = [
        migrations.AddField(
            model_name='soundpack',
            name='is_default',
            field=models.BooleanField(db_index=True, default=False),
        ),
        migrations.RunPython(mark_legacy_defaults, migrations.RunPython.noop),
    ]
