# Generated manually for sticker functionality

from django.db import migrations, models
import django.db.models.deletion
import uuid
from django.utils import timezone


class Migration(migrations.Migration):

    dependencies = [
        ('chat', '0004_message_file_size'),
    ]

    operations = [
        # Создание модели StickerPack
        migrations.CreateModel(
            name='StickerPack',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('name', models.CharField(max_length=100)),
                ('description', models.TextField(blank=True, null=True)),
                ('is_public', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(default=timezone.now)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('author', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='created_sticker_packs', to='chat.profile')),
            ],
        ),
        
        # Создание модели Sticker
        migrations.CreateModel(
            name='Sticker',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('file_url', models.TextField()),
                ('file_name', models.CharField(max_length=255)),
                ('emoji', models.CharField(blank=True, max_length=10, null=True)),
                ('order', models.IntegerField(default=0)),
                ('created_at', models.DateTimeField(default=timezone.now)),
                ('pack', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='stickers', to='chat.stickerpack')),
            ],
            options={
                'ordering': ['order', 'created_at'],
            },
        ),
        
        # Создание модели UserStickerPack
        migrations.CreateModel(
            name='UserStickerPack',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('added_at', models.DateTimeField(default=timezone.now)),
                ('pack', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='saved_by_users', to='chat.stickerpack')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='saved_sticker_packs', to='chat.profile')),
            ],
            options={
                'ordering': ['added_at'],
                'unique_together': {('user', 'pack')},
            },
        ),
        
        # Добавление поля sticker в модель Message
        migrations.AddField(
            model_name='message',
            name='sticker',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='messages', to='chat.sticker'),
        ),
    ]
