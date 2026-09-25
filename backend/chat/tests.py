import tempfile

from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from .models import (
    Chat, ChatParticipant, Message, MessageReadStatus, NotificationSound, Playlist, PlaylistTrack,
    PostReaction, Profile, SavedImage, SoundPack, Sticker, StickerPack,
    UserSoundPack, UserStickerPack,
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


@override_settings(MEDIA_ROOT=tempfile.mkdtemp(), CHUNK_UPLOAD_SYNC=True)
class ChunkUploadTests(TestCase):
    """Загрузка файла кусками: большое видео не проходит через CDN одним
    запросом, поэтому режется на части и склеивается на сервере."""

    def setUp(self):
        self.me = make_user("uploader")
        self.c = client_for(self.me)

    def send(self, upload_id, index, total, blob, **extra):
        from django.core.files.uploadedfile import SimpleUploadedFile
        data = {"upload_id": upload_id, "index": index, "total": total,
                "chunk": SimpleUploadedFile("part", blob, content_type="application/octet-stream")}
        data.update(extra)
        return client_for(self.me).post("/api/upload/chunk/", data, format="multipart")

    def test_assembles_file_from_chunks(self):
        import os, uuid as _u
        from django.conf import settings
        uid = _u.uuid4().hex
        parts = [b"a" * 1024, b"b" * 1024, b"c" * 7]
        for i, p in enumerate(parts[:-1]):
            r = self.send(uid, i, 3, p)
            self.assertEqual(r.status_code, 200)
            self.assertEqual(r.data["received"], i)
        r = self.send(uid, 2, 3, parts[-1], file_name="клип.mp4", local="1")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["file_name"], "клип.mp4")
        self.assertEqual(r.data["file_size"], sum(len(p) for p in parts))
        path = os.path.join(settings.MEDIA_ROOT, r.data["file_url"][len("/media/"):])
        self.assertEqual(open(path, "rb").read(), b"".join(parts))
        # временные куски убраны
        self.assertFalse(os.path.exists(os.path.join(settings.MEDIA_ROOT, "chunks", uid)))

    def test_missing_chunk_reported(self):
        import uuid as _u
        uid = _u.uuid4().hex
        self.send(uid, 0, 3, b"a" * 16)
        r = self.send(uid, 2, 3, b"c" * 16, file_name="x.bin", local="1")
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.data["missing"], [1])

    def test_rejects_bad_upload_id_and_index(self):
        import uuid as _u
        self.assertEqual(self.send("../etc", 0, 1, b"x", file_name="a.bin").status_code, 400)
        self.assertEqual(self.send(_u.uuid4().hex, 5, 3, b"x", file_name="a.bin").status_code, 400)
        r = client_for(self.me).post("/api/upload/chunk/", {"upload_id": _u.uuid4().hex, "index": 0, "total": 1}, format="multipart")
        self.assertEqual(r.status_code, 400)

    def test_requires_auth(self):
        import uuid as _u
        from django.core.files.uploadedfile import SimpleUploadedFile
        r = APIClient().post("/api/upload/chunk/", {"upload_id": _u.uuid4().hex, "index": 0, "total": 1,
                                                    "chunk": SimpleUploadedFile("p", b"x")}, format="multipart")
        self.assertIn(r.status_code, (401, 403))

    def test_single_request_upload_still_works(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        r = self.c.post("/api/upload/", {"file": SimpleUploadedFile("pic.png", b"\x89PNG" + b"\x00" * 32, content_type="image/png"), "local": "1"}, format="multipart")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data["file_url"].startswith("/media/messages/"))


@override_settings(MEDIA_ROOT=tempfile.mkdtemp(), CHUNK_UPLOAD_SYNC=True)
class ChunkUploadRetryTests(TestCase):
    """Повтор последнего куска после успешной сборки: сервер склеил файл, а
    ответ до телефона не дошёл. Раньше повтор получал 409 «не все куски дошли»."""

    def test_retry_of_last_chunk_returns_same_result(self):
        import uuid as _u
        from django.core.files.uploadedfile import SimpleUploadedFile
        me = make_user("retrier")
        uid = _u.uuid4().hex
        def send(i, blob, **extra):
            data = {"upload_id": uid, "index": i, "total": 2, "chunk": SimpleUploadedFile("p", blob)}
            data.update(extra)
            return client_for(me).post("/api/upload/chunk/", data, format="multipart")
        send(0, b"a" * 64)
        first = send(1, b"b" * 32, file_name="клип.mp4", local="1")
        self.assertEqual(first.status_code, 200)
        again = send(1, b"b" * 32, file_name="клип.mp4", local="1")
        self.assertEqual(again.status_code, 200)
        self.assertEqual(again.data["file_url"], first.data["file_url"])
        self.assertEqual(again.data["file_size"], 96)



