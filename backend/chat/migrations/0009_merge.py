# Generated merge migration to resolve conflict between
# 0005_callsession_callparticipant and 0008_profile_bio

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0005_callsession_callparticipant"),
        ("chat", "0008_profile_bio"),
    ]

    operations = []
