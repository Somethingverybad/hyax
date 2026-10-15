# -*- coding: utf-8 -*-
from django.db import migrations


class Migration(migrations.Migration):
    """Токены одного устройства — по одному каждого вида (ios и ios_voip у
    iPhone): с уникальностью (user, device_id) один стирал другой."""

    dependencies = [
        ('chat', '0090_saved_image_vibe'),
    ]

    operations = [
        migrations.AlterUniqueTogether(
            name='pushtoken',
            unique_together={('user', 'device_id', 'platform')},
        ),
    ]
