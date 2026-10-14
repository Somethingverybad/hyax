# -*- coding: utf-8 -*-
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('chat', '0086_group_owner'),
    ]

    operations = [
        migrations.AddField(
            model_name='profile',
            name='ideabox_enabled',
            field=models.BooleanField(default=True),
        ),
    ]
