from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('chat', '0020_message_edit_delete'),
    ]

    operations = [
        migrations.AddField(
            model_name='soundpack',
            name='creator',
            field=models.ForeignKey(
                blank=True, null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='created_sound_packs',
                to='chat.profile',
            ),
        ),
    ]
