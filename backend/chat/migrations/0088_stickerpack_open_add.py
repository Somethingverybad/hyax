# -*- coding: utf-8 -*-
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('chat', '0087_ideabox_enabled'),
    ]

    operations = [
        migrations.AddField(
            model_name='stickerpack',
            name='open_add',
            field=models.BooleanField(default=False),
        ),
    ]
