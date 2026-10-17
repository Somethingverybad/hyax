from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('chat', '0102_stickerpack_kind'),
    ]

    operations = [
        migrations.AddField(
            model_name='profile',
            name='obs_key',
            field=models.CharField(blank=True, db_index=True, default='', max_length=48),
        ),
    ]
