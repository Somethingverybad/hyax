import uuid
import django.db.models.deletion
import django.utils.timezone
from django.db import migrations, models


def create_legacy_pack(apps, schema_editor):
    SoundPack = apps.get_model("chat", "SoundPack")
    NotificationSound = apps.get_model("chat", "NotificationSound")
    if not NotificationSound.objects.exists():
        return
    legacy, _ = SoundPack.objects.get_or_create(
        name="Legacy", defaults={"order": 0}
    )
    NotificationSound.objects.filter(pack__isnull=True).update(pack=legacy)


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0016_chat_admin_avatar"),
    ]

    operations = [
        migrations.CreateModel(
            name="SoundPack",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("name", models.CharField(max_length=64)),
                ("order", models.IntegerField(default=0)),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
            ],
            options={"ordering": ["order", "name"]},
        ),
        migrations.AddField(
            model_name="notificationsound",
            name="pack",
            field=models.ForeignKey(
                blank=True, null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="sounds", to="chat.soundpack",
            ),
        ),
        migrations.RunPython(create_legacy_pack, noop),
    ]
