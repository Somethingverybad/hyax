import uuid

import django.db.models.deletion
import django.utils.timezone
from django.db import migrations, models


def set_kind_from_is_group(apps, schema_editor):
    Chat = apps.get_model("chat", "Chat")
    Chat.objects.filter(is_group=True).update(kind="group")
    Chat.objects.filter(is_group=False).update(kind="direct")


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0022_profile_bot"),
    ]

    operations = [
        # ── Chat: тип и поля канала ──
        migrations.AddField(
            model_name="chat",
            name="kind",
            field=models.CharField(default="direct", max_length=10),
        ),
        migrations.AddField(
            model_name="chat",
            name="username",
            field=models.CharField(blank=True, max_length=32, null=True, unique=True),
        ),
        migrations.AddField(
            model_name="chat",
            name="description",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.AddField(
            model_name="chat",
            name="is_public",
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name="chat",
            name="sign_posts",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="chat",
            name="subscribers_count",
            field=models.IntegerField(default=0),
        ),
        migrations.AddField(
            model_name="chat",
            name="default_sound",
            field=models.ForeignKey(
                blank=True, null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="+", to="chat.notificationsound",
            ),
        ),
        migrations.RunPython(set_kind_from_is_group, noop),
        # ── ChatParticipant: роль ──
        migrations.AddField(
            model_name="chatparticipant",
            name="role",
            field=models.CharField(default="member", max_length=12),
        ),
        migrations.AddField(
            model_name="chatparticipant",
            name="muted",
            field=models.BooleanField(default=False),
        ),
        # ── Реакции / комментарии / просмотры постов ──
        migrations.CreateModel(
            name="PostReaction",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("kind", models.CharField(default="emoji", max_length=10)),
                ("value", models.CharField(max_length=64)),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("post", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="reactions", to="chat.message")),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="post_reactions", to="chat.profile")),
            ],
            options={"unique_together": {("post", "user")}},
        ),
        migrations.CreateModel(
            name="PostComment",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("content", models.TextField()),
                ("deleted", models.BooleanField(default=False)),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("author", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="post_comments", to="chat.profile")),
                ("parent", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name="replies", to="chat.postcomment")),
                ("post", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="comments", to="chat.message")),
            ],
            options={"ordering": ["created_at"]},
        ),
        migrations.CreateModel(
            name="PostView",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("post", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="views", to="chat.message")),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="post_views", to="chat.profile")),
            ],
            options={"unique_together": {("post", "user")}},
        ),
    ]
