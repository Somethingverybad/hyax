# -*- coding: utf-8 -*-
"""Владелец у каждой группы: у старых групп без creator им становится
участник, который в ней дольше всех (первый по joined_at)."""
from django.db import migrations


def fill_owner(apps, schema_editor):
    Chat = apps.get_model('chat', 'Chat')
    ChatParticipant = apps.get_model('chat', 'ChatParticipant')
    for chat in Chat.objects.filter(is_group=True, creator__isnull=True).exclude(kind='channel'):
        first = ChatParticipant.objects.filter(chat=chat).order_by('joined_at').first()
        if first:
            Chat.objects.filter(id=chat.id).update(creator_id=first.user_id)


class Migration(migrations.Migration):

    dependencies = [
        ('chat', '0085_chat_requests'),
    ]

    operations = [
        migrations.RunPython(fill_owner, migrations.RunPython.noop),
    ]
