import tempfile

from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from .models import (
    Chat, ChatParticipant, Message, NotificationSound, Profile, SoundPack,
    Sticker, StickerPack, UserSoundPack, UserStickerPack,
)


def make_user(name, password="pass-12345", **profile_kw):
    user = User.objects.create_user(username=name, password=password)
    return Profile.objects.create(user=user, username=name, **profile_kw)


def client_for(profile):
    c = APIClient()
    # Свежий User из базы: у profile.user в кеше висит этот же объект Profile,
    # и вьюхи читали бы request.user.profile в состоянии на момент создания —
    # в бою каждый запрос грузит пользователя заново.
    c.force_authenticate(user=User.objects.get(pk=profile.user_id))
    return c


class RegisterTermsTests(TestCase):
    def test_accept_terms_is_recorded(self):
        r = APIClient().post("/api/auth/register/", {"username": "neo", "password": "pass-12345", "accept_terms": True}, format="json")
        self.assertEqual(r.status_code, 201)
        self.assertIsNotNone(Profile.objects.get(username="neo").terms_accepted_at)

    def test_old_client_without_flag_still_registers(self):
        r = APIClient().post("/api/auth/register/", {"username": "old", "password": "pass-12345"}, format="json")
        self.assertEqual(r.status_code, 201)
        self.assertIsNone(Profile.objects.get(username="old").terms_accepted_at)

    def test_accept_later(self):
        me = make_user("late")
        r = client_for(me).post("/api/account/accept-terms/")
        self.assertEqual(r.status_code, 200)
        self.assertIsNotNone(r.data["terms_accepted_at"])
        first = Profile.objects.get(pk=me.pk).terms_accepted_at
        client_for(me).post("/api/account/accept-terms/")
        self.assertEqual(Profile.objects.get(pk=me.pk).terms_accepted_at, first)


class OwnProfileFieldsTests(TestCase):
    def test_private_settings_only_in_own_profile(self):
        me, other = make_user("me"), make_user("other", allow_adult=True)
        c = client_for(me)
        self.assertIn("allow_adult", c.get("/api/profiles/current/").data)
        self.assertNotIn("allow_adult", c.get(f"/api/profiles/{other.id}/").data)

    def test_toggle_allow_adult(self):
        me = make_user("me")
        r = client_for(me).patch(f"/api/profiles/{me.id}/", {"allow_adult": True}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data["allow_adult"])
        self.assertTrue(Profile.objects.get(pk=me.pk).allow_adult)

    def test_terms_date_is_not_writable(self):
        me = make_user("me")
        client_for(me).patch(f"/api/profiles/{me.id}/", {"terms_accepted_at": "2020-01-01T00:00:00Z"}, format="json")
        self.assertIsNone(Profile.objects.get(pk=me.pk).terms_accepted_at)


