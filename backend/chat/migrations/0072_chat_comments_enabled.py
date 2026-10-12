from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0071_wall"),
    ]

    operations = [
        migrations.AddField(model_name="chat", name="comments_enabled", field=models.BooleanField(default=True)),
    ]
