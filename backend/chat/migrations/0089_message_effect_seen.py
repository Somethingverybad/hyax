# -*- coding: utf-8 -*-
import uuid

import django.db.models.deletion
import django.utils.timezone
from django.db import migrations, models


def mark_read_as_seen(apps, schema_editor):
    """Глюки, которые получатель уже прочитал, он уже и видел: раньше эффект
    играл при открытии чата. Без этой отметки после выкладки у всех разом
    высыпались бы старые глюк-стикеры."""
    Read = apps.get_model('chat', 'MessageReadStatus')
    Seen = apps.get_model('chat', 'MessageEffectSeen')
    rows = (Read.objects.exclude(message__effect='')
            .exclude(user_id=models.F('message__sender_id'))
            .values_list('message_id', 'user_id'))
    Seen.objects.bulk_create(
        [Seen(message_id=m, user_id=u) for m, u in rows.iterator()],
        ignore_conflicts=True, batch_size=1000)


class Migration(migrations.Migration):

    dependencies = [
        ('chat', '0088_stickerpack_open_add'),
    ]

    operations = [
        migrations.CreateModel(
            name='MessageEffectSeen',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('seen_at', models.DateTimeField(default=django.utils.timezone.now)),
                ('message', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='effect_seen', to='chat.message')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='+', to='chat.profile')),
            ],
            options={
                'unique_together': {('message', 'user')},
            },
        ),
        migrations.RunPython(mark_read_as_seen, migrations.RunPython.noop),
    ]
