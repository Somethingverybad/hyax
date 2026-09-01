from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("chat", "0017_soundpack")]
    operations = [
        migrations.AddField(
            model_name="message",
            name="download_only",
            field=models.BooleanField(default=False),
        ),
    ]
