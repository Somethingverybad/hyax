import uuid

import django.db.models.deletion
import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0139_vpnnode_ips"),
    ]

    operations = [
        migrations.CreateModel(
            name="VpnLogin",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("secret_hash", models.CharField(max_length=64)),
                ("status", models.CharField(db_index=True, default="pending", max_length=10)),
                ("device_id", models.CharField(blank=True, default="", max_length=64)),
                ("device_name", models.CharField(blank=True, default="", max_length=120)),
                ("platform", models.CharField(blank=True, default="", max_length=16)),
                ("app_version", models.CharField(blank=True, default="", max_length=32)),
                ("ip", models.CharField(blank=True, default="", max_length=64)),
                ("created_at", models.DateTimeField(db_index=True, default=django.utils.timezone.now)),
                ("expires_at", models.DateTimeField()),
                ("decided_at", models.DateTimeField(blank=True, null=True)),
                ("message", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+", to="chat.message")),
                ("profile", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="vpn_logins", to="chat.profile")),
            ],
            options={"ordering": ("-created_at",)},
        ),
    ]
