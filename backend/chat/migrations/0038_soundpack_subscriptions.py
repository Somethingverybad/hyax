import uuid
import django.db.models.deletion
from django.db import migrations, models
from django.utils import timezone


class Migration(migrations.Migration):

    dependencies = [
        ('chat', '0037_bugreport'),
    ]

    operations = [
        migrations.AddField(
            model_name='soundpack',
            name='is_public',
            field=models.BooleanField(default=True),
        ),
        migrations.CreateModel(
            name='UserSoundPack',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('added_at', models.DateTimeField(default=timezone.now)),
                ('pack', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='added_by_users', to='chat.soundpack')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='added_sound_packs', to='chat.profile')),
            ],
            options={'ordering': ['added_at'], 'unique_together': {('user', 'pack')}},
        ),
    ]
