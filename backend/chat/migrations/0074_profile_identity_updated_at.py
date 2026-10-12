import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0073_profile_ringtone"),
    ]

    operations = [
        migrations.AddField(model_name="profile", name="identity_updated_at", field=models.DateTimeField(default=django.utils.timezone.now)),
    ]
