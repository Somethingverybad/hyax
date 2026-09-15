from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('chat', '0031_message_media_dims'),
    ]

    operations = [
        migrations.AddField(model_name='message', name='album_id', field=models.UUIDField(blank=True, null=True, db_index=True)),
    ]
