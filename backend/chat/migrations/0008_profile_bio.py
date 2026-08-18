# Generated migration for adding bio field to Profile model

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('chat', '0007_voice_messages'),
    ]

    operations = [
        migrations.AddField(
            model_name='profile',
            name='bio',
            field=models.TextField(blank=True, max_length=500, null=True),
        ),
    ]
