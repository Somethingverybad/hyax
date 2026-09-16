from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('chat', '0034_profile_rov_enabled'),
    ]

    operations = [
        migrations.AddField(
            model_name='profile',
            name='cover_url',
            field=models.TextField(blank=True, null=True),
        ),
    ]
