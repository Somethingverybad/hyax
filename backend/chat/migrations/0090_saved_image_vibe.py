# -*- coding: utf-8 -*-
import uuid

import django.db.models.deletion
import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('chat', '0089_message_effect_seen'),
    ]

    operations = [
        migrations.CreateModel(
            name='SavedImageVibe',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('created_at', models.DateTimeField(default=django.utils.timezone.now)),
                ('image', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='vibes', to='chat.savedimage')),
                ('voter', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='+', to='chat.profile')),
            ],
            options={
                'constraints': [models.UniqueConstraint(fields=('image', 'voter'), name='saved_vibe_once')],
            },
        ),
    ]
