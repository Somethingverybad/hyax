from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('chat', '0008_profile_bio'),
    ]

    operations = [
        migrations.AddField(
            model_name='profile',
            name='call_status',
            field=models.CharField(default='idle', max_length=20),
        ),
    ]
