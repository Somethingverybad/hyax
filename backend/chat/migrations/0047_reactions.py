from django.db import migrations, models


class Migration(migrations.Migration):
    """Реакции на сообщения: несколько разных от одного человека.

    Уникальность была по паре post+user (одна реакция на пост канала) — стала
    по тройке с value. Сколько разных можно поставить, решает
    Profile.reaction_limit: поле, а не константа, чтобы «премиум» был просто
    другим числом.
    """

    dependencies = [
        ('chat', '0046_saved_visibility'),
    ]

    operations = [
        migrations.AddField(
            model_name='profile',
            name='reaction_limit',
            field=models.PositiveSmallIntegerField(default=3),
        ),
        migrations.AlterUniqueTogether(
            name='postreaction',
            unique_together={('post', 'user', 'value')},
        ),
        migrations.AddIndex(
            model_name='postreaction',
            index=models.Index(fields=['post'], name='chat_reaction_post_idx'),
        ),
    ]
