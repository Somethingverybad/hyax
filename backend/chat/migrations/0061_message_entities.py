from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('chat', '0060_profile_readonly_bot'),
    ]

    operations = [
        migrations.AddField(
            model_name='message',
            name='entities',
            field=models.JSONField(blank=True, default=list),
        ),
    ]
