import uuid

import django.db.models.deletion
import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0079_keytransfer"),
    ]

    operations = [
        migrations.AddField(model_name="profile", name="sessions_valid_from", field=models.DateTimeField(blank=True, null=True)),
        migrations.CreateModel(
            name="Device",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("device_id", models.CharField(max_length=64)),
                ("name", models.CharField(blank=True, default="", max_length=120)),
                ("platform", models.CharField(blank=True, default="", max_length=16)),
                ("app_version", models.CharField(blank=True, default="", max_length=32)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("last_seen", models.DateTimeField(default=django.utils.timezone.now)),
                ("revoked_at", models.DateTimeField(blank=True, null=True)),
                ("profile", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="devices", to="chat.profile")),
            ],
            options={"unique_together": {("profile", "device_id")}},
        ),
    ]
