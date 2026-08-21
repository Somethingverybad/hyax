import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0010_merge_0009_merge_0009_profile_call_status"),
    ]

    operations = [
        migrations.CreateModel(
            name="NotificationSound",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("slug", models.SlugField(max_length=40, unique=True)),
                ("name", models.CharField(max_length=64)),
                ("file", models.FileField(upload_to="sounds/")),
                ("caf_url", models.TextField(blank=True, default="")),
                ("is_active", models.BooleanField(default=True)),
                ("order", models.IntegerField(default=0)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "ordering": ["order", "slug"],
            },
        ),
        migrations.AddField(
            model_name="message",
            name="sound",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="messages", to="chat.notificationsound"),
        ),
    ]
