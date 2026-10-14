# -*- coding: utf-8 -*-
from django.db import migrations, models

DATA = [
    ('wink', 'Wink', '{who} winks at {whom}', '윙크하기', '{who}님이 {whom}에게 윙크해요'),
    ('hug', 'Hug', '{who} hugs {whom}', '안아주기', '{who}님이 {whom}을(를) 안아줘요'),
    ('kiss', 'Kiss', '{who} kisses {whom}', '뽀뽀하기', '{who}님이 {whom}에게 뽀뽀해요'),
    ('pat', 'Pat', '{who} pats {whom}', '쓰담쓰담', '{who}님이 {whom}을(를) 쓰담쓰담해요'),
    ('bite', 'Bite', '{who} bites {whom}', '깨물기', '{who}님이 {whom}을(를) 깨물어요'),
    ('kick', 'Kick', '{who} kicks {whom}', '발로 차기', '{who}님이 {whom}을(를) 발로 차요'),
    ('pity', 'Comfort', '{who} feels sorry for {whom}', '토닥이기', '{who}님이 {whom}을(를) 토닥여요'),
    ('tickle', 'Tickle', '{who} tickles {whom}', '간지럽히기', '{who}님이 {whom}을(를) 간지럽혀요'),
    ('highfive', 'High five', '{who} high-fives {whom}', '하이파이브', '{who}님이 {whom}에게 하이파이브해요'),
    ('wave', 'Wave', '{who} waves at {whom}', '손 흔들기', '{who}님이 {whom}에게 손을 흔들어요'),
    ('poke', 'Poke', '{who} pokes {whom}', '콕 찌르기', '{who}님이 {whom}을(를) 콕 찔러요'),
    ('pinch', 'Pinch', '{who} pinches {whom}', '꼬집기', '{who}님이 {whom}을(를) 꼬집어요'),
    ('flower', 'Give a flower', '{who} gives {whom} a flower', '꽃 선물하기', '{who}님이 {whom}에게 꽃을 선물해요'),
    ('tea', 'Pour some tea', '{who} pours {whom} some tea', '차 따라주기', '{who}님이 {whom}에게 차를 따라줘요'),
    ('rays', 'Send good vibes', '{who} sends good vibes to {whom}', '좋은 기운 보내기', '{who}님이 {whom}에게 좋은 기운을 보내요'),
    ('facepalm', 'Facepalm', '{who} facepalms at {whom}', '페이스팜', '{who}님이 {whom} 때문에 이마를 짚어요'),
    ('finger', 'Wag a finger', '{who} wags a finger at {whom}', '손가락 흔들기', '{who}님이 {whom}에게 경고하듯 손가락을 흔들어요'),
    ('spin', 'Twirl at the temple', '{who} twirls a finger at the temple looking at {whom}', '머리 옆 손가락 돌리기', '{who}님이 {whom}을(를) 보며 머리 옆에서 손가락을 돌려요'),
]


def fill(apps, schema_editor):
    ChatAction = apps.get_model("chat", "ChatAction")
    for slug, name_en, phrase_en, name_ko, phrase_ko in DATA:
        ChatAction.objects.filter(slug=slug).update(name_en=name_en, phrase_en=phrase_en, name_ko=name_ko, phrase_ko=phrase_ko)


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0083_transcript_translations"),
    ]

    operations = [
        migrations.AddField(model_name="chataction", name="name_en", field=models.CharField(blank=True, default="", max_length=40)),
        migrations.AddField(model_name="chataction", name="name_ko", field=models.CharField(blank=True, default="", max_length=40)),
        migrations.AddField(model_name="chataction", name="phrase_en", field=models.CharField(blank=True, default="", max_length=120)),
        migrations.AddField(model_name="chataction", name="phrase_ko", field=models.CharField(blank=True, default="", max_length=120)),
        migrations.RunPython(fill, migrations.RunPython.noop),
    ]
