from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0138_vpn_nodes_access_reports"),
    ]

    operations = [
        migrations.AddField(
            model_name="vpnnode",
            name="ips",
            field=models.CharField(blank=True, default="", max_length=300),
        ),
    ]
