from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('chat', '0044_message_chat_created_index'),
    ]

    operations = [
        migrations.AddField(
            model_name='profile',
            name='hide_online',
            field=models.BooleanField(default=False),
        ),
    ]
