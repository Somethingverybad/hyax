from django.db import migrations, models
from django.db.models import OuterRef, Subquery


def backfill(apps, schema_editor):
    """Уже отправленные стикеры: запомнить файл, пока стикер ещё существует —
    тогда удаление набора их больше не сотрёт из переписки."""
    Message = apps.get_model("chat", "Message")
    Sticker = apps.get_model("chat", "Sticker")
    Message.objects.filter(sticker__isnull=False).update(
        sticker_file=Subquery(Sticker.objects.filter(id=OuterRef("sticker_id")).values("file_url")[:1])
    )


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0099_station_and_copyright_report"),
    ]

    operations = [
        migrations.AddField(
            model_name="message",
            name="sticker_file",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.RunPython(backfill, migrations.RunPython.noop),
    ]
