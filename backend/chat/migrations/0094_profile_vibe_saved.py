from django.db import migrations, models


class Migration(migrations.Migration):
    """Отдельно от 0093: та уже применена на сервере без этого поля (колонку
    там добавили вручную во время сбоя 2026-10-15 — на сервере 0094 --fake)."""

    dependencies = [
        ("chat", "0093_profile_notify_silent"),
    ]

    operations = [
        migrations.AddField(
            model_name="profile",
            name="vibe_saved",
            field=models.IntegerField(blank=True, null=True),
        ),
    ]
