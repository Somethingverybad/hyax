import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0078_profile_email"),
    ]

    operations = [
        migrations.CreateModel(
            name="KeyTransfer",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("code", models.CharField(max_length=6)),
                ("new_pub", models.TextField()),
                ("old_pub", models.TextField(blank=True, default="")),
                ("blob", models.TextField(blank=True, default="")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("sent_at", models.DateTimeField(blank=True, null=True)),
                ("owner", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="key_transfers", to="chat.profile")),
            ],
        ),
    ]