@override_settings(MEDIA_ROOT=tempfile.mkdtemp())
class ChunkUploadBackgroundTests(TestCase):
    """Последний кусок отвечает сразу, обработка идёт в фоне, итог — опросом.
    Повтор последнего куска во время обработки не даёт «не все куски дошли»."""

    def test_processing_then_done(self):
        import time, uuid as _u
        from django.core.files.uploadedfile import SimpleUploadedFile
        me = make_user("bg")
        uid = _u.uuid4().hex
        def send(i, blob, **extra):
            data = {"upload_id": uid, "index": i, "total": 2, "chunk": SimpleUploadedFile("p", blob)}
            data.update(extra)
            return client_for(me).post("/api/upload/chunk/", data, format="multipart")
        send(0, b"a" * 64)
        r = send(1, b"b" * 32, file_name="v.bin", local="1")
        self.assertIn(r.status_code, (200, 202))
        # повтор последнего куска сразу после — не 409
        again = send(1, b"b" * 32, file_name="v.bin", local="1")
        self.assertIn(again.status_code, (200, 202))
        # опрашиваем, пока фон не закончит
        for _ in range(50):
            st = client_for(me).get(f"/api/upload/chunk/{uid}/")
            if st.status_code == 200:
                break
            time.sleep(0.05)
        self.assertEqual(st.status_code, 200)
        self.assertEqual(st.data["file_size"], 96)

    def test_unknown_upload_status(self):
        import uuid as _u
        me = make_user("bg2")
        self.assertEqual(client_for(me).get(f"/api/upload/chunk/{_u.uuid4().hex}/").status_code, 404)
        self.assertEqual(client_for(me).get("/api/upload/chunk/not-a-hex-id/").status_code, 400)


