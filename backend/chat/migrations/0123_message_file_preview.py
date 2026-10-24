from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0122_profile_quick_reaction"),
    ]

    operations = [
        migrations.AddField(
            model_name="message",
            name="file_preview",
            field=models.TextField(blank=True, default=""),
        ),
    ]
