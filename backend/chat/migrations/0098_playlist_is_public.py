from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0097_chataction_ru_person_forms"),
    ]

    operations = [
        migrations.AddField(
            model_name="playlist",
            name="is_public",
            field=models.BooleanField(default=False),
        ),
    ]
