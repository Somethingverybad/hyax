from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('chat', '0028_musictrack'),
    ]

    operations = [
        migrations.AddField(
            model_name='message',
            name='voice_transcript',
            field=models.TextField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='message',
            name='transcript_status',
            field=models.CharField(blank=True, default='', max_length=10),
        ),
    ]
