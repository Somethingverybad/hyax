from datetime import timedelta

import django.db.models.deletion
from django.db import migrations, models


def link_existing_ideas(apps, schema_editor):
    """Идеи, пересланные до этой миграции, связываем с сообщениями авторов —
    иначе на них не ответить. Копия в «Идеях» создаётся сразу после оригинала:
    тот же автор, то же содержимое, оригинал чуть раньше."""
    Chat = apps.get_model("chat", "Chat")
    Message = apps.get_model("chat", "Message")
    ideas = Chat.objects.filter(kind="system", name="Идеи").first()
    if not ideas:
        return
    copies = Message.objects.filter(chat=ideas, forwarded_from__isnull=False, origin_message__isnull=True)
    for copy in copies.iterator():
        match = {}
        for f in ("content", "file_url", "voice_url", "video_url"):
            v = getattr(copy, f)
            match[f + "__isnull" if v is None else f] = True if v is None else v
        orig = (Message.objects
                .filter(chat__kind="ideabox", sender_id=copy.forwarded_from_id,
                        created_at__gte=copy.created_at - timedelta(minutes=2), created_at__lte=copy.created_at, **match)
                .order_by("-created_at").first())
        if orig:
            Message.objects.filter(id=copy.id).update(origin_message=orig)


class Migration(migrations.Migration):

    dependencies = [
        ('chat', '0103_profile_obs_key'),
    ]

    operations = [
        migrations.AddField(
            model_name='message',
            name='origin_message',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to='chat.message'),
        ),
        migrations.RunPython(link_existing_ideas, migrations.RunPython.noop),
    ]
