from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('chat', '0061_message_entities'),
    ]

    operations = [
        migrations.CreateModel(
            name='MetricSample',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('ts', models.DateTimeField(db_index=True)),
                ('online', models.PositiveIntegerField(default=0)),
                ('connected', models.PositiveIntegerField(default=0)),
                ('sockets', models.PositiveIntegerField(default=0)),
                ('cpu', models.FloatField(blank=True, null=True)),
                ('mem', models.FloatField(blank=True, null=True)),
                ('load1', models.FloatField(blank=True, null=True)),
            ],
            options={'ordering': ['ts']},
        ),
    ]
