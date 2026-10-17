from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('chat', '0106_vibevote_anonymous'),
    ]

    operations = [
        migrations.AddField(
            model_name='profile',
            name='hide_from_search',
            field=models.BooleanField(default=False),
        ),
    ]
