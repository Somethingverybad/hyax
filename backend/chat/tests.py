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
    c.force_authenticate(user=profile.user)
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
