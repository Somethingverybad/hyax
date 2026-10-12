import django.db.models.deletion
import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0070_message_video_flip"),
    ]

    operations = [
        migrations.AddField(model_name="profile", name="wall_enabled", field=models.BooleanField(default=True)),
        migrations.AddField(model_name="profile", name="wall_seen_at", field=models.DateTimeField(blank=True, null=True)),
        migrations.AddField(model_name="message", name="wall_safe", field=models.BooleanField(default=False)),
        migrations.AddField(model_name="message", name="wall_hidden", field=models.BooleanField(default=False)),
        migrations.CreateModel(
            name="WallMute",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("author", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="+", to="chat.profile")),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="wall_mutes", to="chat.profile")),
            ],
            options={"unique_together": {("user", "author")}},
        ),
        migrations.CreateModel(
            name="WallBan",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("until", models.DateTimeField(blank=True, null=True)),
                ("reason", models.CharField(blank=True, default="", max_length=200)),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("created_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+", to="chat.profile")),
                ("user", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="wall_ban", to="chat.profile")),
            ],
        ),
    ]
