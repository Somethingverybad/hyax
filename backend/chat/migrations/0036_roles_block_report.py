import uuid
import django.db.models.deletion
from django.db import migrations, models
from django.utils import timezone


class Migration(migrations.Migration):

    dependencies = [
        ('chat', '0035_profile_cover_url'),
    ]

    operations = [
        migrations.AddField(
            model_name='profile',
            name='role',
            field=models.CharField(choices=[('user', 'Пользователь'), ('premium', 'Премиум'), ('support', 'Поддержка'), ('admin', 'Администратор')], db_index=True, default='user', max_length=16),
        ),
        migrations.CreateModel(
            name='Block',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('created_at', models.DateTimeField(default=timezone.now)),
                ('blocked', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='blocked_by', to='chat.profile')),
                ('blocker', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='blocks', to='chat.profile')),
            ],
        ),
        migrations.AddIndex(
            model_name='block',
            index=models.Index(fields=['blocker', 'blocked'], name='chat_block_blocker_idx'),
        ),
        migrations.AlterUniqueTogether(
            name='block',
            unique_together={('blocker', 'blocked')},
        ),
        migrations.CreateModel(
            name='Report',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('target_type', models.CharField(choices=[('user', 'Пользователь'), ('message', 'Сообщение'), ('chat', 'Чат или канал'), ('sound_pack', 'Пак звуков'), ('sticker_pack', 'Пак стикеров')], max_length=16)),
                ('target_id', models.CharField(max_length=64)),
                ('reason', models.CharField(choices=[('sexual', 'Сексуальный контент'), ('violence', 'Насилие или угрозы'), ('abuse', 'Оскорбления, травля'), ('spam', 'Спам или мошенничество'), ('illegal', 'Противозаконное'), ('other', 'Другое')], max_length=16)),
                ('comment', models.TextField(blank=True, default='')),
                ('snapshot', models.TextField(blank=True, default='')),
                ('status', models.CharField(choices=[('new', 'Новая'), ('reviewed', 'Рассмотрена'), ('actioned', 'Приняты меры'), ('rejected', 'Отклонена')], db_index=True, default='new', max_length=16)),
                ('created_at', models.DateTimeField(db_index=True, default=timezone.now)),
                ('handled_at', models.DateTimeField(blank=True, null=True)),
                ('moderator_note', models.TextField(blank=True, default='')),
                ('reporter', models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='reports_sent', to='chat.profile')),
                ('target_profile', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='reports_received', to='chat.profile')),
            ],
            options={'ordering': ['-created_at']},
        ),
    ]
