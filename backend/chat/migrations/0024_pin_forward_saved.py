from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0023_channels"),
    ]

    operations = [
        migrations.AddField(
            model_name="chat",
            name="pinned_message",
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                related_name="+", to="chat.message",
            ),
        ),
        migrations.AddField(
            model_name="message",
            name="forwarded_from",
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                related_name="+", to="chat.profile",
            ),
        ),
        migrations.AddField(
            model_name="message",
            name="forwarded_title",
            field=models.CharField(blank=True, default="", max_length=120),
        ),
    ]
