from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0140_vpnlogin"),
    ]

    operations = [
        migrations.AddField(
            model_name="vpnaccess",
            name="direct_ru",
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name="vpnaccess",
            name="direct_custom",
            field=models.JSONField(blank=True, default=list),
        ),
    ]
