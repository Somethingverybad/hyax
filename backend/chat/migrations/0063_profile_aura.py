from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('chat', '0062_metricsample'),
    ]

    operations = [
        migrations.AddField(model_name='profile', name='aura_color', field=models.CharField(blank=True, default='', max_length=7)),
        migrations.AddField(model_name='profile', name='aura_text', field=models.CharField(blank=True, default='', max_length=60)),
        migrations.AddField(model_name='profile', name='aura_presets', field=models.JSONField(blank=True, default=list)),
    ]
