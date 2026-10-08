import uuid

import django.db.models.deletion
import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('chat', '0066_message_mentions'),
    ]

    operations = [
        migrations.AddField(
            model_name='profile',
            name='vibe',
            field=models.IntegerField(default=0),
        ),
        migrations.CreateModel(
            name='VibeVote',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('created_at', models.DateTimeField(default=django.utils.timezone.now)),
                ('target', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='vibe_votes', to='chat.profile')),
                ('voter', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='+', to='chat.profile')),
            ],
            options={
                'constraints': [models.UniqueConstraint(fields=('voter', 'target'), name='vibe_vote_once')],
            },
        ),
        migrations.CreateModel(
            name='Idea',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('text', models.TextField()),
                ('likes', models.IntegerField(default=0)),
                ('dislikes', models.IntegerField(default=0)),
                ('status', models.CharField(blank=True, default='', max_length=8)),
                ('created_at', models.DateTimeField(db_index=True, default=django.utils.timezone.now)),
                ('done_at', models.DateTimeField(blank=True, null=True)),
                ('author', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='ideas', to='chat.profile')),
                ('message', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to='chat.message')),
            ],
        ),
        migrations.CreateModel(
            name='IdeaVote',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('value', models.SmallIntegerField()),
                ('created_at', models.DateTimeField(default=django.utils.timezone.now)),
                ('idea', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='votes', to='chat.idea')),
                ('voter', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='+', to='chat.profile')),
            ],
            options={
                'constraints': [models.UniqueConstraint(fields=('idea', 'voter'), name='idea_vote_once')],
            },
        ),
    ]
