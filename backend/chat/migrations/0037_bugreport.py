import uuid
import django.db.models.deletion
from django.db import migrations, models
from django.utils import timezone


class Migration(migrations.Migration):

    dependencies = [
        ('chat', '0036_roles_block_report'),
    ]

    operations = [
        migrations.CreateModel(
            name='BugReport',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('description', models.TextField(blank=True, default='')),
                ('screenshot_url', models.TextField(blank=True, default='')),
                ('log_url', models.TextField(blank=True, default='')),
                ('meta', models.JSONField(blank=True, default=dict)),
                ('status', models.CharField(choices=[('new', 'Новый'), ('seen', 'Просмотрен'), ('fixed', 'Исправлен'), ('wontfix', 'Не будем')], db_index=True, default='new', max_length=16)),
                ('created_at', models.DateTimeField(db_index=True, default=timezone.now)),
                ('reporter', models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='bug_reports', to='chat.profile')),
            ],
            options={'ordering': ['-created_at']},
        ),
    ]
