from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0012_pushtoken_platform_ios_voip"),
    ]

    operations = [
        migrations.AddField(
            model_name="chat",
            name="name",
            field=models.CharField(blank=True, default="", max_length=100),
        ),
        migrations.AddField(
            model_name="chat",
            name="is_group",
            field=models.BooleanField(default=False),
        ),
    ]