class UsernameCaseTests(TestCase):
    """Ники, различающиеся только регистром: ссылка ведёт в точный профиль,
    новые такие пары не заводятся."""

    def setUp(self):
        self.big = make_user("EvilTree")
        self.small = make_user("eviltree")
        self.viewer = make_user("viewer")

    def test_link_opens_exact_profile(self):
        c = client_for(self.viewer)
        self.assertEqual(c.get("/api/profiles/by-username/EvilTree/").data["id"], str(self.big.id))
        self.assertEqual(c.get("/api/profiles/by-username/eviltree/").data["id"], str(self.small.id))

    def test_ambiguous_case_insensitive_is_not_guessed(self):
        r = client_for(self.viewer).get("/api/profiles/by-username/EVILTREE/")
        self.assertEqual(r.status_code, 404)

    def test_unique_case_insensitive_still_found(self):
        make_user("Solo")
        r = client_for(self.viewer).get("/api/profiles/by-username/solo/")
        self.assertEqual(r.status_code, 200)

    def test_search_prefers_exact(self):
        r = client_for(self.viewer).get("/api/profiles/?search=EvilTree")
        rows = r.data["results"] if isinstance(r.data, dict) else r.data
        self.assertEqual([x["id"] for x in rows], [str(self.big.id)])

    def test_register_rejects_case_duplicate(self):
        r = APIClient().post("/api/auth/register/", {"username": "EVILTREE", "password": "pass-12345", "accept_terms": True}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_rename_rejects_case_duplicate(self):
        r = client_for(self.viewer).patch(f"/api/profiles/{self.viewer.id}/", {"username": "EVILtree"}, format="json")
        self.assertEqual(r.status_code, 400)
        # свой же ник в другом регистре — можно
        r = client_for(self.big).patch(f"/api/profiles/{self.big.id}/", {"username": "Eviltree_X"}, format="json")
        self.assertEqual(r.status_code, 200)


class PresenceTests(TestCase):
    """«В сети» / «не в сети» / «Скрыт»: что видят собеседники."""

    def setUp(self):
        from . import presence
        presence._conns.clear()
        self.presence = presence
        self.me = make_user("me")
        self.friend = make_user("friend")
        self.stranger = make_user("stranger")
        direct = Chat.objects.create(kind="direct")
        group = Chat.objects.create(kind="group", is_group=True, name="G", creator=self.me)
        for chat, people in ((direct, (self.me, self.friend)), (group, (self.me, self.stranger))):
            for p in people:
                ChatParticipant.objects.create(chat=chat, user=p)

    def tearDown(self):
        self.presence._conns.clear()

    def friend_sees_me(self):
        chats = client_for(self.friend).get("/api/chats/").data
        chats = chats.get("results", chats) if isinstance(chats, dict) else chats
        people = [p for c in chats for p in c["participants"] if p["id"] == str(self.me.id)]
        return people[0]["is_online"]

    def test_transitions(self):
        p = self.presence
        self.assertTrue(p.conn_open("a", self.me.id))
        self.assertFalse(p.conn_open("b", self.me.id))      # второе устройство — уже в сети
        self.assertFalse(p.conn_active("a", self.me.id, False))
        self.assertTrue(p.conn_active("b", self.me.id, False))  # свернул везде — не в сети
        self.assertTrue(p.conn_active("a", self.me.id, True))
        self.assertTrue(p.conn_close("a", self.me.id))

    def test_stale_connection_is_offline(self):
        self.presence.conn_open("a", self.me.id)
        ch, (pid, act, ts) = next(iter(self.presence._conns.items()))
        self.presence._conns[ch] = (pid, act, ts - self.presence.STALE - 1)
        self.assertFalse(self.presence.is_active(self.me.id))

    def test_chat_list_shows_online(self):
        self.assertFalse(self.friend_sees_me())
        self.presence.conn_open("a", self.me.id)
        self.assertTrue(self.friend_sees_me())

    def test_hidden_looks_offline(self):
        self.presence.conn_open("a", self.me.id)
        r = client_for(self.me).patch(f"/api/profiles/{self.me.id}/", {"hide_online": True}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data["hide_online"])
        self.assertFalse(self.friend_sees_me())

    def test_hidden_flag_is_private(self):
        self.me.hide_online = True
        self.me.save()
        r = client_for(self.friend).get(f"/api/profiles/{self.me.id}/")
        self.assertNotIn("hide_online", r.data)

    def test_last_seen_shown_and_hidden(self):
        """Время последнего входа: видно, пока не выключено и не скрыт статус."""
        from django.utils import timezone
        from chat.presence import shown_last_seen
        self.me.last_seen = timezone.now()
        self.me.save()
        self.assertIsNotNone(shown_last_seen(self.me))

        self.me.show_last_seen = False
        self.me.save()
        self.assertIsNone(shown_last_seen(self.me), "выключено — не показываем")

        self.me.show_last_seen = True
        self.me.hide_online = True
        self.me.save()
        self.assertIsNone(shown_last_seen(self.me), "«Скрыт» прячет и время")

    def test_last_seen_in_chat_list(self):
        from django.utils import timezone
        self.me.last_seen = timezone.now()
        self.me.save()
        chats = client_for(self.friend).get("/api/chats/").data
        chats = chats.get("results", chats) if isinstance(chats, dict) else chats
        row = [p for c in chats for p in c["participants"] if p["id"] == str(self.me.id)][0]
        self.assertIsNotNone(row["last_seen"])

    def test_show_last_seen_is_private(self):
        r = client_for(self.friend).get(f"/api/profiles/{self.me.id}/")
        self.assertNotIn("show_last_seen", r.data)

    def test_peers_are_direct_chats_only(self):
        self.assertEqual(self.presence.presence_peers(self.me.id), [str(self.friend.id)])


class SavedVisibilityTests(TestCase):
    """Сохранёнки: видны всем, избранным или никому — и в профиле, и по ссылке
    на сам файл."""

    def setUp(self):
        self.me = make_user("keeper")
        self.friend = make_user("friend")
        self.stranger = make_user("stranger")
        chat = Chat.objects.create(kind="direct")
        for p in (self.me, self.friend):
            ChatParticipant.objects.create(chat=chat, user=p)
        msg = Message.objects.create(chat=chat, sender=self.friend,
                                     content="", file_url="s3://media/pic.jpg", file_name="pic.jpg")
        self.item = SavedImage.objects.create(owner=self.me, file_url=msg.file_url,
                                              file_name="pic.jpg", source_message=msg)

    def seen_by(self, who):
        r = client_for(who).get(f"/api/saved-images/?profile={self.me.id}")
        return r.data["count"]

    def set_mode(self, mode):
        r = client_for(self.me).patch(f"/api/profiles/{self.me.id}/", {"saved_visibility": mode}, format="json")
        self.assertEqual(r.status_code, 200, r.data)

    def test_default_is_visible_to_everyone(self):
        self.assertEqual(self.seen_by(self.stranger), 1)

    def test_none_hides_from_everyone_but_owner(self):
        self.set_mode("none")
        self.assertEqual(self.seen_by(self.stranger), 0)
        self.assertEqual(self.seen_by(self.friend), 0)
        self.assertEqual(self.seen_by(self.me), 1)

    def test_selected_shows_only_to_listed(self):
        self.set_mode("selected")
        self.assertEqual(self.seen_by(self.friend), 0)
        c = client_for(self.me)
        self.assertEqual(c.post("/api/saved-viewers/", {"profile_id": str(self.friend.id)}, format="json").status_code, 200)
        self.assertEqual(self.seen_by(self.friend), 1)
        self.assertEqual(self.seen_by(self.stranger), 0)
        self.assertEqual([v["username"] for v in c.get("/api/saved-viewers/").data["viewers"]], ["friend"])
        c.delete("/api/saved-viewers/", {"profile_id": str(self.friend.id)}, format="json")
        self.assertEqual(self.seen_by(self.friend), 0)

    def test_public_card_tells_whether_saved_are_visible(self):
        self.set_mode("none")
        r = client_for(self.stranger).get(f"/api/profiles/by-username/{self.me.username}/")
        self.assertFalse(r.data["saved_visible"])
        self.set_mode("all")
        r = client_for(self.stranger).get(f"/api/profiles/by-username/{self.me.username}/")
        self.assertTrue(r.data["saved_visible"])

    def test_visibility_is_private_to_owner(self):
        r = client_for(self.stranger).get(f"/api/profiles/{self.me.id}/")
        self.assertNotIn("saved_visibility", r.data)

    def test_cannot_add_viewers_for_someone_else(self):
        r = client_for(self.stranger).patch(f"/api/profiles/{self.me.id}/", {"saved_visibility": "none"}, format="json")
        self.assertEqual(r.status_code, 403)



class ReactionTests(TestCase):
    """Реакции: переключение, предел на человека, закрытый набор эмодзи."""

    def setUp(self):
        self.me = make_user("me")
        self.friend = make_user("friend")
        self.stranger = make_user("stranger")
        self.chat = Chat.objects.create(kind="direct")
        for p in (self.me, self.friend):
            ChatParticipant.objects.create(chat=self.chat, user=p)
        self.msg = Message.objects.create(chat=self.chat, sender=self.friend, content="привет")

    def react(self, who, emoji):
        return client_for(who).post(f"/api/messages/{self.msg.id}/react/", {"emoji": emoji}, format="json")

    def summary(self, who):
        r = client_for(who).get(f"/api/messages/?chat={self.chat.id}")
        rows = r.data.get("results", r.data) if isinstance(r.data, dict) else r.data
        return next(m["reactions"] for m in rows if m["id"] == str(self.msg.id))

    def test_put_and_remove(self):
        r = self.react(self.me, "❤️")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["reactions"], [{"emoji": "❤️", "count": 1, "mine": True}])
        # повторное нажатие снимает
        self.assertEqual(self.react(self.me, "❤️").data["reactions"], [])

    def test_counts_and_mine(self):
        self.react(self.me, "❤️")
        self.react(self.friend, "❤️")
        self.react(self.friend, "🔥")
        mine = {x["emoji"]: x for x in self.summary(self.me)}
        self.assertEqual(mine["❤️"]["count"], 2)
        self.assertTrue(mine["❤️"]["mine"])
        self.assertFalse(mine["🔥"]["mine"])

    def test_limit_three_per_person(self):
        for e in ("❤️", "🔥", "👍"):
            self.assertEqual(self.react(self.me, e).status_code, 200)
        r = self.react(self.me, "🎉")
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.data["limit"], 3)
        # предел — поле профиля: поднимаем, и четвёртая проходит
        self.me.reaction_limit = 5
        self.me.save()
        self.assertEqual(self.react(self.me, "🎉").status_code, 200)

    def test_unknown_emoji_rejected(self):
        for bad in ("🍆", "не эмодзи", ""):
            self.assertEqual(self.react(self.me, bad).status_code, 400)
        self.assertEqual(PostReaction.objects.count(), 0)

    def test_outsider_cannot_react(self):
        self.assertEqual(self.react(self.stranger, "❤️").status_code, 403)

    def test_sync_brings_reactions(self):
        """Реакция доезжает обычной синхронизацией: у кого чат был закрыт,
        событие он пропустил, а лента открывается из кеша."""
        from django.utils import timezone
        mark = timezone.now().isoformat()
        self.react(self.friend, "🔥")
        r = client_for(self.me).get(f"/api/messages/sync/?chat={self.chat.id}&since={mark}")
        ids = [m["id"] for m in r.data["messages"]]
        self.assertIn(str(self.msg.id), ids, "сообщение не попало в приращение")
        row = next(m for m in r.data["messages"] if m["id"] == str(self.msg.id))
        self.assertEqual([x["emoji"] for x in row["reactions"]], ["🔥"])

    def test_order_follows_tile_sheet(self):
        for e in ("🔥", "❤️", "👍"):
            self.react(self.me if e == "🔥" else self.friend, e)
        self.assertEqual([x["emoji"] for x in self.summary(self.me)], ["❤️", "👍", "🔥"])



