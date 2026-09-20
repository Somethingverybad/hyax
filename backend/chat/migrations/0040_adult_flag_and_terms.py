from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('chat', '0039_soundpack_is_default'),
    ]

    operations = [
        migrations.AddField(
            model_name='profile',
            name='allow_adult',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='profile',
            name='terms_accepted_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='soundpack',
            name='is_adult',
            field=models.BooleanField(db_index=True, default=False),
        ),
        migrations.AddField(
            model_name='stickerpack',
            name='is_adult',
            field=models.BooleanField(db_index=True, default=False),
        ),
    ]
