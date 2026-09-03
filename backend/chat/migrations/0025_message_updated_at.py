import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0024_pin_forward_saved"),
    ]

    operations = [
        migrations.AddField(
            model_name="message",
            name="updated_at",
            field=models.DateTimeField(auto_now=True, db_index=True, default=django.utils.timezone.now),
            preserve_default=False,
        ),
    ]
