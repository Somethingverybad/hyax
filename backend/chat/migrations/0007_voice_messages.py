# Generated manually for voice messages functionality

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('chat', '0006_pushtoken'),
    ]

    operations = [
        migrations.AddField(
            model_name='message',
            name='voice_url',
            field=models.TextField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='message',
            name='voice_duration',
            field=models.IntegerField(blank=True, null=True),
        ),
    ]
