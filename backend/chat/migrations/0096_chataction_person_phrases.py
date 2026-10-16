from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0095_chataction_adult"),
    ]

    operations = [
        migrations.AddField(model_name="chataction", name=f, field=models.CharField(blank=True, default="", max_length=120))
        for f in ("phrase_ru_self", "phrase_ru_you", "phrase_en_self", "phrase_en_you", "phrase_ko_self", "phrase_ko_you")
    ]
