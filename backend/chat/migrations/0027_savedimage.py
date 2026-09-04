import uuid

import django.db.models.deletion
import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0026_push_secret_preview"),
    ]

    operations = [
        migrations.CreateModel(
            name="SavedImage",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("file_url", models.TextField()),
                ("file_name", models.TextField(blank=True, default="")),
                ("created_at", models.DateTimeField(db_index=True, default=django.utils.timezone.now)),
                ("owner", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="saved_images", to="chat.profile")),
                ("source_message", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+", to="chat.message")),
            ],
            options={"ordering": ["-created_at"]},
        ),
        migrations.AddConstraint(
            model_name="savedimage",
            constraint=models.UniqueConstraint(fields=("owner", "file_url"), name="uniq_saved_image_per_owner"),
        ),
    ]
