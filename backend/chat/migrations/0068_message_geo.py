from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('chat', '0067_vibe_ideas'),
    ]

    operations = [
        migrations.AddField(model_name='message', name='geo_lat', field=models.FloatField(blank=True, null=True)),
        migrations.AddField(model_name='message', name='geo_lng', field=models.FloatField(blank=True, null=True)),
    ]