class PlaylistTests(TestCase):
    """Плейлисты: «Моя музыка» заводится сама, музыка добавляется из сообщений."""

    def setUp(self):
        self.me = make_user("me")
        self.friend = make_user("friend")
        self.stranger = make_user("stranger")
        self.chat = Chat.objects.create(kind="direct")
        for p in (self.me, self.friend):
            ChatParticipant.objects.create(chat=self.chat, user=p)
        self.song = Message.objects.create(chat=self.chat, sender=self.friend, content="",
                                           file_url="s3://media/track.mp3", file_name="Дом культуры.mp3")
        self.doc = Message.objects.create(chat=self.chat, sender=self.friend, content="",
                                          file_url="s3://media/doc.pdf", file_name="Договор.pdf")

    def add(self, who, msg, playlist=None):
        url = f"/api/playlists/{playlist}/tracks/" if playlist else "/api/playlists/tracks/"
        return client_for(who).post(url, {"message_id": str(msg.id)}, format="json")

    def test_default_playlist_appears_empty(self):
        r = client_for(self.me).get("/api/playlists/")
        self.assertEqual(len(r.data["playlists"]), 1)
        self.assertEqual(r.data["playlists"][0]["name"], "Моя музыка")
        self.assertTrue(r.data["playlists"][0]["is_default"])
        self.assertEqual(r.data["playlists"][0]["tracks_count"], 0)

    def test_add_music_from_message(self):
        r = self.add(self.me, self.song)
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.data["track"]["title"], "Дом культуры")
        pl = Playlist.objects.get(owner=self.me, is_default=True)
        self.assertEqual(pl.tracks.count(), 1)
        # повторное добавление не плодит дубли
        self.assertEqual(self.add(self.me, self.song).data["already"], True)
        self.assertEqual(pl.tracks.count(), 1)

    def test_only_audio(self):
        self.assertEqual(self.add(self.me, self.doc).status_code, 400)

    def test_outsider_cannot_add(self):
        self.assertEqual(self.add(self.stranger, self.song).status_code, 403)

    def test_track_survives_message_deletion(self):
        self.add(self.me, self.song)
        self.song.delete()
        track = PlaylistTrack.objects.get(playlist__owner=self.me)
        self.assertIsNone(track.source)
        self.assertEqual(track.file_url, "s3://media/track.mp3")

    def test_create_rename_and_delete(self):
        c = client_for(self.me)
        made = c.post("/api/playlists/", {"name": "Для бега"}, format="json")
        self.assertEqual(made.status_code, 201)
        pid = made.data["id"]
        self.assertEqual(c.patch(f"/api/playlists/{pid}/", {"name": "Бег"}, format="json").data["name"], "Бег")
        self.assertEqual(c.delete(f"/api/playlists/{pid}/").status_code, 204)
        # «Моя музыка» не удаляется
        default = Playlist.objects.get(owner=self.me, is_default=True)
        self.assertEqual(c.delete(f"/api/playlists/{default.id}/").status_code, 400)

    def test_playlists_are_private(self):
        made = client_for(self.me).post("/api/playlists/", {"name": "Моё"}, format="json")
        r = client_for(self.friend).get(f"/api/playlists/{made.data['id']}/")
        self.assertEqual(r.status_code, 404)

    def test_remove_track(self):
        added = self.add(self.me, self.song)
        pl = Playlist.objects.get(owner=self.me, is_default=True)
        r = client_for(self.me).delete(f"/api/playlists/{pl.id}/tracks/{added.data['track']['id']}/")
        self.assertEqual(r.status_code, 204)
        self.assertEqual(pl.tracks.count(), 0)



