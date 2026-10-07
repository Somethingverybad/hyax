import django.db.models.deletion
import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('chat', '0063_profile_aura'),
    ]

    operations = [
        migrations.AddField(model_name='message', name='cipher', field=models.TextField(blank=True, null=True)),
        migrations.CreateModel(
            name='SecretChat',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('initiator_device', models.CharField(max_length=64)),
                ('initiator_pub', models.TextField()),
                ('responder_device', models.CharField(blank=True, default='', max_length=64)),
                ('responder_pub', models.TextField(blank=True, default='')),
                ('state', models.CharField(default='pending', max_length=10)),
                ('created_at', models.DateTimeField(default=django.utils.timezone.now)),
                ('accepted_at', models.DateTimeField(blank=True, null=True)),
                ('chat', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='secret', to='chat.chat')),
                ('initiator', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='+', to='chat.profile')),
            ],
        ),
    ]
