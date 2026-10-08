from django.db import migrations, models


def seed(apps, schema_editor):
    Level = apps.get_model('chat', 'VibeLevel')
    Config = apps.get_model('chat', 'VibeConfig')
    Config.objects.get_or_create(pk=1, defaults={'bar_length': 10})
    for v, name, color in ((10, 'Бронза', '#cd7f32'), (20, 'Серебро', '#c0c7cf'), (30, 'Золото', '#f2c14e')):
        Level.objects.get_or_create(min_vibe=v, defaults={'name': name, 'color': color, 'glow': True})


class Migration(migrations.Migration):

    dependencies = [
        ('chat', '0068_message_geo'),
    ]

    operations = [
        migrations.CreateModel(
            name='VibeLevel',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('min_vibe', models.IntegerField(unique=True)),
                ('name', models.CharField(max_length=40)),
                ('color', models.CharField(default='#cd7f32', max_length=9)),
                ('glow', models.BooleanField(default=True)),
            ],
            options={'ordering': ['min_vibe']},
        ),
        migrations.CreateModel(
            name='VibeConfig',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('bar_length', models.PositiveIntegerField(default=10)),
            ],
        ),
        migrations.RunPython(seed, migrations.RunPython.noop),
    ]
