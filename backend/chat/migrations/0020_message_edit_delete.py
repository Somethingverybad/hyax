from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("chat", "0019_message_video_mirror")]
    operations = [
        migrations.AddField(model_name="message", name="is_edited", field=models.BooleanField(default=False)),
        migrations.AddField(model_name="message", name="deleted_for_all", field=models.BooleanField(default=False)),
        migrations.AddField(model_name="message", name="deleted_for", field=models.ManyToManyField(blank=True, related_name="hidden_messages", to="chat.profile")),
    ]
