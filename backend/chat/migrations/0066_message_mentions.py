from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('chat', '0065_message_transcript_for'),
    ]

    operations = [
        migrations.AddField(
            model_name='message',
            name='mentions',
            field=models.JSONField(blank=True, default=list),
        ),
    ]
