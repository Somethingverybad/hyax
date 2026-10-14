from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0082_translate_defaults"),
    ]

    operations = [
        migrations.AddField(model_name="message", name="transcript_lang", field=models.CharField(blank=True, default="", max_length=8)),
        migrations.AddField(model_name="message", name="transcript_translations", field=models.JSONField(blank=True, default=dict)),
    ]
