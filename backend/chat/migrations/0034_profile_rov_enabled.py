from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('chat', '0033_chat_notify_sound'),
    ]

    operations = [
        migrations.AddField(
            model_name='profile',
            name='rov_enabled',
            field=models.BooleanField(default=True),
        ),
    ]