class ButtonTests(TestCase):
    """Кнопки под сообщением: ставит только бот, нажать может участник."""

    def setUp(self):
        self.me = make_user("me")
        self.stranger = make_user("stranger")
        bot_user = User.objects.create_user(username="botty")
        self.bot = Profile.objects.create(user=bot_user, username="botty", is_bot=True,
                                          bot_owner=self.me, bot_token="tok-123")
        self.chat = Chat.objects.create(kind="direct")
        for p in (self.me, self.bot):
            ChatParticipant.objects.create(chat=self.chat, user=p)
        self.rows = [[{"text": "Первый", "data": "pick:1"}, {"text": "Второй", "data": "pick:2"}]]

    def bot_client(self):
        c = APIClient()
        c.credentials(HTTP_AUTHORIZATION="Bot tok-123")
        return c

    def test_bot_sends_buttons(self):
        r = self.bot_client().post("/api/messages/",
                                   {"chat": str(self.chat.id), "content": "Выберите", "buttons": self.rows},
                                   format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data["buttons"], self.rows)

    def test_person_cannot_fake_buttons(self):
        r = client_for(self.me).post("/api/messages/",
                                     {"chat": str(self.chat.id), "content": "я бот", "buttons": self.rows},
                                     format="json")
        self.assertEqual(r.status_code, 400)

    def test_press_known_button(self):
        msg = self.bot_client().post("/api/messages/",
                                     {"chat": str(self.chat.id), "content": "Выберите", "buttons": self.rows},
                                     format="json").data
        r = client_for(self.me).post(f"/api/messages/{msg['id']}/press/", {"data": "pick:2"}, format="json")
        self.assertEqual(r.status_code, 200)

    def test_press_unknown_button_rejected(self):
        msg = self.bot_client().post("/api/messages/",
                                     {"chat": str(self.chat.id), "content": "Выберите", "buttons": self.rows},
                                     format="json").data
        r = client_for(self.me).post(f"/api/messages/{msg['id']}/press/", {"data": "pick:99"}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_outsider_cannot_press(self):
        msg = self.bot_client().post("/api/messages/",
                                     {"chat": str(self.chat.id), "content": "Выберите", "buttons": self.rows},
                                     format="json").data
        r = client_for(self.stranger).post(f"/api/messages/{msg['id']}/press/", {"data": "pick:1"}, format="json")
        self.assertEqual(r.status_code, 403)



class PlaylistShareTests(TestCase):
    """Плейлист по ссылке: открывает любой со ссылкой, доступ отзывается."""

    def setUp(self):
        self.me = make_user("me")
        self.other = make_user("other")
        self.pl = Playlist.objects.create(owner=self.me, name="Для бега")
        PlaylistTrack.objects.create(playlist=self.pl, file_url="s3://media/run.mp3",
                                     title="Бег", position=1)

    def test_share_and_open(self):
        c = client_for(self.me)
        token = c.post(f"/api/playlists/{self.pl.id}/share/").data["share_token"]
        self.assertTrue(token)
        r = client_for(self.other).get(f"/api/playlists/shared/{token}/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["owner"], "me")
        self.assertEqual([t["title"] for t in r.data["tracks"]], ["Бег"])

    def test_link_is_stable(self):
        c = client_for(self.me)
        first = c.post(f"/api/playlists/{self.pl.id}/share/").data["share_token"]
        again = c.post(f"/api/playlists/{self.pl.id}/share/").data["share_token"]
        self.assertEqual(first, again, "повторное нажатие не должно менять ссылку")

    def test_revoke(self):
        c = client_for(self.me)
        token = c.post(f"/api/playlists/{self.pl.id}/share/").data["share_token"]
        self.assertEqual(c.delete(f"/api/playlists/{self.pl.id}/share/").status_code, 204)
        self.assertEqual(client_for(self.other).get(f"/api/playlists/shared/{token}/").status_code, 404)

    def test_private_playlist_is_not_reachable(self):
        r = client_for(self.other).get(f"/api/playlists/shared/{self.pl.id}/")
        self.assertEqual(r.status_code, 404)

    def test_save_copy(self):
        token = client_for(self.me).post(f"/api/playlists/{self.pl.id}/share/").data["share_token"]
        r = client_for(self.other).post(f"/api/playlists/shared/{token}/")
        self.assertEqual(r.status_code, 201)
        copy = Playlist.objects.get(id=r.data["playlist"]["id"])
        self.assertEqual(copy.owner, self.other)
        self.assertEqual(copy.name, "Для бега")
        self.assertEqual([t.title for t in copy.tracks.all()], ["Бег"])
        # оригинал не тронут
        self.assertEqual(self.pl.tracks.count(), 1)

    def test_owner_cannot_copy_own(self):
        token = client_for(self.me).post(f"/api/playlists/{self.pl.id}/share/").data["share_token"]
        self.assertEqual(client_for(self.me).post(f"/api/playlists/shared/{token}/").status_code, 400)

    def test_only_owner_shares(self):
        self.assertEqual(client_for(self.other).post(f"/api/playlists/{self.pl.id}/share/").status_code, 404)



class LinkMediaTests(TestCase):
    """Разбор ссылок: страница Pinterest и определение типа по сигнатуре."""

    def test_page_hosts(self):
        from chat.linkimage import _is_page
        for url in ("https://pin.it/abc123", "https://ru.pinterest.com/pin/12345/",
                    "https://www.pinterest.com/pin/9/"):
            self.assertTrue(_is_page(url), url)
        for url in ("https://example.com/a.jpg", "https://pinterest.com.evil.ru/x"):
            self.assertFalse(_is_page(url), url)

    def test_sniff_knows_video_and_images(self):
        from chat.linkimage import sniff
        self.assertEqual(sniff(b"\xff\xd8\xff\xe0")[1], ".jpg")
        self.assertEqual(sniff(b"\x00\x00\x00 ftypisom")[1], ".mp4")
        self.assertIsNone(sniff(b"<!DOCTYPE html>"))

    def test_media_from_page_prefers_video(self):
        from unittest.mock import patch
        from chat.linkimage import _media_from_page
        html = (
            '<meta property="og:image" content="https://i.pinimg.com/cover.jpg">'
            '<meta property="og:video" content="https://v.pinimg.com/clip.mp4">'
        )

        class R:
            status_code = 200
            text = html

        with patch("requests.get", return_value=R()):
            self.assertEqual(_media_from_page("https://pin.it/x"), "https://v.pinimg.com/clip.mp4")

    def test_media_from_page_falls_back_to_image(self):
        from unittest.mock import patch
        from chat.linkimage import _media_from_page

        class R:
            status_code = 200
            text = '<meta content="https://i.pinimg.com/p.jpg" property="og:image">'

        with patch("requests.get", return_value=R()):
            self.assertEqual(_media_from_page("https://pin.it/x"), "https://i.pinimg.com/p.jpg")

    def test_url_only_message(self):
        from chat.linkimage import image_url_in
        self.assertEqual(image_url_in("  https://pin.it/x  "), "https://pin.it/x")
        self.assertIsNone(image_url_in("смотри https://pin.it/x"))


class ReadReceiptTests(TestCase):
    """Галочки: вторая — когда сообщение прочитал кто-то кроме автора."""

    def setUp(self):
        self.me = make_user("me")
        self.friend = make_user("friend")
        self.stranger = make_user("stranger")
        self.chat = Chat.objects.create(kind="direct")
        for p in (self.me, self.friend):
            ChatParticipant.objects.create(chat=self.chat, user=p)
        self.msg = Message.objects.create(chat=self.chat, sender=self.me, content="привет")

    def last_message(self, who):
        r = client_for(who).get("/api/chats/")
        rows = r.data.get("results", r.data) if isinstance(r.data, dict) else r.data
        return next(c["last_message"] for c in rows if c["id"] == str(self.chat.id))

    def mark(self, who, chat_id=None):
        return client_for(who).post("/api/messages/mark_chat_as_read/", {"chat_id": str(chat_id or self.chat.id)}, format="json")

    def test_list_shows_read_after_peer_reads(self):
        self.assertFalse(self.last_message(self.me)["read"])
        # собственная отметка автора не считается
        MessageReadStatus.objects.create(message=self.msg, user=self.me)
        self.assertFalse(self.last_message(self.me)["read"])
        self.assertEqual(self.mark(self.friend).status_code, 200)
        self.assertTrue(self.last_message(self.me)["read"])

    def test_read_by_in_feed(self):
        self.mark(self.friend)
        r = client_for(self.me).get(f"/api/messages/?chat={self.chat.id}")
        rows = r.data.get("results", r.data) if isinstance(r.data, dict) else r.data
        row = next(m for m in rows if m["id"] == str(self.msg.id))
        self.assertEqual([x["id"] for x in row["read_by"]], [str(self.friend.id)])

    def test_broadcast_only_when_something_new(self):
        from unittest import mock
        with mock.patch("chat.views.broadcast_read") as b:
            self.mark(self.friend)
            self.assertEqual(b.call_count, 1)
            self.assertEqual(b.call_args[0][1], self.friend)
            # второй раз читать нечего — и рассылки нет
            self.mark(self.friend)
            self.assertEqual(b.call_count, 1)

    def test_reply_marks_read(self):
        # ответил — значит, видел: входящие помечаются прочитанными и автору уходит событие
        from unittest import mock
        with mock.patch("chat.views.broadcast_read") as b:
            r = client_for(self.friend).post("/api/messages/", {"chat": str(self.chat.id), "content": "ответ"}, format="json")
            self.assertIn(r.status_code, (200, 201))
            self.assertTrue(b.called)
        self.assertTrue(MessageReadStatus.objects.filter(message=self.msg, user=self.friend).exists())

    def test_stranger_cannot_mark(self):
        r = self.mark(self.stranger)
        self.assertEqual(r.status_code, 404)
        self.assertFalse(MessageReadStatus.objects.filter(user=self.stranger).exists())



class ChannelPostDeleteTests(TestCase):
    """Удаление постов в канале: владелец и админ — у всех, подписчик — нет."""

    def setUp(self):
        self.owner = make_user("owner")
        self.admin = make_user("admin")
        self.sub = make_user("sub")
        self.ch = Chat.objects.create(kind="channel", name="Новости", is_public=True)
        ChatParticipant.objects.create(chat=self.ch, user=self.owner, role="owner")
        ChatParticipant.objects.create(chat=self.ch, user=self.admin, role="admin")
        ChatParticipant.objects.create(chat=self.ch, user=self.sub, role="subscriber")
        self.post = Message.objects.create(chat=self.ch, sender=self.admin, content="пост")

    def remove(self, who, scope="all"):
        return client_for(who).post(f"/api/messages/{self.post.id}/remove/", {"scope": scope}, format="json")

    def test_owner_deletes_admins_post(self):
        self.assertEqual(self.remove(self.owner).status_code, 200)
        self.post.refresh_from_db()
        self.assertTrue(self.post.deleted_for_all)

    def test_admin_deletes_own_post(self):
        self.assertEqual(self.remove(self.admin).status_code, 200)

    def test_subscriber_cannot_delete_for_all(self):
        self.assertEqual(self.remove(self.sub).status_code, 403)
        self.post.refresh_from_db()
        self.assertFalse(self.post.deleted_for_all)

    def test_deleted_reaches_subscribers_sync(self):
        before = client_for(self.sub).get(f"/api/channels/{self.ch.id}/posts/")
        self.assertEqual(before.status_code, 200)
        now = before.data["now"]
        self.remove(self.owner)
        after = client_for(self.sub).get(f"/api/channels/{self.ch.id}/posts/", {"since": now})
        self.assertIn(str(self.post.id), after.data["deleted"])

    def test_group_message_not_deletable_by_others(self):
        # В обычной группе правило прежнее: у всех удаляет только автор.
        g = Chat.objects.create(kind="group", is_group=True, name="Группа")
        for p, r in ((self.owner, "owner"), (self.admin, "member")):
            ChatParticipant.objects.create(chat=g, user=p, role=r)
        m = Message.objects.create(chat=g, sender=self.admin, content="x")
        r = client_for(self.owner).post(f"/api/messages/{m.id}/remove/", {"scope": "all"}, format="json")
        self.assertEqual(r.status_code, 403)



class ForwardManyTests(TestCase):
    """Пакетная пересылка: один album_id на пакет, порядок по времени, доступ."""

    def setUp(self):
        self.me = make_user("me")
        self.friend = make_user("friend")
        self.stranger = make_user("stranger")
        self.src = Chat.objects.create(kind="direct")
        self.dst = Chat.objects.create(kind="direct")
        for p in (self.me, self.friend):
            ChatParticipant.objects.create(chat=self.src, user=p)
        ChatParticipant.objects.create(chat=self.dst, user=self.me)
        self.m1 = Message.objects.create(chat=self.src, sender=self.friend, content="раз")
        self.m2 = Message.objects.create(chat=self.src, sender=self.me, content="два")
        self.m3 = Message.objects.create(chat=self.src, sender=self.friend, content="три")

    def fwd(self, who, ids, chat=None):
        return client_for(who).post("/api/messages/forward_many/", {"message_ids": [str(i) for i in ids], "chat_id": str((chat or self.dst).id)}, format="json")

    def test_batch_shares_album_and_keeps_order(self):
        r = self.fwd(self.me, [self.m3.id, self.m1.id, self.m2.id])
        self.assertEqual(r.status_code, 201)
        rows = r.data["messages"]
        self.assertEqual([m["content"] for m in rows], ["раз", "два", "три"])
        albums = {m["album_id"] for m in rows}
        self.assertEqual(len(albums), 1)
        self.assertIsNotNone(albums.pop())
        self.assertEqual(rows[0]["forwarded_title"], "friend")
        self.assertEqual(rows[1]["forwarded_title"], "me")

    def test_single_has_no_album(self):
        r = self.fwd(self.me, [self.m1.id])
        self.assertEqual(r.status_code, 201)
        self.assertIsNone(r.data["messages"][0]["album_id"])

    def test_stranger_cannot_forward_from_chat(self):
        other = Chat.objects.create(kind="direct")
        ChatParticipant.objects.create(chat=other, user=self.stranger)
        r = self.fwd(self.stranger, [self.m1.id], chat=other)
        self.assertEqual(r.status_code, 403)

    def test_cannot_forward_into_foreign_chat(self):
        foreign = Chat.objects.create(kind="direct")
        ChatParticipant.objects.create(chat=foreign, user=self.stranger)
        r = self.fwd(self.me, [self.m1.id], chat=foreign)
        self.assertEqual(r.status_code, 403)

    def test_missing_message_rejected(self):
        import uuid as _uuid
        r = self.fwd(self.me, [self.m1.id, _uuid.uuid4()])
        self.assertEqual(r.status_code, 404)
        self.assertEqual(Message.objects.filter(chat=self.dst).count(), 0)



class StickerKeywordTests(TestCase):
    """Макрос стикера и права: менять и удалять — только автор набора."""

    def setUp(self):
        self.me = make_user("me")
        self.other = make_user("other")
        self.pack = StickerPack.objects.create(name="Мои", author=self.me)
        self.st = Sticker.objects.create(pack=self.pack, file_url="/media/s.webp", file_name="s.webp")

    def test_create_with_keyword_trimmed(self):
        r = client_for(self.me).post("/api/stickers/", {"pack": str(self.pack.id), "file_url": "/m/a.webp", "file_name": "a.webp", "keyword": "  Привет мир "}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data["keyword"], "Привет")

    def test_author_updates_keyword(self):
        r = client_for(self.me).patch(f"/api/stickers/{self.st.id}/", {"keyword": "кот"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.st.refresh_from_db(); self.assertEqual(self.st.keyword, "кот")
        r = client_for(self.me).patch(f"/api/stickers/{self.st.id}/", {"keyword": ""}, format="json")
        self.st.refresh_from_db(); self.assertEqual(self.st.keyword, "")

    def test_patch_cannot_move_pack(self):
        foreign = StickerPack.objects.create(name="Чужой", author=self.other)
        client_for(self.me).patch(f"/api/stickers/{self.st.id}/", {"pack": str(foreign.id), "file_url": "/x"}, format="json")
        self.st.refresh_from_db(); self.assertEqual(self.st.pack_id, self.pack.id); self.assertEqual(self.st.file_url, "/media/s.webp")

    def test_stranger_cannot_update_or_delete(self):
        self.assertEqual(client_for(self.other).patch(f"/api/stickers/{self.st.id}/", {"keyword": "x"}, format="json").status_code, 403)
        self.assertEqual(client_for(self.other).delete(f"/api/stickers/{self.st.id}/").status_code, 403)
        self.assertTrue(Sticker.objects.filter(id=self.st.id).exists())

    def test_author_deletes(self):
        self.assertEqual(client_for(self.me).delete(f"/api/stickers/{self.st.id}/").status_code, 204)
        self.assertFalse(Sticker.objects.filter(id=self.st.id).exists())


class TelegramMirrorTests(TestCase):
    """Зеркала Telegram-каналов: разбор ссылки, подключение, посты без дублей."""

    def setUp(self):
        self.me = make_user("me")
        self.other = make_user("other")

    def test_parse_channel_ref(self):
        from chat.telegram_mirror import parse_channel_ref as p
        for src in ("https://t.me/durov", "t.me/s/durov", "https://telegram.me/durov/", "@durov", "durov", "https://t.me/durov?utm=1"):
            self.assertEqual(p(src), "durov", src)
        for bad in ("https://t.me/+AbCdEf", "https://t.me/joinchat/xyz", "https://t.me/durov/123", "https://example.com/durov", "@ab", ""):
            self.assertIsNone(p(bad), bad)

    def test_connect_creates_pending_and_subscribes(self):
        r = client_for(self.me).post("/api/channels/from-telegram/", {"url": "https://t.me/durov"}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        ch = Chat.objects.get(tg_username="durov")
        self.assertEqual(ch.kind, "channel"); self.assertEqual(ch.tg_state, "pending"); self.assertEqual(ch.name, "@durov")
        self.assertTrue(ChatParticipant.objects.filter(chat=ch, user=self.me, role="subscriber").exists())
        # второй человек подключает тот же канал — канал один, подписчиков двое
        r2 = client_for(self.other).post("/api/channels/from-telegram/", {"url": "@Durov"}, format="json")
        self.assertEqual(r2.status_code, 200)
        self.assertEqual(Chat.objects.filter(tg_username__iexact="durov").count(), 1)
        ch.refresh_from_db(); self.assertEqual(ch.subscribers_count, 2)
        self.assertEqual(r2.data["channel"]["tg_username"], "durov")

    def test_bad_ref_rejected(self):
        r = client_for(self.me).post("/api/channels/from-telegram/", {"url": "https://t.me/+secret"}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_nobody_can_post_to_mirror(self):
        client_for(self.me).post("/api/channels/from-telegram/", {"url": "t.me/durov"}, format="json")
        ch = Chat.objects.get(tg_username="durov")
        r = client_for(self.me).post("/api/messages/", {"chat": str(ch.id), "content": "hi"}, format="json")
        self.assertIn(r.status_code, (400, 403))

    def test_upsert_post_dedup_and_album(self):
        from chat.telegram_mirror import upsert_post, album_uuid
        ch = Chat.objects.create(kind="channel", name="x", tg_username="x", tg_state="active")
        m1, c1 = upsert_post(ch, 10, text="раз", grouped_id=777)
        m2, c2 = upsert_post(ch, 10, text="раз")
        self.assertTrue(c1); self.assertFalse(c2); self.assertEqual(m1.id, m2.id)
        self.assertEqual(m1.album_id, album_uuid(ch.id, 777)); self.assertIsNone(m1.sender)
        m3, c3 = upsert_post(ch, 11, text="")  # пусто и без медиа — не сохраняем
        self.assertIsNone(m3); self.assertFalse(c3)
        m4, _ = upsert_post(ch, 12, media={"file_url": "/media/a.jpg", "file_name": "a.jpg", "file_size": 5, "dims": (10, 20)})
        self.assertEqual((m4.file_width, m4.file_height), (10, 20))

    def test_text_from_tg_appends_hidden_links(self):
        from chat.telegram_mirror import text_from_tg
        class E: 
            def __init__(s, o, l, u): s.offset, s.length, s.url = o, l, u
        class M:
            message = "читать тут и там"
            entities = [E(7, 3, "https://a.example"), E(13, 3, "https://b.example")]
        self.assertEqual(text_from_tg(M()), "читать тут (https://a.example) и там (https://b.example)")
