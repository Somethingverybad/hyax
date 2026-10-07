from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('chat', '0064_secret_chats'),
    ]

    operations = [
        migrations.AddField(model_name='message', name='transcript_for', field=models.JSONField(blank=True, default=list)),
    ]
