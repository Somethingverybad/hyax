from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('chat', '0021_soundpack_creator'),
    ]

    operations = [
        migrations.AddField(
            model_name='profile',
            name='is_bot',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='profile',
            name='bot_owner',
            field=models.ForeignKey(
                blank=True, null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name='bots',
                to='chat.profile',
            ),
        ),
        migrations.AddField(
            model_name='profile',
            name='bot_token',
            field=models.CharField(blank=True, db_index=True, default='', max_length=64),
        ),
    ]
