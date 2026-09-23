import uuid

import django.db.models.deletion
import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('chat', '0045_profile_hide_online'),
    ]

    operations = [
        migrations.AddField(
            model_name='profile',
            name='saved_visibility',
            field=models.CharField(
                choices=[('all', 'Все'), ('selected', 'Избранные'), ('none', 'Никто')],
                default='all', max_length=10),
        ),
        migrations.CreateModel(
            name='SavedViewer',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('created_at', models.DateTimeField(default=django.utils.timezone.now)),
                ('owner', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE,
                                            related_name='saved_viewers', to='chat.profile')),
                ('viewer', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE,
                                             related_name='can_see_saved_of', to='chat.profile')),
            ],
            options={
                'unique_together': {('owner', 'viewer')},
                'indexes': [models.Index(fields=['owner', 'viewer'], name='chat_savedviewer_idx')],
            },
        ),
    ]
