from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('chat', '0104_message_origin_message'),
    ]

    operations = [
        migrations.AddField(
            model_name='sticker',
            name='repaint',
            field=models.BooleanField(default=False),
        ),
    ]
