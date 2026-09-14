from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('chat', '0030_profile_notify_sound'),
    ]

    operations = [
        migrations.AddField(model_name='message', name='file_width', field=models.IntegerField(blank=True, null=True)),
        migrations.AddField(model_name='message', name='file_height', field=models.IntegerField(blank=True, null=True)),
    ]