@override_settings(MEDIA_ROOT=tempfile.mkdtemp())
class AdultPacksTests(TestCase):
    def setUp(self):
        self.author = make_user("author")
        self.kid = make_user("kid")
        self.adult = make_user("adult", allow_adult=True)
        self.spack = SoundPack.objects.create(name="Грязный", creator=self.author, is_adult=True)
        self.clean = SoundPack.objects.create(name="Чистый", is_default=True)
        # bulk_create обходит save(): там ffmpeg-конверсия, в тестах она не нужна.
        NotificationSound.objects.bulk_create([
            NotificationSound(slug="dirty", name="d", pack=self.spack, file="sounds/d.mp3"),
            NotificationSound(slug="clean", name="c", pack=self.clean, file="sounds/c.mp3"),
        ])
        self.stpack = StickerPack.objects.create(name="18", author=self.author, is_adult=True)
        Sticker.objects.create(pack=self.stpack, file_url="/media/stickers/x.webp", file_name="x.webp")

    def slugs(self, profile):
        return {s["slug"] for s in client_for(profile).get("/api/sounds/").data}

    def test_sound_list_hides_adult_pack_even_if_subscribed(self):
        UserSoundPack.objects.create(user=self.kid, pack=self.spack)
        UserSoundPack.objects.create(user=self.adult, pack=self.spack)
        self.assertEqual(self.slugs(self.kid), {"clean"})
        self.assertEqual(self.slugs(self.adult), {"clean", "dirty"})
        self.assertEqual(self.slugs(self.author), {"clean", "dirty"})

    def test_sound_pack_card_is_locked(self):
        r = client_for(self.kid).get(f"/api/sounds/pack/{self.spack.id}/")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data["adult_locked"])
        self.assertEqual(r.data["sounds"], [])
        self.assertEqual(r.data["sounds_count"], 1)
        r = client_for(self.adult).get(f"/api/sounds/pack/{self.spack.id}/")
        self.assertFalse(r.data["adult_locked"])
        self.assertEqual(len(r.data["sounds"]), 1)

    def test_sound_pack_subscribe(self):
        self.assertEqual(client_for(self.kid).post(f"/api/sounds/pack/{self.spack.id}/subscribe/").status_code, 403)
        self.assertEqual(client_for(self.adult).post(f"/api/sounds/pack/{self.spack.id}/subscribe/").status_code, 200)
        self.assertFalse(UserSoundPack.objects.filter(user=self.kid).exists())

    def test_added_packs_hide_adult(self):
        UserSoundPack.objects.create(user=self.kid, pack=self.spack)
        self.assertEqual(client_for(self.kid).get("/api/sounds/added/").data["packs"], [])

    def test_owner_marks_sound_pack(self):
        pack = SoundPack.objects.create(name="Мой", creator=self.author)
        r = client_for(self.author).patch(f"/api/sounds/pack/{pack.id}/", {"is_adult": True}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(SoundPack.objects.get(pk=pack.pk).is_adult)
        self.assertEqual(client_for(self.kid).patch(f"/api/sounds/pack/{pack.id}/", {"is_adult": False}, format="json").status_code, 403)

    def test_rename_still_works(self):
        r = client_for(self.author).patch(f"/api/sounds/pack/{self.spack.id}/", {"name": "Новое"}, format="json")
        self.assertEqual(r.data["name"], "Новое")
        self.assertTrue(r.data["is_adult"])

    def test_sticker_pack_locked_and_stickers_hidden(self):
        kid = client_for(self.kid)
        self.assertTrue(kid.get(f"/api/sticker-packs/{self.stpack.id}/").data["adult_locked"])
        self.assertEqual(len(kid.get(f"/api/stickers/?pack={self.stpack.id}").data), 0)
        self.assertEqual(kid.post(f"/api/sticker-packs/{self.stpack.id}/save/").status_code, 403)
        self.assertEqual(kid.post("/api/sticker-packs/import/", {"share_code": str(self.stpack.id)}, format="json").status_code, 403)
        adult = client_for(self.adult)
        self.assertFalse(adult.get(f"/api/sticker-packs/{self.stpack.id}/").data["adult_locked"])
        self.assertEqual(len(adult.get(f"/api/stickers/?pack={self.stpack.id}").data), 1)
        self.assertEqual(adult.post(f"/api/sticker-packs/{self.stpack.id}/save/").status_code, 200)

    def test_my_packs_hide_pack_marked_later(self):
        UserStickerPack.objects.create(user=self.kid, pack=self.stpack)
        UserStickerPack.objects.create(user=self.author, pack=self.stpack)
        self.assertEqual(len(client_for(self.kid).get("/api/sticker-packs/my_packs/").data), 0)
        self.assertEqual(len(client_for(self.author).get("/api/sticker-packs/my_packs/").data), 1)

    def test_only_author_edits_sticker_pack(self):
        r = client_for(self.kid).patch(f"/api/sticker-packs/{self.stpack.id}/", {"is_adult": False}, format="json")
        self.assertEqual(r.status_code, 403)
        r = client_for(self.author).patch(f"/api/sticker-packs/{self.stpack.id}/", {"is_adult": False}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertFalse(StickerPack.objects.get(pk=self.stpack.pk).is_adult)


@override_settings(MEDIA_ROOT=tempfile.mkdtemp())
class DeleteAccountTests(TestCase):
    def setUp(self):
        self.me = make_user("me")
        self.friend = make_user("friend")
        self.direct = Chat.objects.create(kind="direct")
        self.group = Chat.objects.create(kind="group", is_group=True, name="G", creator=self.me)
        self.channel = Chat.objects.create(kind="channel", name="C", username="chan", creator=self.me)
        for chat in (self.direct, self.group):
            ChatParticipant.objects.create(chat=chat, user=self.me)
            ChatParticipant.objects.create(chat=chat, user=self.friend)
        ChatParticipant.objects.create(chat=self.channel, user=self.me)
        Message.objects.create(chat=self.group, sender=self.me, content="моё")
        Message.objects.create(chat=self.group, sender=self.friend, content="чужое")
        Message.objects.create(chat=self.direct, sender=self.friend, content="личка")
        pack = SoundPack.objects.create(name="P", creator=self.me)
        NotificationSound.objects.bulk_create([NotificationSound(slug="mine", name="m", pack=pack, file="sounds/m.mp3")])
        bot_user = User.objects.create_user(username="bot1")
        Profile.objects.create(user=bot_user, username="bot1", is_bot=True, bot_owner=self.me)

    def test_wrong_password(self):
        r = client_for(self.me).post("/api/account/delete/", {"password": "nope"}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertTrue(User.objects.filter(username="me").exists())

    def test_superuser_is_protected(self):
        self.me.user.is_superuser = True
        self.me.user.save()
        r = client_for(self.me).post("/api/account/delete/", {"password": "pass-12345"}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertTrue(User.objects.filter(username="me").exists())

    def test_delete_removes_everything_of_mine_only(self):
        r = client_for(self.me).post("/api/account/delete/", {"password": "pass-12345"}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertFalse(User.objects.filter(username="me").exists())
        self.assertFalse(Profile.objects.filter(username="me").exists())
        self.assertFalse(User.objects.filter(username="bot1").exists())
        self.assertFalse(Chat.objects.filter(pk=self.direct.pk).exists())
        self.assertFalse(Chat.objects.filter(pk=self.channel.pk).exists())
        self.assertFalse(SoundPack.objects.filter(name="P").exists())
        self.assertFalse(NotificationSound.objects.filter(slug="mine").exists())
        # группа и чужие сообщения на месте
        self.assertTrue(Chat.objects.filter(pk=self.group.pk).exists())
        self.assertEqual(list(Message.objects.filter(chat=self.group).values_list("content", flat=True)), ["чужое"])
        self.assertTrue(User.objects.filter(username="friend").exists())

    def test_login_fails_after_delete(self):
        client_for(self.me).post("/api/account/delete/", {"password": "pass-12345"}, format="json")
        r = APIClient().post("/api/token/", {"username": "me", "password": "pass-12345"}, format="json")
        self.assertEqual(r.status_code, 401)


def theme_body(**over):
    colors = {k: "#202020" for k in (
        "background", "surface1", "surface2", "surface3", "surface4", "primary", "primaryDeep", "accent",
        "destructive", "success", "online", "amber", "border", "divider", "ring", "accentSoft",
        "bubbleOwn", "bubbleIn", "chatCanvas")}
    colors.update({k: "#FFFFFF" for k in (
        "foreground", "mutedForeground", "subtleForeground", "primaryForeground", "accentForeground",
        "destructiveForeground", "successForeground", "ink", "bubbleOwnFg", "bubbleInFg")})
    body = {
        "name": "Ночная", "base": "dark", "colors": colors,
        "shape": {"style": "flat", "radius": 12, "radiusField": 10, "borderWidth": 1, "shadowOffset": 0,
                  "iconStroke": 1.5, "rowCards": False, "floatingNav": False},
    }
    body.update(over)
    return body


class ThemeTests(TestCase):
    def setUp(self):
        self.author = make_user("author")
        self.fan = make_user("fan")

    def create(self, **over):
        return client_for(self.author).post("/api/themes/", theme_body(**over), format="json")

    def test_create_and_list(self):
        r = self.create()
        self.assertEqual(r.status_code, 201)
        self.assertTrue(r.data["mine"])
        self.assertEqual(r.data["colors"]["background"], "#202020")
        self.assertEqual(len(client_for(self.author).get("/api/themes/").data["themes"]), 1)
        self.assertEqual(client_for(self.fan).get("/api/themes/").data["themes"], [])

    def test_unknown_keys_are_dropped(self):
        body = theme_body()
        body["css"] = "body{display:none}"
        body["colors"]["evil"] = "url(javascript:alert(1))"
        body["shape"]["position"] = "fixed"
        r = client_for(self.author).post("/api/themes/", body, format="json")
        self.assertEqual(r.status_code, 201)
        from .models import Theme
        data = Theme.objects.get(pk=r.data["id"]).data
        self.assertNotIn("css", data)
        self.assertNotIn("evil", data["colors"])
        self.assertNotIn("position", data["shape"])

    def test_rejects_bad_values(self):
        bad_color = theme_body(); bad_color["colors"]["primary"] = "red; background:url(x)"
        bad_radius = theme_body(); bad_radius["shape"]["radius"] = 5000
        bad_flag = theme_body(); bad_flag["shape"]["rowCards"] = "yes"
        missing = theme_body(); del missing["colors"]["ink"]
        for body in (bad_color, bad_radius, bad_flag, missing, theme_body(name="  "), theme_body(base="sepia")):
            self.assertEqual(client_for(self.author).post("/api/themes/", body, format="json").status_code, 400)

    def test_rejects_unreadable_theme(self):
        body = theme_body()
        body["colors"]["foreground"] = "#222222"  # тёмным по тёмному
        r = client_for(self.author).post("/api/themes/", body, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("контраст", r.data["error"])

    def test_install_flow(self):
        tid = self.create().data["id"]
        fan = client_for(self.fan)
        self.assertFalse(fan.get(f"/api/themes/{tid}/").data["installed"])
        self.assertEqual(fan.post(f"/api/themes/{tid}/install/").status_code, 200)
        listed = fan.get("/api/themes/").data["themes"]
        self.assertEqual([t["id"] for t in listed], [tid])
        self.assertTrue(listed[0]["installed"])
        self.assertFalse(listed[0]["mine"])
        self.assertEqual(listed[0]["installs"], 1)
        # активная тема сбрасывается, если тему убрали
        fan.patch(f"/api/profiles/{self.fan.id}/", {"active_theme": tid}, format="json")
        # новый клиент: force_authenticate держит одного User на все запросы, а
        # с ним и закешированный профиль в состоянии до PATCH
        fan = client_for(self.fan)
        fan.delete(f"/api/themes/{tid}/install/")
        self.assertEqual(Profile.objects.get(pk=self.fan.pk).active_theme, "")
        self.assertEqual(fan.get("/api/themes/").data["themes"], [])

    def test_only_author_edits_and_deletes(self):
        tid = self.create().data["id"]
        fan = client_for(self.fan)
        self.assertEqual(fan.patch(f"/api/themes/{tid}/", theme_body(name="Чужая"), format="json").status_code, 403)
        self.assertEqual(fan.delete(f"/api/themes/{tid}/").status_code, 403)
        r = client_for(self.author).patch(f"/api/themes/{tid}/", theme_body(name="Новая"), format="json")
        self.assertEqual(r.data["name"], "Новая")
        self.assertEqual(client_for(self.author).delete(f"/api/themes/{tid}/").status_code, 200)

    def test_private_theme_hidden_from_others(self):
        tid = self.create(is_public=False).data["id"]
        self.assertEqual(client_for(self.fan).get(f"/api/themes/{tid}/").status_code, 404)
        self.assertEqual(client_for(self.fan).post(f"/api/themes/{tid}/install/").status_code, 404)
        self.assertEqual(client_for(self.author).get(f"/api/themes/{tid}/").status_code, 200)

    def test_active_theme_in_own_profile(self):
        c = client_for(self.author)
        self.assertEqual(c.patch(f"/api/profiles/{self.author.id}/", {"active_theme": "neo"}, format="json").status_code, 200)
        self.assertEqual(client_for(self.author).get("/api/profiles/current/").data["active_theme"], "neo")
        self.assertEqual(c.patch(f"/api/profiles/{self.author.id}/", {"active_theme": "<script>"}, format="json").status_code, 400)
        self.assertNotIn("active_theme", client_for(self.fan).get(f"/api/profiles/{self.author.id}/").data)

    def test_theme_survives_author_deletion(self):
        tid = self.create().data["id"]
        client_for(self.fan).post(f"/api/themes/{tid}/install/")
        client_for(self.author).post("/api/account/delete/", {"password": "pass-12345"}, format="json")
        r = client_for(self.fan).get(f"/api/themes/{tid}/")
        self.assertEqual(r.status_code, 200)
        self.assertIsNone(r.data["author"])

    def test_report_theme(self):
        tid = self.create().data["id"]
        r = client_for(self.fan).post("/api/reports/", {"target_type": "theme", "target_id": tid, "reason": "other"}, format="json")
        self.assertIn(r.status_code, (200, 201))


class ChatOrderTests(TestCase):
    """Порядок списка чатов: закреплённые сверху, остальные по последнему
    сообщению. Закрепление личное — у собеседника свой порядок."""

    def setUp(self):
        from django.utils import timezone as tz
        import datetime
        self.me = make_user("me")
        self.a, self.b, self.c = make_user("a"), make_user("b"), make_user("c")
        now = tz.now()
        self.chats = {}
        for i, peer in enumerate((self.a, self.b, self.c)):
            chat = Chat.objects.create(kind="direct")
            ChatParticipant.objects.create(chat=chat, user=self.me)
            ChatParticipant.objects.create(chat=chat, user=peer)
            m = Message.objects.create(chat=chat, sender=peer, content=peer.username)
            # i=0 самый старый, i=2 самый свежий
            Message.objects.filter(pk=m.pk).update(created_at=now - datetime.timedelta(minutes=10 - i * 4))
            self.chats[peer.username] = chat

    def order(self, profile=None):
        r = client_for(profile or self.me).get("/api/chats/")
        self.assertEqual(r.status_code, 200)
        names = []
        for row in r.data:
            other = [p["username"] for p in row["participants"] if p["username"] != (profile or self.me).username]
            names.append(other[0] if other else "?")
        return names

    def test_sorted_by_last_message(self):
        self.assertEqual(self.order(), ["c", "b", "a"])

    def test_new_message_lifts_chat(self):
        Message.objects.create(chat=self.chats["a"], sender=self.a, content="ещё")
        self.assertEqual(self.order()[0], "a")

    def test_pin_moves_to_top_and_is_personal(self):
        c = client_for(self.me)
        self.assertEqual(c.post(f"/api/chats/{self.chats['a'].id}/pin/").status_code, 200)
        self.assertEqual(self.order(), ["a", "c", "b"])
        # у собеседника порядок не изменился: закрепление своё у каждого
        self.assertIsNone(client_for(self.a).get("/api/chats/").data[0]["pinned_at"])

    def test_latest_pin_on_top(self):
        c = client_for(self.me)
        c.post(f"/api/chats/{self.chats['a'].id}/pin/")
        c.post(f"/api/chats/{self.chats['b'].id}/pin/")
        self.assertEqual(self.order(), ["b", "a", "c"])

    def test_unpin_returns_to_time_order(self):
        c = client_for(self.me)
        c.post(f"/api/chats/{self.chats['a'].id}/pin/")
        self.assertEqual(client_for(self.me).delete(f"/api/chats/{self.chats['a'].id}/pin/").status_code, 200)
        self.assertEqual(self.order(), ["c", "b", "a"])
        self.assertTrue(all(row["pinned_at"] is None for row in client_for(self.me).get("/api/chats/").data))

    def test_pin_requires_membership(self):
        other = Chat.objects.create(kind="direct")
        ChatParticipant.objects.create(chat=other, user=self.a)
        self.assertEqual(client_for(self.me).post(f"/api/chats/{other.id}/pin/").status_code, 404)

    def test_last_message_at_in_payload(self):
        row = client_for(self.me).get("/api/chats/").data[0]
        self.assertIsNotNone(row["last_message_at"])


@override_settings(MEDIA_ROOT=tempfile.mkdtemp())
class SoundPackCoverTests(TestCase):
    """Обложка пака звуков: ставит только владелец, без неё клиент рисует свою."""

    def setUp(self):
        self.author = make_user("author")
        self.other = make_user("other")
        self.pack = SoundPack.objects.create(name="Пак", creator=self.author)

    def png(self, name="cover.png"):
        from django.core.files.uploadedfile import SimpleUploadedFile
        # Минимальный валидный PNG: вьюха проверяет расширение и размер.
        blob = (b"\x89PNG\r\n\x1a\n" + b"\x00" * 64)
        return SimpleUploadedFile(name, blob, content_type="image/png")

    def url(self):
        return f"/api/sounds/pack/{self.pack.id}/cover/"

    def test_owner_sets_and_clears_cover(self):
        c = client_for(self.author)
        r = c.post(self.url(), {"file": self.png()}, format="multipart")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data["cover_url"].startswith("/media/packs/"))
        self.assertTrue(SoundPack.objects.get(pk=self.pack.pk).cover_url)
        r = client_for(self.author).delete(self.url())
        self.assertEqual(r.status_code, 200)
        self.assertIsNone(r.data["cover_url"])
        self.assertEqual(SoundPack.objects.get(pk=self.pack.pk).cover_url, "")

    def test_only_owner(self):
        self.assertEqual(client_for(self.other).post(self.url(), {"file": self.png()}, format="multipart").status_code, 403)
        self.assertEqual(client_for(self.other).delete(self.url()).status_code, 403)

    def test_rejects_non_image_and_missing(self):
        c = client_for(self.author)
        from django.core.files.uploadedfile import SimpleUploadedFile
        bad = SimpleUploadedFile("song.mp3", b"\x00" * 16, content_type="audio/mpeg")
        self.assertEqual(c.post(self.url(), {"file": bad}, format="multipart").status_code, 400)
        self.assertEqual(client_for(self.author).post(self.url(), {}, format="multipart").status_code, 400)

    def test_cover_in_pack_payload(self):
        client_for(self.author).post(self.url(), {"file": self.png()}, format="multipart")
        r = client_for(self.other).get(f"/api/sounds/pack/{self.pack.id}/")
        self.assertTrue(r.data["cover_url"].startswith("/media/packs/"))

    def test_replacing_cover_removes_old_file(self):
        import os
        from django.conf import settings
        c = client_for(self.author)
        first = c.post(self.url(), {"file": self.png("a.png")}, format="multipart").data["cover_url"]
        client_for(self.author).post(self.url(), {"file": self.png("b.png")}, format="multipart")
        self.assertFalse(os.path.exists(os.path.join(settings.MEDIA_ROOT, first[len("/media/"):])))


class MessageAroundTests(TestCase):
    """Окно вокруг сообщения: переход к закреплённому одним запросом."""

    def setUp(self):
        import datetime
        from django.utils import timezone as tz
        self.me = make_user("me")
        self.peer = make_user("peer")
        self.chat = Chat.objects.create(kind="direct")
        ChatParticipant.objects.create(chat=self.chat, user=self.me)
        ChatParticipant.objects.create(chat=self.chat, user=self.peer)
        now = tz.now()
        self.msgs = []
        for i in range(200):
            m = Message.objects.create(chat=self.chat, sender=self.peer if i % 2 else self.me, content=f"msg {i}")
            Message.objects.filter(pk=m.pk).update(created_at=now - datetime.timedelta(minutes=200 - i))
            self.msgs.append(m)

    def around(self, msg, limit=50):
        return client_for(self.me).get(f"/api/messages/sync/?chat={self.chat.id}&around={msg.id}&limit={limit}")

    def test_window_centred_on_message(self):
        r = self.around(self.msgs[100])
        self.assertEqual(r.status_code, 200)
        ids = [m["id"] for m in r.data["messages"]]
        self.assertIn(str(self.msgs[100].id), ids)
        self.assertEqual(len(ids), 51)  # 25 до + сама + 25 после
        self.assertEqual(ids[0], str(self.msgs[75].id))
        self.assertEqual(ids[-1], str(self.msgs[125].id))
        self.assertTrue(r.data["has_more"])
        self.assertTrue(r.data["has_newer"])

    def test_window_at_the_very_beginning(self):
        r = self.around(self.msgs[2])
        ids = [m["id"] for m in r.data["messages"]]
        self.assertEqual(ids[0], str(self.msgs[0].id))
        self.assertFalse(r.data["has_more"])
        self.assertTrue(r.data["has_newer"])

    def test_window_at_the_end(self):
        r = self.around(self.msgs[-1])
        ids = [m["id"] for m in r.data["messages"]]
        self.assertEqual(ids[-1], str(self.msgs[-1].id))
        self.assertFalse(r.data["has_newer"])

    def test_unknown_message(self):
        import uuid as _u
        r = client_for(self.me).get(f"/api/messages/sync/?chat={self.chat.id}&around={_u.uuid4()}")
        self.assertEqual(r.status_code, 404)

    def test_stranger_cannot_read_window(self):
        other = make_user("other")
        r = client_for(other).get(f"/api/messages/sync/?chat={self.chat.id}&around={self.msgs[10].id}")
        self.assertEqual(r.status_code, 404)
