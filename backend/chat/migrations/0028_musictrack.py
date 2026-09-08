import uuid

import django.db.models.deletion
import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0027_savedimage"),
    ]

    operations = [
        migrations.CreateModel(
            name="MusicTrack",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("title", models.CharField(max_length=120)),
                ("artist", models.CharField(blank=True, default="", max_length=120)),
                ("file", models.FileField(upload_to="music/")),
                ("duration", models.IntegerField(default=0)),
                ("created_at", models.DateTimeField(db_index=True, default=django.utils.timezone.now)),
                ("owner", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="music_tracks", to="chat.profile")),
            ],
            options={"ordering": ["-created_at"]},
        ),
    ]
