import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0077_profile_aura_anim"),
    ]

    operations = [
        migrations.AddField(model_name="profile", name="email", field=models.EmailField(blank=True, default="", max_length=254)),
        migrations.AddField(model_name="profile", name="email_verified_at", field=models.DateTimeField(blank=True, null=True)),
        migrations.CreateModel(
            name="EmailCode",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("email", models.EmailField(max_length=254)),
                ("code", models.CharField(max_length=8)),
                ("purpose", models.CharField(max_length=10)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("attempts", models.PositiveSmallIntegerField(default=0)),
                ("used_at", models.DateTimeField(blank=True, null=True)),
                ("profile", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="email_codes", to="chat.profile")),
            ],
            options={"indexes": [models.Index(fields=["profile", "purpose", "created_at"], name="emailcode_lookup_idx")]},
        ),
    ]
