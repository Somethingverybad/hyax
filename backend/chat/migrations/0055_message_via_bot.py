from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    """Inline-боты: сообщение «через @бота»."""

    dependencies = [
        ('chat', '0054_message_forwarded_chat'),
    ]

    operations = [
        migrations.AddField(model_name='message', name='via_bot', field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to='chat.profile')),
    ]
