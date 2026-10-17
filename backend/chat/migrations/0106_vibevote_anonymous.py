from django.db import migrations, models


class Migration(migrations.Migration):
    """Флаг «анонимно» у голоса за вайб. Голоса до этой миграции его не хранили,
    поэтому они анонимные (default=True при добавлении поля), новые — как выбрал человек."""

    dependencies = [
        ('chat', '0105_sticker_repaint'),
    ]

    operations = [
        migrations.AddField(
            model_name='vibevote',
            name='anonymous',
            field=models.BooleanField(default=True),
        ),
        migrations.AlterField(
            model_name='vibevote',
            name='anonymous',
            field=models.BooleanField(default=False),
        ),
    ]
