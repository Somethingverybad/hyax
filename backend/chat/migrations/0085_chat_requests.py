# -*- coding: utf-8 -*-
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('chat', '0084_chataction_i18n'),
    ]

    operations = [
        migrations.AddField(
            model_name='profile',
            name='confirm_chats',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='chat',
            name='pending_for',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='+', to='chat.profile'),
        ),
    ]
