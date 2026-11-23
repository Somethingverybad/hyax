import uuid

import django.db.models.deletion
import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0141_vpnaccess_direct"),
    ]

    operations = [
        migrations.CreateModel(
            name="VpnDirectShare",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("ru", models.BooleanField(default=True)),
                ("custom", models.JSONField(blank=True, default=list)),
                ("status", models.CharField(db_index=True, default="pending", max_length=10)),
                ("created_at", models.DateTimeField(db_index=True, default=django.utils.timezone.now)),
                ("decided_at", models.DateTimeField(blank=True, null=True)),
                ("message", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+", to="chat.message")),
                ("recipient", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="+", to="chat.profile")),
                ("sender", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="+", to="chat.profile")),
            ],
            options={"ordering": ("-created_at",)},
        ),
    ]
