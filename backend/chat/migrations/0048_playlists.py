import uuid

import django.db.models.deletion
import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):
    """Плейлисты: своя музыка из переписки.

    Ссылка на файл хранится в треке, а не только ссылкой на сообщение:
    сообщение могут удалить, а плейлист от этого рассыпаться не должен.
    """

    dependencies = [
        ('chat', '0047_reactions'),
    ]

    operations = [
        migrations.CreateModel(
            name='Playlist',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('name', models.CharField(max_length=60)),
                ('is_default', models.BooleanField(default=False)),
                ('created_at', models.DateTimeField(default=django.utils.timezone.now)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('owner', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE,
                                            related_name='playlists', to='chat.profile')),
            ],
            options={'ordering': ['-is_default', 'created_at']},
        ),
        migrations.CreateModel(
            name='PlaylistTrack',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('file_url', models.TextField()),
                ('title', models.CharField(max_length=200)),
                ('artist', models.CharField(blank=True, default='', max_length=200)),
                ('duration', models.FloatField(blank=True, null=True)),
                ('position', models.IntegerField(default=0)),
                ('added_at', models.DateTimeField(default=django.utils.timezone.now)),
                ('playlist', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE,
                                               related_name='tracks', to='chat.playlist')),
                ('source', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                                             related_name='+', to='chat.message')),
            ],
            options={'ordering': ['position', 'added_at']},
        ),
        migrations.AddConstraint(
            model_name='playlisttrack',
            constraint=models.UniqueConstraint(fields=('playlist', 'file_url'), name='uniq_track_per_playlist'),
        ),
    ]
