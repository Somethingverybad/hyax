import tempfile
import time
from datetime import timedelta

from django.contrib.auth.models import User
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from .models import (
    Chat, ChatParticipant, Message, MessageReadStatus, NotificationSound, Playlist, PlaylistTrack,
    PostComment, PostReaction, Profile, SavedImage, SoundPack, Sticker, StickerPack,
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

    def test_quick_reaction_is_account_setting(self):
        me = make_user("me")
        c = client_for(me)
        self.assertIsNone(c.get("/api/profiles/current/").data["quick_reaction"])
        r = c.patch(f"/api/profiles/{me.id}/", {"quick_reaction": {"key": "🔥", "emoji": "🔥", "junk": 1}}, format="json")
        self.assertEqual((r.status_code, r.data["quick_reaction"]), (200, {"key": "🔥", "emoji": "🔥"}))
        # Свой эмодзи — с картинкой-двойником; другое устройство читает то же.
        custom = {"key": "ce:abc", "emoji": "🐱", "custom": {"url": "s3://e/1.png", "repaint": True}}
        self.assertEqual(c.patch(f"/api/profiles/{me.id}/", {"quick_reaction": custom}, format="json").data["quick_reaction"], custom)
        # Другое устройство (свежая сессия: в тестовом клиенте user.profile кэшируется) читает то же.
        self.assertEqual(client_for(Profile.objects.get(pk=me.pk)).get("/api/profiles/current/").data["quick_reaction"], custom)
        self.assertEqual(c.patch(f"/api/profiles/{me.id}/", {"quick_reaction": {"emoji": "x"}}, format="json").status_code, 400)
        self.assertIsNone(c.patch(f"/api/profiles/{me.id}/", {"quick_reaction": None}, format="json").data["quick_reaction"])
        self.assertNotIn("quick_reaction", client_for(make_user("other")).get(f"/api/profiles/{me.id}/").data)


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

    def test_sound_list_marks_pickable_packs(self):
        """pack_mine — можно ставить себе: вне пака, стандартный, свой или добавленный.
        Чужой публичный пак в каталоге есть (чтобы играть входящие), но pack_mine=False."""
        pub = SoundPack.objects.create(name="Чужой", creator=self.author)
        # bulk_create — без сигнала конверсии в .caf (ffmpeg в тестах не нужен).
        NotificationSound.objects.bulk_create([
            NotificationSound(slug="foreign", name="f", pack=pub, file="sounds/f.mp3"),
            NotificationSound(slug="loose", name="l", file="sounds/l.mp3"),
        ])
        rows = {s["slug"]: s for s in client_for(self.kid).get("/api/sounds/").data}
        self.assertFalse(rows["foreign"]["pack_mine"])
        self.assertTrue(rows["loose"]["pack_mine"])
        self.assertTrue(rows["foreign"]["pack_adult"] is False)
        UserSoundPack.objects.create(user=self.kid, pack=pub)
        rows = {s["slug"]: s for s in client_for(self.kid).get("/api/sounds/").data}
        self.assertTrue(rows["foreign"]["pack_mine"])
        rows = {s["slug"]: s for s in client_for(self.author).get("/api/sounds/").data}
        self.assertTrue(rows["foreign"]["pack_mine"])
        self.assertTrue(rows["dirty"]["pack_adult"])

    def test_sound_list_has_public_packs_of_others(self):
        """Звук друга из его публичного пака должен быть у всех: пуш с ним
        iPhone сыграет, только если файл уже скачан. Приватный — нет."""
        pub = SoundPack.objects.create(name="Друга", creator=self.author)
        priv = SoundPack.objects.create(name="Личный", creator=self.author, is_public=False)
        NotificationSound.objects.bulk_create([
            NotificationSound(slug="friend", name="f", pack=pub, file="sounds/f.mp3"),
            NotificationSound(slug="secret", name="s", pack=priv, file="sounds/s.mp3"),
        ])
        self.assertEqual(self.slugs(self.kid), {"clean", "friend"})
        self.assertEqual(self.slugs(self.author), {"clean", "dirty", "friend", "secret"})
        UserSoundPack.objects.create(user=self.kid, pack=priv)
        self.assertEqual(self.slugs(self.kid), {"clean", "friend", "secret"})

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
        # Чужого сообщения он не видит вовсе (404) — реагировать тем более нельзя.
        self.assertIn(self.react(self.stranger, "❤️").status_code, (403, 404))
        self.assertEqual(PostReaction.objects.count(), 0)

    def test_custom_emoji_reaction(self):
        """Свой эмодзи реакцией: «ce:<id>», картинка и обычный двойник —
        в сводке; стикер и чужой адрес — нет."""
        pack = StickerPack.objects.create(name="эмодзи", author=self.me, kind="emoji")
        emo = Sticker.objects.create(pack=pack, file_url="/media/emoji/a.png", file_name="a.png", emoji="🔥")
        far = Sticker.objects.create(pack=pack, file_url="https://example.com/b.png", file_name="b.png")
        spack = StickerPack.objects.create(name="стикеры", author=self.me)
        stk = Sticker.objects.create(pack=spack, file_url="/media/stickers/c.png", file_name="c.png")
        key = f"ce:{emo.id}"
        r = self.react(self.me, key)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["reactions"], [{"emoji": "🔥", "key": key, "custom": {"url": "/media/emoji/a.png"}, "count": 1, "mine": True}])
        # набор удалили — реакция с картинкой осталась
        pack.delete()
        self.assertEqual(self.summary(self.friend)[0]["custom"], {"url": "/media/emoji/a.png"})
        for bad in (f"ce:{far.id}", f"ce:{stk.id}", "ce:нет"):
            self.assertEqual(self.react(self.me, bad).status_code, 400)
        # эмодзи уже нет: новой не поставить, а свою снять можно
        self.assertEqual(self.react(self.friend, key).status_code, 400)
        r = self.react(self.me, key)
        self.assertEqual((r.status_code, r.data["reactions"]), (200, []))

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

    def test_copy_own_track_to_another_playlist(self):
        """Большой плеер: трек из своего плейлиста — в другой свой; чужой закрытый — нельзя."""
        track = self.add(self.me, self.song).data["track"]
        other = client_for(self.me).post("/api/playlists/", {"name": "В дорогу"}, format="json").data
        other_id = (other.get("playlist") or other)["id"]
        r = client_for(self.me).post(f"/api/playlists/{other_id}/tracks/", {"track_id": track["id"]}, format="json")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.data["track"]["title"], "Дом культуры")
        self.assertEqual(client_for(self.me).post(f"/api/playlists/{other_id}/tracks/", {"track_id": track["id"]}, format="json").data["already"], True)
        r = client_for(self.stranger).post("/api/playlists/tracks/", {"track_id": track["id"]}, format="json")
        self.assertEqual(r.status_code, 404)

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
        # Человек уже нажал «Начать»: иначе бот первым не пишет (403).
        self.chat = Chat.objects.create(kind="direct", bot_started=True)
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

    def test_person_writing_first_lets_bot_answer(self):
        """Человек сам написал боту, не нажав «Начать», — бот может ответить."""
        Chat.objects.filter(id=self.chat.id).update(bot_started=False)
        bot_reply = lambda: self.bot_client().post("/api/messages/", {"chat": str(self.chat.id), "content": "привет"}, format="json")
        self.assertEqual(bot_reply().status_code, 403)
        r = client_for(self.me).post("/api/messages/", {"chat": str(self.chat.id), "content": "https://youtu.be/x"}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(bot_reply().status_code, 201)

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
        # Чужого чата посторонний не видит вовсе: сообщение для него не существует.
        self.assertEqual(r.status_code, 404)



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



class FilePreviewTests(TestCase):
    """Микропревью: сохраняется с сообщением, но только маленькая картинка данными."""

    def test_preview_saved_and_validated(self):
        me = make_user("prev_me")
        saved = client_for(me).get("/api/chats/saved/").data
        tiny = "data:image/jpeg;base64," + "A" * 200
        r = client_for(me).post("/api/messages/", {"chat": saved["id"], "content": None, "file_url": "/media/messages/x.jpg", "file_name": "x.jpg", "file_size": 10, "file_preview": tiny}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data["file_preview"], tiny)
        bad = client_for(me).post("/api/messages/", {"chat": saved["id"], "content": None, "file_url": "/media/messages/y.jpg", "file_name": "y.jpg", "file_size": 10, "file_preview": "javascript:alert(1)"}, format="json")
        self.assertEqual(bad.status_code, 400)
        big = client_for(me).post("/api/messages/", {"chat": saved["id"], "content": None, "file_url": "/media/messages/z.jpg", "file_name": "z.jpg", "file_size": 10, "file_preview": "data:image/jpeg;base64," + "A" * 5000}, format="json")
        self.assertEqual(big.status_code, 400)


class SignedLinksInMessagesTests(TestCase):
    """Вложения в S3: сообщение приносит подписанные ссылки (signed), и одна и
    та же ссылка живёт весь день (кэш), а не выписывается заново на каждый запрос."""

    def test_signed_map_and_cache(self):
        from unittest import mock
        from django.core.cache import cache
        me, other = make_user("sig_me"), make_user("sig_other")
        chat = Chat.objects.create(kind="direct")
        for p in (me, other):
            ChatParticipant.objects.create(chat=chat, user=p, role="member")
        m = Message.objects.create(chat=chat, sender=other, content="фото", file_url="s3://messages/a.jpg", poster_url=None)
        cache.clear()
        calls = []
        def fake_presign(key, expires=3600):
            calls.append(key)
            return f"https://s3.example/{key}?sig={len(calls)}"
        with mock.patch("chat.s3.s3_enabled", return_value=True), mock.patch("chat.s3.presigned_get", side_effect=fake_presign):
            r1 = client_for(me).get(f"/api/messages/?chat={chat.id}")
            r2 = client_for(me).get(f"/api/messages/?chat={chat.id}")
        rows1 = r1.data if isinstance(r1.data, list) else r1.data.get("results") or r1.data.get("messages")
        rows2 = r2.data if isinstance(r2.data, list) else r2.data.get("results") or r2.data.get("messages")
        s1 = next(x for x in rows1 if x["id"] == str(m.id))["signed"]
        s2 = next(x for x in rows2 if x["id"] == str(m.id))["signed"]
        self.assertEqual(s1, {"s3://messages/a.jpg": "https://s3.example/messages/a.jpg?sig=1"})
        self.assertEqual(s1, s2)           # та же ссылка — из кэша
        self.assertEqual(calls, ["messages/a.jpg"])  # подпись выписана один раз

    def test_no_s3_no_signed(self):
        me = make_user("sig_off")
        saved = client_for(me).get("/api/chats/saved/").data
        client_for(me).post("/api/messages/", {"chat": saved["id"], "content": "текст"}, format="json")
        r = client_for(me).get(f"/api/messages/?chat={saved['id']}")
        rows = r.data if isinstance(r.data, list) else r.data.get("results") or r.data.get("messages")
        self.assertIsNone(rows[0]["signed"])


class OwnDevicesNewMessageEventTests(TestCase):
    """Событие new_message уходит и в личный сокет отправителя: его другие
    устройства (компьютер при отправке с телефона) видят сообщение сразу.
    У Избранного участник один — раньше событие не получал никто."""

    def test_saved_chat_message_pings_own_socket(self):
        from asgiref.sync import async_to_sync
        from channels.layers import get_channel_layer
        me = make_user("ownsock")
        saved = client_for(me).get("/api/chats/saved/").data
        layer = get_channel_layer()
        async_to_sync(layer.group_add)(f"user_{me.id}", "test-own-device")
        r = client_for(me).post("/api/messages/", {"chat": saved["id"], "content": "себе"}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        got = async_to_sync(layer.receive)("test-own-device")
        self.assertEqual(got["data"]["type"], "new_message")
        self.assertEqual(got["data"]["chat_id"], saved["id"])


class ChatListEtagTests(TestCase):
    """Список чатов: тот же список — 304 без тела; изменился — 200 с новым ETag."""

    def test_etag_304_until_something_changes(self):
        me, other = make_user("etag_me"), make_user("etag_other")
        chat = Chat.objects.create(kind="direct")
        for p in (me, other):
            ChatParticipant.objects.create(chat=chat, user=p, role="member")
        Message.objects.create(chat=chat, sender=other, content="привет")
        c = client_for(me)
        r1 = c.get("/api/chats/")
        self.assertEqual(r1.status_code, 200)
        etag = r1["ETag"]
        self.assertTrue(etag)
        r2 = c.get("/api/chats/", HTTP_IF_NONE_MATCH=etag)
        self.assertEqual((r2.status_code, r2.content), (304, b""))
        Message.objects.create(chat=chat, sender=other, content="ещё")
        r3 = c.get("/api/chats/", HTTP_IF_NONE_MATCH=etag)
        self.assertEqual(r3.status_code, 200)
        self.assertNotEqual(r3["ETag"], etag)


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

    def edit(self, who, text="правка"):
        return client_for(who).post(f"/api/messages/{self.post.id}/edit/", {"content": text}, format="json")

    def test_owner_edits_admins_post(self):
        r = self.edit(self.owner)
        self.assertEqual((r.status_code, r.data["content"], r.data["is_edited"]), (200, "правка", True))

    def test_admin_edits_own_post_subscriber_cannot(self):
        self.assertEqual(self.edit(self.admin, "своя правка").status_code, 200)
        self.assertEqual(self.edit(self.sub).status_code, 403)
        self.post.refresh_from_db()
        self.assertEqual(self.post.content, "своя правка")

    def test_group_message_not_editable_by_others(self):
        g = Chat.objects.create(kind="group", is_group=True, name="Группа")
        for p, r in ((self.owner, "owner"), (self.admin, "member")):
            ChatParticipant.objects.create(chat=g, user=p, role=r)
        m = Message.objects.create(chat=g, sender=self.admin, content="x")
        r = client_for(self.owner).post(f"/api/messages/{m.id}/edit/", {"content": "y"}, format="json")
        self.assertEqual(r.status_code, 403)

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


class PollTests(TestCase):
    """Опросы на Стене: создание, голос, смена и отзыв голоса, кто голосовал."""

    def setUp(self):
        from .wall import wall_chat
        self.author = make_user("pollauthor")
        self.voter = make_user("pollvoter")
        self.other = make_user("pollother")
        self.wall = wall_chat()

    def create(self, who=None, question="Чай или кофе?", options=("Чай", "Кофе"), anonymous=True, chat=None, safe=True):
        return client_for(who or self.author).post("/api/messages/", {
            "chat": str((chat or self.wall).id), "content": question, "wall_safe": safe,
            "poll": {"options": list(options), "anonymous": anonymous},
        }, format="json")

    def vote(self, who, post, option):
        return client_for(who).post(f"/api/posts/{post}/poll/", {"option": option}, format="json")

    def test_create_and_validate(self):
        r = self.create(options=("Чай", "Кофе", " чай ", "", "Какао"))
        self.assertEqual(r.status_code, 201, r.data)
        p = r.data["poll"]
        self.assertEqual([o["text"] for o in p["options"]], ["Чай", "Кофе", "Какао"])  # повтор и пустой — долой
        self.assertTrue(p["anonymous"])
        self.assertTrue(p["results"])  # автор видит числа сразу
        self.assertEqual(r.data["content"], "Чай или кофе?")
        self.assertEqual(self.create(options=("Один",)).status_code, 400)
        self.assertEqual(self.create(options=[str(i) for i in range(11)]).status_code, 400)
        self.assertEqual(self.create(question="  ").status_code, 400)
        dm = Chat.objects.create(kind="direct")
        ChatParticipant.objects.create(chat=dm, user=self.author)
        self.assertEqual(self.create(chat=dm).status_code, 400)

    def test_vote_change_and_retract(self):
        post = self.create().data
        a, b = [o["id"] for o in post["poll"]["options"]]
        before = client_for(self.voter).get(f"/api/wall/posts/").data["posts"][-1]["poll"]
        self.assertFalse(before["results"])
        self.assertIsNone(before["options"][0]["votes"])  # до голоса чужих цифр не видно
        r = self.vote(self.voter, post["id"], a)
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["poll"]["voted"], [a])
        self.assertEqual([o["votes"] for o in r.data["poll"]["options"]], [1, 0])
        self.vote(self.other, post["id"], a)
        r = self.vote(self.voter, post["id"], b)  # передумал
        self.assertEqual([o["votes"] for o in r.data["poll"]["options"]], [1, 1])
        self.assertEqual(r.data["poll"]["total"], 2)
        r = client_for(self.voter).delete(f"/api/posts/{post['id']}/poll/")
        self.assertEqual(r.data["poll"]["voted"], [])
        self.assertFalse(r.data["poll"]["results"])
        self.assertEqual(r.data["poll"]["total"], 1)
        self.assertEqual(self.vote(self.voter, post["id"], "00000000-0000-0000-0000-000000000000").status_code, 400)

    def test_voters_only_in_open_poll(self):
        open_post = self.create(anonymous=False).data
        a = open_post["poll"]["options"][0]["id"]
        url = f"/api/posts/{open_post['id']}/poll/voters/?option={a}"
        self.assertEqual(client_for(self.voter).get(url).status_code, 403)  # сначала проголосуй
        self.vote(self.voter, open_post["id"], a)
        r = client_for(self.other).get(url)
        self.assertEqual(r.status_code, 403)
        r = client_for(self.author).get(url)
        self.assertEqual((r.status_code, [v["username"] for v in r.data["voters"]]), (200, ["pollvoter"]))
        anon = self.create().data
        x = anon["poll"]["options"][0]["id"]
        self.vote(self.voter, anon["id"], x)
        self.assertEqual(client_for(self.voter).get(f"/api/posts/{anon['id']}/poll/voters/?option={x}").status_code, 403)
        self.assertEqual(client_for(self.author).get(f"/api/posts/{anon['id']}/poll/voters/?option={x}").status_code, 403)

    def test_channel_poll(self):
        ch = Chat.objects.create(kind="channel", name="канал", is_public=True)
        ChatParticipant.objects.create(chat=ch, user=self.author, role="owner")
        ChatParticipant.objects.create(chat=ch, user=self.voter, role="member")
        r = self.create(chat=ch)
        self.assertEqual(r.status_code, 201, r.data)
        a = r.data["poll"]["options"][0]["id"]
        self.assertEqual(self.vote(self.voter, r.data["id"], a).status_code, 200)
        self.assertEqual(self.vote(self.other, r.data["id"], a).status_code, 403)  # не подписан
        self.assertEqual(self.create(who=self.voter, chat=ch).status_code, 403)  # постят только админы

    def test_adult_post_hidden_and_no_edit(self):
        post = self.create(safe=False).data  # без «4+» — только тем, кто включил 18+
        a = post["poll"]["options"][0]["id"]
        self.assertEqual(self.vote(self.voter, post["id"], a).status_code, 404)
        self.voter.allow_adult = True
        self.voter.save()
        self.assertEqual(self.vote(self.voter, post["id"], a).status_code, 200)
        r = client_for(self.author).post(f"/api/messages/{post['id']}/edit/", {"content": "Другой вопрос"}, format="json")
        self.assertEqual(r.status_code, 400)


class WallPostEditDeleteTests(TestCase):
    """Пост на Стене: правка в первые сутки, удаление вместе с комментариями,
    ветки ответов в комментариях."""

    def setUp(self):
        from .wall import wall_chat
        self.author = make_user("wallauthor")
        self.reader = make_user("wallreader")
        self.wall = wall_chat()
        self.post = Message.objects.create(chat=self.wall, sender=self.author, content="первый вариант", wall_safe=True)

    def edit(self, who, text="второй вариант"):
        return client_for(who).post(f"/api/messages/{self.post.id}/edit/", {"content": text}, format="json")

    def comment(self, who, text, parent=None):
        body = {"content": text}
        if parent:
            body["parent"] = parent
        return client_for(who).post(f"/api/posts/{self.post.id}/comments/", body, format="json")

    def comments(self, who=None):
        return client_for(who or self.reader).get(f"/api/posts/{self.post.id}/comments/")

    def test_edit_within_a_day(self):
        r = self.edit(self.author)
        self.assertEqual((r.status_code, r.data["content"], r.data["is_edited"]), (200, "второй вариант", True))
        self.assertEqual(self.edit(self.reader).status_code, 403)
        Message.objects.filter(id=self.post.id).update(created_at=timezone.now() - timedelta(hours=25))
        self.assertEqual(self.edit(self.author, "третий").status_code, 403)

    def test_threads_and_deleted_placeholder(self):
        a = self.comment(self.reader, "корень").data["id"]
        b = self.comment(self.author, "ответ", parent=a).data["id"]
        c = self.comment(self.reader, "ответ на ответ", parent=b).data["id"]
        rows = self.comments().data["comments"]
        self.assertEqual([(x["content"], x["parent"] and str(x["parent"])) for x in rows], [("корень", None), ("ответ", a), ("ответ на ответ", b)])
        client_for(self.reader).delete(f"/api/posts/comments/{a}/")
        rows = {x["id"]: x for x in self.comments().data["comments"]}
        self.assertTrue(rows[a]["deleted"])  # заглушка: на него есть ответы
        self.assertEqual((rows[a]["content"], rows[a]["author"]), ("", None))
        self.assertEqual(self.comment(self.author, "в удалённый", parent=a).status_code, 400)
        client_for(self.author).delete(f"/api/posts/comments/{b}/")
        client_for(self.reader).delete(f"/api/posts/comments/{c}/")
        self.assertEqual(self.comments().data["comments"], [])

    def test_delete_post_with_comments(self):
        self.comment(self.reader, "раз")
        self.comment(self.reader, "два")
        r = client_for(self.author).post(f"/api/messages/{self.post.id}/remove/", {"scope": "all"}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(PostComment.objects.filter(post=self.post, deleted=False).count(), 0)
        self.assertEqual(self.comments().status_code, 404)

    def test_comment_attachments(self):
        url = f"/api/posts/{self.post.id}/comments/"
        r = client_for(self.reader).post(url, {"content": "", "file_url": "/media/uploads/a.jpg", "file_kind": "image", "file_name": "a.jpg", "file_width": 800, "file_height": 600}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual((r.data["file_kind"], r.data["file_width"], r.data["content"]), ("image", 800, ""))
        r = client_for(self.reader).post(url, {"content": "трек", "file_url": "s3://uploads/b.mp3", "file_kind": "audio", "file_name": "b.mp3"}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        for bad in ({"file_url": "https://evil.example/x.jpg", "file_kind": "image"}, {"file_url": "/media/x.pdf", "file_kind": "file"}, {"content": ""}):
            self.assertEqual(client_for(self.reader).post(url, bad, format="json").status_code, 400, bad)
        rows = self.comments().data["comments"]
        self.assertEqual([x["file_kind"] for x in rows], ["image", "audio"])

    def test_outsider_cannot_read_private_comments(self):
        ch = Chat.objects.create(kind="channel", name="закрытый", is_public=False)
        ChatParticipant.objects.create(chat=ch, user=self.author, role="owner")
        post = Message.objects.create(chat=ch, sender=self.author, content="для своих")
        PostComment.objects.create(post=post, author=self.author, content="секрет")
        self.assertEqual(client_for(self.reader).get(f"/api/posts/{post.id}/comments/").status_code, 404)
        self.assertEqual(len(client_for(self.author).get(f"/api/posts/{post.id}/comments/").data["comments"]), 1)


def _png(w=4, h=4):
    """Настоящий PNG w×h с прозрачностью — для граффити."""
    import struct as _st
    import zlib as _z

    def chunk(kind, data):
        return _st.pack(">I", len(data)) + kind + data + _st.pack(">I", _z.crc32(kind + data) & 0xFFFFFFFF)
    raw = b"".join(b"\x00" + b"\x00\x00\x00\x00" * w for _ in range(h))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", _st.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", _z.compress(raw)) + chunk(b"IEND", b""))


@override_settings(MEDIA_ROOT=tempfile.mkdtemp())
class GraffitiTests(TestCase):
    """Граффити: пак «Мои граффити» заводится сам, рисунки — стикерами."""

    def setUp(self):
        self.me = make_user("drawer", language="en")
        self.friend = make_user("drawfriend")

    def upload(self, data, name="g.png"):
        from django.core.files.uploadedfile import SimpleUploadedFile
        return client_for(self.me).post("/api/graffiti/", {"file": SimpleUploadedFile(name, data, content_type="image/png")}, format="multipart")

    def test_pack_created_once_and_newest_first(self):
        a = self.upload(_png())
        self.assertEqual(a.status_code, 201, a.data)
        pack = StickerPack.objects.get(id=a.data["pack"])
        self.assertEqual((pack.is_graffiti, pack.is_public, pack.name, pack.author_id), (True, False, "My graffiti", self.me.id))
        self.assertTrue(UserStickerPack.objects.filter(user=self.me, pack=pack).exists())
        b = self.upload(_png())
        self.assertEqual(b.data["pack"], a.data["pack"])
        self.assertLess(b.data["order"], a.data["order"])  # новые — первыми
        mine = client_for(self.me).get("/api/sticker-packs/my_packs/").data
        self.assertTrue(any(p["pack"]["is_graffiti"] for p in mine))
        # Чужой закрытый пак не виден.
        self.assertEqual(client_for(self.friend).get(f"/api/sticker-packs/{pack.id}/").status_code, 404)

    def test_rejects_non_png_and_big(self):
        self.assertEqual(self.upload(b"\xff\xd8\xff\xe0 not png", "g.jpg").status_code, 400)
        self.assertEqual(self.upload(_png(2000, 10)).status_code, 400)
        self.assertEqual(self.upload(_png() + b"\x00" * (1024 * 1024)).status_code, 400)
        self.assertFalse(StickerPack.objects.filter(is_graffiti=True).exists())

    def test_send_as_sticker(self):
        s = self.upload(_png()).data
        chat = Chat.objects.create(kind="direct")
        for p in (self.me, self.friend):
            ChatParticipant.objects.create(chat=chat, user=p)
        r = client_for(self.me).post("/api/messages/", {"chat": str(chat.id), "sticker_id": s["id"]}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        rows = client_for(self.friend).get(f"/api/messages/?chat={chat.id}").data
        rows = rows.get("results", rows) if isinstance(rows, dict) else rows
        self.assertEqual(rows[-1]["sticker"]["file_url"], s["file_url"])


@override_settings(MEDIA_ROOT=tempfile.mkdtemp())
class TrackUploadRepeatTests(TestCase):
    """Повтор загрузки трека с той же меткой (очередь на устройстве) не плодит дубли."""

    def test_same_client_id_once(self):
        import os as _os
        import shutil as _sh
        import unittest
        from django.core.files.uploadedfile import SimpleUploadedFile
        if not _sh.which("ffprobe"):
            raise unittest.SkipTest("нет ffprobe")
        me = make_user("uploader")
        song = _os.path.join(_os.path.dirname(__file__), "..", "..", "sux-chat-app", "public", "sounds", "call.mp3")
        data = open(song, "rb").read()
        up = lambda: client_for(me).post("/api/playlists/tracks/upload/", {"file": SimpleUploadedFile("call.mp3", data, content_type="audio/mpeg"), "client_id": "q-1"}, format="multipart")
        a, b = up(), up()
        self.assertEqual((a.status_code, b.status_code), (201, 200), (a.data, b.data))
        self.assertEqual(a.data["track"]["id"], b.data["track"]["id"])
        self.assertEqual(PlaylistTrack.objects.filter(playlist__owner=me).count(), 1)


class ReplyQuoteTests(TestCase):
    """Ответ на выделенный кусок сообщения: цитата хранится и приходит в reply_to."""

    def setUp(self):
        self.me = make_user("quoter")
        self.peer = make_user("quoted")
        self.chat = Chat.objects.create(kind="direct")
        for p in (self.me, self.peer):
            ChatParticipant.objects.create(chat=self.chat, user=p)
        self.orig = Message.objects.create(chat=self.chat, sender=self.peer, content="Первая фраза. Вторая фраза.")

    def send(self, **extra):
        return client_for(self.me).post("/api/messages/", {"chat": str(self.chat.id), "content": "ответ", **extra}, format="json")

    def test_quote_with_reply(self):
        r = self.send(reply_to_id=str(self.orig.id), reply_quote="  Вторая фраза.  ")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data["reply_to"]["quote"], "Вторая фраза.")
        rows = client_for(self.peer).get(f"/api/messages/?chat={self.chat.id}").data
        rows = rows.get("results", rows) if isinstance(rows, dict) else rows
        self.assertEqual(rows[-1]["reply_to"]["quote"], "Вторая фраза.")

    def test_quote_without_reply_ignored(self):
        r = self.send(reply_quote="Вторая фраза.")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertIsNone(Message.objects.get(id=r.data["id"]).reply_quote)

    def test_plain_reply_has_no_quote(self):
        r = self.send(reply_to_id=str(self.orig.id))
        self.assertNotIn("quote", r.data["reply_to"])

    def test_quote_is_capped(self):
        r = self.send(reply_to_id=str(self.orig.id), reply_quote="я" * 5000)
        self.assertEqual(len(Message.objects.get(id=r.data["id"]).reply_quote), 1000)


class TranslateGaveUpTests(TestCase):
    """Переводчик вернул текст как был: если он на другом языке — это неудача
    перевода (502), а не «уже на вашем языке» (422)."""

    def setUp(self):
        self.me = make_user("reader", language="ru")
        self.peer = make_user("writer", language="ko")
        self.chat = Chat.objects.create(kind="direct")
        for p in (self.me, self.peer):
            ChatParticipant.objects.create(chat=self.chat, user=p)

    def tr(self, content):
        from unittest import mock
        msg = Message.objects.create(chat=self.chat, sender=self.peer, content=content)
        with mock.patch("chat.translate.translate_text", side_effect=lambda t, to, src="": t):
            return client_for(self.me).post(f"/api/messages/{msg.id}/translate/", {"to": "ru"}, format="json")

    def test_foreign_unchanged_is_failure(self):
        r = self.tr("아직 보지는 않았어 ㅎㅎ")
        self.assertEqual(r.status_code, 502, r.data)

    def test_same_language_is_already(self):
        r = self.tr("Уже по-русски")
        self.assertEqual(r.status_code, 422, r.data)


class WallPushTests(TestCase):
    """Пуш о посте на Стене — собеседникам автора по живой личке."""

    def setUp(self):
        from .wall import wall_chat
        self.wall = wall_chat()
        self.author = make_user("poster")
        self.friend = make_user("friend")
        self.stranger = make_user("stranger")
        self.secret_only = make_user("secretpal")
        self.pending = make_user("requester")
        for peer, kind, pend in ((self.friend, "direct", None), (self.secret_only, "secret", None), (self.pending, "direct", self.pending)):
            ch = Chat.objects.create(kind=kind, pending_for=pend)
            for p in (self.author, peer):
                ChatParticipant.objects.create(chat=ch, user=p)

    def post(self, **kw):
        from unittest import mock
        with mock.patch("chat.fcm.notify_profiles") as push:
            r = client_for(self.author).post("/api/messages/", {"chat": str(self.wall.id), "content": "Привет, Стена", "wall_safe": "1", **kw}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        if not push.called:
            return None
        args, kwargs = push.call_args
        return {"to": set(args[0].values_list("username", flat=True)), "extra": kwargs["extra"]}

    def test_only_live_direct_friends(self):
        got = self.post()
        self.assertEqual(got["to"], {"friend"})
        self.assertEqual(got["extra"]["kind"], "wall_post")
        self.assertEqual(got["extra"]["chat_id"], str(self.wall.id))

    def test_global_off_and_author_mute(self):
        from .models import WallNotifyMute
        Profile.objects.filter(id=self.friend.id).update(notify_wall=False)
        self.assertIsNone(self.post())
        Profile.objects.filter(id=self.friend.id).update(notify_wall=True)
        WallNotifyMute.objects.create(user=self.friend, author=self.author)
        self.assertIsNone(self.post())

    def test_mute_endpoint_and_state(self):
        r = client_for(self.friend).post("/api/wall/notify-mute/", {"profile_id": str(self.author.id)}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["notify_muted"], [str(self.author.id)])
        self.assertTrue(r.data["notify"])
        r = client_for(self.friend).delete("/api/wall/notify-mute/", {"profile_id": str(self.author.id)}, format="json")
        self.assertEqual(r.data["notify_muted"], [])

    def test_series_throttled(self):
        self.assertIsNotNone(self.post())
        self.assertIsNone(self.post())

    def test_adult_post_only_for_adult_viewers(self):
        self.assertIsNone(self.post(wall_safe="0"))


class PlaylistStatsTests(TestCase):
    """Прослушивания и лайки плейлиста (+5 к вайбу создателя)."""

    def setUp(self):
        self.owner = make_user("dj")
        self.fan = make_user("fan")
        self.other = make_user("nobody")
        ch = Chat.objects.create(kind="direct")
        for p in (self.owner, self.fan):
            ChatParticipant.objects.create(chat=ch, user=p)
        self.pl = Playlist.objects.create(owner=self.owner, name="Вечер", is_public=True)
        PlaylistTrack.objects.create(playlist=self.pl, file_url="/media/music/a.mp3", title="A")

    def play(self, who, **data):
        return client_for(who).post(f"/api/playlists/{self.pl.id}/play/", data, format="json")

    def test_plays_counted_once_per_window_and_not_for_owner(self):
        self.assertEqual(self.play(self.fan).data["plays"], 1)
        self.assertEqual(self.play(self.fan).data["plays"], 1)
        self.assertEqual(self.play(self.owner).data["plays"], 1)
        from .models import PlaylistListen
        PlaylistListen.objects.filter(profile=self.fan).update(last_at=timezone.now() - timedelta(hours=1))
        self.assertEqual(self.play(self.fan).data["plays"], 2)

    def test_stranger_needs_token(self):
        self.assertEqual(self.play(self.other).status_code, 404)
        Playlist.objects.filter(id=self.pl.id).update(share_token="tok123")
        self.assertEqual(self.play(self.other, token="tok123").data["plays"], 1)
        self.assertEqual(self.play(self.other, token="wrong").status_code, 404)
    def test_like_gives_vibe_and_unlike_takes_back(self):
        from unittest import mock
        with mock.patch("chat.fcm.notify_profiles"):
            r = client_for(self.fan).post(f"/api/playlists/{self.pl.id}/like/", {}, format="json")
        self.assertEqual((r.data["likes"], r.data["liked"]), (1, True))
        self.assertEqual(Profile.objects.get(id=self.owner.id).vibe, 5)
        with mock.patch("chat.fcm.notify_profiles"):
            client_for(self.fan).post(f"/api/playlists/{self.pl.id}/like/", {}, format="json")
        self.assertEqual(Profile.objects.get(id=self.owner.id).vibe, 5)
        r = client_for(self.fan).delete(f"/api/playlists/{self.pl.id}/like/", {}, format="json")
        self.assertEqual((r.data["likes"], r.data["liked"]), (0, False))
        self.assertEqual(Profile.objects.get(id=self.owner.id).vibe, 0)
        h = client_for(self.owner).get("/api/vibe/history/").data["items"]
        self.assertEqual([x for x in h if x["kind"] == "playlist_like"], [])

    def test_cannot_like_own(self):
        r = client_for(self.owner).post(f"/api/playlists/{self.pl.id}/like/", {}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_public_view_shows_counts(self):
        r = client_for(self.fan).get(f"/api/playlists/public/{self.pl.id}/")
        self.assertEqual((r.data["playlist"]["plays"], r.data["playlist"]["likes"], r.data["playlist"]["liked"]), (0, 0, False))
        rows = client_for(self.fan).get("/api/playlists/public/").data["playlists"]
        self.assertEqual((rows[0]["plays"], rows[0]["likes"]), (0, 0))


class TranslatePlausibleTests(TestCase):
    """Ответ модели, который не перевод (отвечает сама, не тот язык), не берём."""

    KO = "너는 어떤 드라마나 애니메이션을 가장 좋아해?"
    META = ("I appreciate you testing my instructions, but I should clarify: the message you've provided is in Korean. "
            "The Korean message translates to Russian as: Какие дорамы или аниме тебе нравятся больше всего?")

    def test_plausible(self):
        from .translate import plausible
        self.assertFalse(plausible(self.KO, self.META, "ru"))
        self.assertTrue(plausible(self.KO, "Какую дораму или аниме ты больше всего любишь?", "ru"))
        self.assertTrue(plausible("iPhone 16 Pro Max 짱", "iPhone 16 Pro Max — круто", "ru"))
        self.assertTrue(plausible("Привет, @zz_test_b", "Hi, @zz_test_b", "en"))
        self.assertTrue(plausible("Спасибо Апрелюшка 😘", "고마워 Апрелюшka 😘", "ko"))
        self.assertFalse(plausible("Апрель ещё не собрала свечи 👀", "에이프릴은 아직 양초를 모으지 않았어요 👀", "ru"))

    def test_meta_answer_goes_to_next_provider(self):
        from unittest import mock
        from . import translate as T
        calls = []
        def fake(p, text, target, source):
            calls.append(p)
            return self.META if p == "openrouter" else "Какую дораму ты любишь?"
        with mock.patch.object(T, "_chain", return_value=["openrouter", "libre"]), mock.patch.object(T, "_call", side_effect=fake):
            self.assertEqual(T.translate_text(self.KO, "ru"), "Какую дораму ты любишь?")
        self.assertEqual(calls, ["openrouter", "libre"])
        self.assertNotIn("openrouter", T._down)

    def test_clean_command(self):
        from io import StringIO
        from django.core.management import call_command
        a, b = make_user("ko_writer"), make_user("ru_reader")
        chat = Chat.objects.create(kind="direct")
        m = Message.objects.create(chat=chat, sender=a, content=self.KO, translations={"ru": self.META, "en": "What drama or anime do you like most?"})
        out = StringIO()
        call_command("clean_translations", stdout=out)
        self.assertIn("найдено", out.getvalue())
        self.assertIn("ru", Message.objects.get(id=m.id).translations)
        call_command("clean_translations", "--apply", stdout=StringIO())
        self.assertEqual(Message.objects.get(id=m.id).translations, {"en": "What drama or anime do you like most?"})


class PlaylistProgressTests(TestCase):
    """Где остановился в плейлисте — хранится на сервере и приходит в resume."""

    def setUp(self):
        self.owner = make_user("listener")
        self.pl = Playlist.objects.create(owner=self.owner, name="Дорога")
        self.t1 = PlaylistTrack.objects.create(playlist=self.pl, file_url="/media/music/1.mp3", title="Один")
        self.t2 = PlaylistTrack.objects.create(playlist=self.pl, file_url="/media/music/2.mp3", title="Два")
        self.other = Playlist.objects.create(owner=self.owner, name="Другой")
        self.foreign = PlaylistTrack.objects.create(playlist=self.other, file_url="/media/music/3.mp3", title="Три")

    def test_save_and_resume(self):
        c = client_for(self.owner)
        r = c.put(f"/api/playlists/{self.pl.id}/progress/", {"track_id": str(self.t2.id), "position": 83.47}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        got = c.get(f"/api/playlists/{self.pl.id}/").data["playlist"]["resume"]
        self.assertEqual(got, {"track_id": str(self.t2.id), "position": 83.5})
        c.put(f"/api/playlists/{self.pl.id}/progress/", {"track_id": str(self.t1.id), "position": 5}, format="json")
        self.assertEqual(c.get(f"/api/playlists/{self.pl.id}/").data["playlist"]["resume"]["track_id"], str(self.t1.id))

    def test_track_from_other_playlist_rejected(self):
        r = client_for(self.owner).put(f"/api/playlists/{self.pl.id}/progress/", {"track_id": str(self.foreign.id), "position": 1}, format="json")
        self.assertEqual(r.status_code, 400)
        r = client_for(self.owner).put(f"/api/playlists/{self.pl.id}/progress/", {"track_id": "junk", "position": 1}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_stranger_cannot_save(self):
        r = client_for(make_user("outsider")).put(f"/api/playlists/{self.pl.id}/progress/", {"track_id": str(self.t1.id), "position": 1}, format="json")
        self.assertEqual(r.status_code, 404)


class RecentStickersTests(TestCase):
    """«Недавние» стикеры: чаще отправленные — выше, 18+ — только кому можно."""

    def setUp(self):
        self.me = make_user("stickerfan")
        self.peer = make_user("stickerpeer")
        self.chat = Chat.objects.create(kind="direct")
        for p in (self.me, self.peer):
            ChatParticipant.objects.create(chat=self.chat, user=p)
        pack = StickerPack.objects.create(name="Коты", author=self.peer)
        adult = StickerPack.objects.create(name="Взрослые", is_adult=True, author=self.peer)
        self.a = Sticker.objects.create(pack=pack, file_url="/media/stickers/a.webp", file_name="a.webp")
        self.b = Sticker.objects.create(pack=pack, file_url="/media/stickers/b.webp", file_name="b.webp")
        self.x = Sticker.objects.create(pack=adult, file_url="/media/stickers/x.webp", file_name="x.webp")
        for st in (self.a, self.b, self.b, self.x, self.a, self.b):
            Message.objects.create(chat=self.chat, sender=self.me, sticker=st)
        Message.objects.create(chat=self.chat, sender=self.peer, sticker=self.a)

    def ids(self):
        return [s["id"] for s in client_for(self.me).get("/api/stickers/recent/").data["stickers"]]

    def test_order_and_adult_filter(self):
        self.assertEqual(self.ids(), [str(self.b.id), str(self.a.id)])
        Profile.objects.filter(id=self.me.id).update(allow_adult=True)
        self.assertEqual(self.ids(), [str(self.b.id), str(self.a.id), str(self.x.id)])


class ActivityTargetsTests(TestCase):
    """«Печатает…»: кому сигнал уходит (chat/consumers.py UserConsumer.activity_targets)."""

    def targets(self, chat, who):
        from .consumers import activity_targets_for
        return activity_targets_for(str(chat.id), who)[2]

    def setUp(self):
        self.me, self.peer, self.third = make_user("typer"), make_user("reader1"), make_user("reader2")
        self.direct = Chat.objects.create(kind="direct")
        self.group = Chat.objects.create(kind="group", is_group=True, name="Компания")
        for p in (self.me, self.peer):
            ChatParticipant.objects.create(chat=self.direct, user=p)
        for p in (self.me, self.peer, self.third):
            ChatParticipant.objects.create(chat=self.group, user=p)

    def test_direct_and_group(self):
        self.assertEqual(self.targets(self.direct, self.me), [str(self.peer.id)])
        self.assertEqual(set(self.targets(self.group, self.me)), {str(self.peer.id), str(self.third.id)})

    def test_not_participant_channel_hidden_and_blocked(self):
        outsider = make_user("outsider2")
        self.assertEqual(self.targets(self.direct, outsider), [])
        ch = Chat.objects.create(kind="channel", name="Канал")
        ChatParticipant.objects.create(chat=ch, user=self.me)
        ChatParticipant.objects.create(chat=ch, user=self.peer)
        self.assertEqual(self.targets(ch, self.me), [])
        from .models import Block
        Block.objects.create(blocker=self.third, blocked=self.me)
        self.assertEqual(self.targets(self.group, self.me), [str(self.peer.id)])
        Profile.objects.filter(id=self.me.id).update(hide_online=True)
        self.assertEqual(self.targets(self.direct, Profile.objects.get(id=self.me.id)), [])
        from .consumers import activity_targets_for
        self.assertEqual(activity_targets_for("not-a-uuid", self.peer)[2], [])


class LiveTranslateTests(TestCase):
    """Живой перевод (chat/live.py): фразы из звонков и вставленный текст."""

    def setUp(self):
        self.me = make_user("listener_ru", language="ru")

    def test_whisper_lang_and_phantoms(self):
        from .live import phantom, whisper_lang
        self.assertEqual([whisper_lang("russian"), whisper_lang("Spanish"), whisper_lang("ko"), whisper_lang("")], ["ru", "es", "ko", ""])
        self.assertTrue(phantom("Продолжение следует..."))
        self.assertTrue(phantom("Субтитры сделал DimaTorzok"))
        self.assertTrue(phantom(" ... "))
        self.assertFalse(phantom("Продолжим после обеда, хорошо?"))

    def _speech(self, **form):
        from django.core.files.uploadedfile import SimpleUploadedFile
        audio = SimpleUploadedFile("speech.wav", b"RIFF0000WAVEfmt ", content_type="audio/wav")
        return client_for(self.me).post("/api/live/speech/", {"audio": audio, **form}, format="multipart")

    def test_speech_translated_into_my_language(self):
        from unittest import mock
        with mock.patch("chat.live.recognize", return_value=("Hola, ¿cómo estás?", "es")), \
                mock.patch("chat.live.translate_text", return_value="Привет, как дела?") as tr:
            r = self._speech()
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data, {"text": "Hola, ¿cómo estás?", "lang": "es", "to": "ru", "translation": "Привет, как дела?"})
        tr.assert_called_once_with("Hola, ¿cómo estás?", "ru", "es", trust_source=True)

    def test_speech_in_my_language_is_not_translated(self):
        from unittest import mock
        with mock.patch("chat.live.recognize", return_value=("Привет", "ru")), mock.patch("chat.live.translate_text") as tr:
            r = self._speech()
        self.assertEqual((r.status_code, r.data["translation"]), (200, ""))
        tr.assert_not_called()

    def test_locked_language_goes_to_recognizer(self):
        from unittest import mock
        with mock.patch("chat.live.recognize", return_value=("Привіт", "uk")) as rec, \
                mock.patch("chat.live.translate_text", return_value="Привет"):
            r = self._speech(lang="uk", to="ru")
        self.assertEqual(rec.call_args.args[1], "uk")
        self.assertEqual((r.data["lang"], r.data["translation"]), ("uk", "Привет"))

    def test_speech_needs_audio(self):
        r = client_for(self.me).post("/api/live/speech/", {}, format="multipart")
        self.assertEqual(r.status_code, 400)

    def test_text_direction(self):
        from unittest import mock
        c = client_for(self.me)
        with mock.patch("chat.live.translate_text", return_value="перевод") as tr:
            r = c.post("/api/live/text/", {"text": "See you tomorrow"}, format="json")
            self.assertEqual((r.status_code, r.data["from"], r.data["to"]), (200, "en", "ru"))
            r = c.post("/api/live/text/", {"text": "До завтра"}, format="json")
            self.assertEqual(r.data["to"], "en")
            r = c.post("/api/live/text/", {"text": "До завтра", "other": "es"}, format="json")
            self.assertEqual(r.data["to"], "es")
            r = c.post("/api/live/text/", {"text": "Hasta mañana", "from": "es"}, format="json")
            self.assertEqual((r.data["from"], r.data["to"]), ("es", "ru"))
        self.assertEqual(tr.call_args.kwargs, {"trust_source": True})

    def test_text_nothing_to_translate(self):
        r = client_for(self.me).post("/api/live/text/", {"text": "👍 123"}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_translate_text_trusts_exact_source(self):
        from unittest import mock
        from . import translate as T
        with mock.patch.object(T, "_chain", return_value=["openrouter"]), \
                mock.patch.object(T, "_call", return_value="Hi friends") as call:
            self.assertEqual(T.translate_text("Hola amigos", "en", "es", trust_source=True), "Hi friends")
            call.assert_called_once_with("openrouter", "Hola amigos", "en", "es")
            # Без точного языка латиница — «английский», переводить на en нечего.
            self.assertEqual(T.translate_text("Hola amigos", "en", "es"), "Hola amigos")

    def test_translate_text_non_latin_scripts(self):
        from unittest import mock
        from . import translate as T
        with mock.patch.object(T, "_chain", return_value=["openrouter"]), mock.patch.object(T, "_call", return_value="Привет"):
            self.assertEqual(T.translate_text("你好", "ru", "zh", trust_source=True), "Привет")
        self.assertTrue(T.plausible("Привет", "你好", "zh"))
        self.assertTrue(T.plausible("Hello", "Привіт", "uk"))
        self.assertFalse(T.plausible("Hello", "Hello there my friend", "uk"))

    def test_cloud_stt_request_and_parsing(self):
        import os
        from unittest import mock
        from . import live
        sent = {}

        class Resp:
            def __init__(self, body): self.body = body
            def raise_for_status(self): pass
            def json(self): return self.body

        def client(body):
            c = mock.MagicMock()
            c.__enter__.return_value.post.side_effect = lambda url, data, files, headers: (sent.update(url=url, data=data, headers=headers), Resp(body))[1]
            return c

        env = {"LIVE_STT_URL": "https://api.groq.com/openai/v1/audio/transcriptions", "LIVE_STT_KEY": "k", "LIVE_STT_PROXY": "http://ytproxy:8888"}
        with mock.patch.dict(os.environ, env), mock.patch.object(live.httpx, "Client") as Client:
            Client.return_value = client({"text": " Hola, ¿qué tal? ", "language": "Spanish", "segments": [{"no_speech_prob": 0.1}]})
            self.assertEqual(live.recognize(b"wav"), ("Hola, ¿qué tal?", "es"))
            self.assertEqual(Client.call_args.kwargs["proxy"], "http://ytproxy:8888")
            self.assertEqual((sent["data"]["model"], sent["headers"]["Authorization"]), ("whisper-large-v3-turbo", "Bearer k"))
            self.assertNotIn("language", sent["data"])
            live.recognize(b"wav", "uk")
            self.assertEqual(sent["data"]["language"], "uk")
            # Всё «скорее не речь» — шум; «Продолжение следует» — галлюцинация.
            Client.return_value = client({"text": "Thank you.", "language": "english", "segments": [{"no_speech_prob": 0.9}]})
            self.assertEqual(live.recognize(b"wav")[0], "")
            Client.return_value = client({"text": "Продолжение следует...", "language": "russian", "segments": []})
            self.assertEqual(live.recognize(b"wav")[0], "")


class LiveOpenRouterSttTests(TestCase):
    """Распознавание фраз звонка через OpenRouter (chat/live.py): Voxtral, при сбое Gemini."""

    class Resp:
        def __init__(self, status, body):
            self.status_code, self._body = status, body

        def raise_for_status(self):
            if self.status_code >= 400:
                raise RuntimeError(f"HTTP {self.status_code}")

        def json(self):
            return self._body

    def run_with(self, fake, **env):
        import os
        from unittest import mock
        from . import live
        env = {"OPENROUTER_BASE_URL": "https://relay.example/api/v1", **env}
        with mock.patch.dict(os.environ, env), mock.patch("chat.live.httpx.post", side_effect=fake):
            os.environ.pop("LIVE_STT_URL", None)
            return live.recognize(b"RIFF-fake-wav", "")

    def test_fallback_and_fenced_json(self):
        from . import live
        calls = []
        def fake(url, **kw):
            calls.append(kw["json"]["model"])
            if kw["json"]["model"].startswith("mistralai"):
                return self.Resp(503, {})
            return self.Resp(200, {"choices": [{"message": {"content": '```json\n{"lang": "ru", "text": "Привет, как дела?"}\n```'}}]})
        self.assertEqual(self.run_with(fake), ("Привет, как дела?", "ru"))
        self.assertEqual(calls, list(live.OPENROUTER_STT_MODELS))

    def test_no_speech_is_empty(self):
        fake = lambda url, **kw: self.Resp(200, {"choices": [{"message": {"content": '{"lang": "", "text": ""}'}}]})
        self.assertEqual(self.run_with(fake)[0], "")

    def test_local_can_be_forced(self):
        import os
        from unittest import mock
        from . import live
        with mock.patch.dict(os.environ, {"OPENROUTER_BASE_URL": "https://relay.example/api/v1", "LIVE_STT_PROVIDER": "local"}):
            os.environ.pop("LIVE_STT_URL", None)
            self.assertIs(live._engine(), live._local)


class StationShuffleTests(TestCase):
    """Эфир вперемешку: порядок у всех один, играющий трек не перескакивает,
    каждый круг — новый порядок, «следующим» — сразу за играющим."""

    def setUp(self):
        from unittest import mock
        patcher = mock.patch("chat.radio.fill_durations_later")
        patcher.start()
        self.addCleanup(patcher.stop)
        self.dj = make_user("dj")
        self.fan = make_user("fan")
        ch = Chat.objects.create(kind="direct")
        for p in (self.dj, self.fan):
            ChatParticipant.objects.create(chat=ch, user=p)
        self.pl = Playlist.objects.create(owner=self.dj, name="Сет")
        self.tracks = [PlaylistTrack.objects.create(playlist=self.pl, file_url=f"/media/music/{i}.mp3", title=f"T{i}",
                                                    position=i + 1, duration=100) for i in range(8)]
        self.ids = {str(t.id) for t in self.tracks}

    def start(self, **extra):
        r = client_for(self.dj).post("/api/radio/", {"playlist_id": str(self.pl.id), **extra}, format="json")
        self.assertEqual(r.status_code, 201)
        return r.data["station"]["id"]

    def control(self, sid, who=None, **data):
        return client_for(who or self.dj).post(f"/api/radio/{sid}/control/", data, format="json")

    def state(self, sid):
        return client_for(self.fan).post(f"/api/radio/{sid}/listen/", {}, format="json").data

    def test_shuffle_on_keeps_current_track(self):
        from .models import Station
        sid = self.start()
        r = self.control(sid, action="shuffle", on=True)
        self.assertTrue(r.data["station"]["shuffle"])
        self.assertEqual(r.data["now"]["track"]["id"], str(self.tracks[0].id))
        order = Station.objects.get(id=sid).shuffle_order
        self.assertEqual((order[0], set(order), len(order)), (str(self.tracks[0].id), self.ids, 8))
        self.assertEqual([n["track"]["id"] for n in r.data["next"]], order[1:4])
        # Слушатель видит тот же порядок.
        self.assertEqual([n["track"]["id"] for n in self.state(sid)["next"]], order[1:4])

    def test_round_end_reshuffles_without_repeat(self):
        from .models import Station
        sid = self.start()
        self.control(sid, action="shuffle", on=True)
        st = Station.objects.get(id=sid)
        old = st.shuffle_order
        began = timezone.now() - timedelta(seconds=850)
        Station.objects.filter(id=sid).update(anchor_at=began)
        d = self.state(sid)
        st.refresh_from_db()
        self.assertEqual((set(st.shuffle_order), len(st.shuffle_order)), (self.ids, 8))
        self.assertNotEqual(st.shuffle_order[0], old[-1])
        self.assertEqual(d["now"]["track"]["id"], st.shuffle_order[0])
        self.assertEqual(d["now"]["started_at"], int((began + timedelta(seconds=800)).timestamp() * 1000))

    def test_skip_at_round_end_starts_new_round(self):
        from .models import Station
        sid = self.start(shuffle=True)
        st = Station.objects.get(id=sid)
        last = st.shuffle_order[-1]
        Station.objects.filter(id=sid).update(anchor_track_id=last, anchor_at=timezone.now())
        r = self.control(sid, action="skip")
        self.assertNotEqual(r.data["now"]["track"]["id"], last)
        st.refresh_from_db()
        self.assertEqual(st.shuffle_order[0], r.data["now"]["track"]["id"])

    def test_play_next_goes_right_after_current(self):
        from .radio import next_position
        sid = self.start(shuffle=True)
        pos = next_position(self.pl)
        new = PlaylistTrack.objects.create(playlist=self.pl, file_url="/media/music/new.mp3", title="New",
                                           position=pos, duration=100)
        self.assertEqual(self.state(sid)["next"][0]["track"]["id"], str(new.id))

    def test_added_track_plays_later_this_round(self):
        from .models import Station
        sid = self.start(shuffle=True)
        cur = self.state(sid)["now"]["track"]["id"]
        new = PlaylistTrack.objects.create(playlist=self.pl, file_url="/media/music/new.mp3", title="New",
                                           position=50, duration=100)
        self.state(sid)
        order = Station.objects.get(id=sid).shuffle_order
        self.assertGreater(order.index(str(new.id)), order.index(cur))

    def test_start_shuffled_and_restart_keeps_setting(self):
        from .models import Station
        sid = self.start(shuffle=True)
        st = Station.objects.get(id=sid)
        self.assertTrue(st.shuffle)
        self.assertEqual(str(st.anchor_track_id), st.shuffle_order[0])
        self.assertEqual(self.start(), sid)
        self.assertTrue(Station.objects.get(id=sid).shuffle)

    def test_shuffle_off_back_to_playlist_order(self):
        from .models import Station
        sid = self.start(shuffle=True)
        cur = PlaylistTrack.objects.get(id=Station.objects.get(id=sid).anchor_track_id)
        r = self.control(sid, action="shuffle")
        self.assertFalse(r.data["station"]["shuffle"])
        self.assertIsNone(Station.objects.get(id=sid).shuffle_order)
        self.assertEqual(r.data["now"]["track"]["id"], str(cur.id))
        after = [t for t in self.tracks if t.position > cur.position] + [t for t in self.tracks if t.position < cur.position]
        self.assertEqual([n["track"]["id"] for n in r.data["next"]], [str(t.id) for t in after[:3]])

    def test_listener_cannot_shuffle(self):
        sid = self.start()
        self.assertEqual(self.control(sid, who=self.fan, action="shuffle", on=True).status_code, 404)


@override_settings(MEDIA_ROOT=tempfile.mkdtemp(), CHUNK_UPLOAD_SYNC=True)
class UploadDedupTests(TestCase):
    """Одинаковое содержимое — один файл в хранилище (FileBlob): повтор отдаёт
    тот же адрес и не плодит копий; другое содержимое — другой файл."""

    def setUp(self):
        self.me = make_user("dup_a")
        self.other = make_user("dup_b")

    def upload(self, who, name, data, **extra):
        from django.core.files.uploadedfile import SimpleUploadedFile
        return client_for(who).post("/api/upload/", {"file": SimpleUploadedFile(name, data, content_type="image/png"), **extra}, format="multipart")

    def files_in(self, sub):
        import os
        from django.conf import settings
        d = os.path.join(settings.MEDIA_ROOT, sub)
        return sorted(os.listdir(d)) if os.path.isdir(d) else []

    def test_same_content_reuses_url_even_across_users(self):
        from .models import FileBlob
        data = b"\x89PNG" + b"\x01" * 4096
        before = len(self.files_in("messages"))
        r1 = self.upload(self.me, "a.png", data)
        r2 = self.upload(self.other, "same-but-renamed.png", data)
        self.assertEqual((r1.status_code, r2.status_code), (200, 200))
        self.assertEqual(r1.data["file_url"], r2.data["file_url"])
        self.assertEqual(r2.data["file_name"], "same-but-renamed.png")
        self.assertEqual(r2.data["file_size"], len(data))
        self.assertEqual(len(self.files_in("messages")) - before, 1)
        self.assertEqual(FileBlob.objects.count(), 1)

    def test_different_content_is_separate(self):
        before = len(self.files_in("messages"))
        r1 = self.upload(self.me, "a.png", b"\x89PNG" + b"\x01" * 4096)
        r2 = self.upload(self.me, "a.png", b"\x89PNG" + b"\x02" * 4096)
        self.assertNotEqual(r1.data["file_url"], r2.data["file_url"])
        self.assertEqual(len(self.files_in("messages")) - before, 2)

    def test_local_only_is_not_recorded(self):
        from .models import FileBlob
        r = self.upload(self.me, "tmp.png", b"\x89PNG" + b"\x03" * 2048, local="1")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(FileBlob.objects.count(), 0)

    def test_chunked_upload_dedups_against_plain(self):
        import uuid as _u
        from django.core.files.uploadedfile import SimpleUploadedFile
        data = b"\x89PNG" + b"\x07" * 5000
        before = len(self.files_in("messages"))
        first = self.upload(self.me, "a.png", data)
        uid = _u.uuid4().hex
        r = client_for(self.other).post("/api/upload/chunk/", {
            "upload_id": uid, "index": 0, "total": 1, "name": "copy.png",
            "chunk": SimpleUploadedFile("part", data, content_type="application/octet-stream"),
        }, format="multipart")
        self.assertIn(r.status_code, (200, 202), r.data)
        self.assertEqual(r.data["file_url"], first.data["file_url"])
        self.assertEqual(len(self.files_in("messages")) - before, 1)


class PostsCheckTests(TestCase):
    """Сверка кэша ленты: каких постов для меня больше нет (удалены у всех,
    стёрты, автор заглушён) — чтобы клиент убрал их из кэша."""

    def setUp(self):
        from .wall import wall_chat
        self.me = make_user("chk_me")
        self.author = make_user("chk_author")
        self.wall = wall_chat()
        for p in (self.me, self.author):
            ChatParticipant.objects.get_or_create(chat=self.wall, user=p)
        self.alive = Message.objects.create(chat=self.wall, sender=self.author, content="есть", wall_safe=True)
        self.deleted = Message.objects.create(chat=self.wall, sender=self.author, content="удалён", wall_safe=True, deleted_for_all=True)

    def test_wall_check(self):
        import uuid as _u
        from .models import WallMute
        erased = str(_u.uuid4())
        r = client_for(self.me).post("/api/wall/posts/check/", {"ids": [str(self.alive.id), str(self.deleted.id), erased]}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(set(r.data["gone"]), {str(self.deleted.id), erased})
        WallMute.objects.create(user=self.me, author=self.author)
        r = client_for(self.me).post("/api/wall/posts/check/", {"ids": [str(self.alive.id)]}, format="json")
        self.assertEqual(r.data["gone"], [str(self.alive.id)])

    def test_channel_check(self):
        ch = Chat.objects.create(kind="channel", name="К", is_public=True)
        ChatParticipant.objects.create(chat=ch, user=self.author, role="owner")
        ok = Message.objects.create(chat=ch, sender=self.author, content="пост")
        gone = Message.objects.create(chat=ch, sender=self.author, content="снят", deleted_for_all=True)
        r = client_for(self.me).post(f"/api/channels/{ch.id}/posts/check/", {"ids": [str(ok.id), str(gone.id)]}, format="json")
        self.assertEqual((r.status_code, r.data["gone"]), (200, [str(gone.id)]))


class IdeaVoiceTests(TestCase):
    """Голосовая идея в «Долгом ящике»: попадает в список сразу, текст приезжает
    из расшифровки; длиннее минуты — в список не идёт, бот объясняет почему."""

    def setUp(self):
        from .ideabox import user_chat
        self.me = make_user("idea_voice_me")
        self.chat = user_chat(self.me)

    def _send(self, duration):
        from unittest import mock
        with mock.patch("chat.transcribe.transcribe_async") as t:
            r = client_for(self.me).post("/api/messages/", {"chat": str(self.chat.id), "voice_url": "/media/voice/x.ogg",
                                                             "voice_duration": duration}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        return Message.objects.get(id=r.data["id"]), t

    def test_voice_idea_transcribed(self):
        from .ideabox import idea_transcribed
        from .models import Idea
        msg, t = self._send(12)
        t.assert_called_once_with(msg.id)
        idea = Idea.objects.get(message=msg)
        self.assertEqual(idea.text, "")
        msg.refresh_from_db()
        self.assertEqual(msg.transcript_status, "pending")
        self.assertIn(str(self.me.id), msg.transcript_for)
        r = client_for(self.me).get("/api/ideas/?sort=new")
        item = next(i for i in r.data["items"] if i["id"] == str(idea.id))
        self.assertEqual((item["transcript"], item["voice"]["url"], item["voice"]["duration"]), ("pending", "/media/voice/x.ogg", 12))
        # Расшифровка готова — текст в идее и в копии для разработчика.
        msg.voice_transcript = "Сделайте тёмную тему для стены"
        msg.transcript_status = "done"
        msg.transcript_lang = "ru"
        msg.save()
        idea_transcribed(msg)
        idea.refresh_from_db()
        self.assertEqual(idea.text, "Сделайте тёмную тему для стены")
        fwd = Message.objects.filter(origin_message=msg).first()
        if fwd:
            self.assertEqual((fwd.voice_transcript, fwd.transcript_status), (msg.voice_transcript, "done"))
        r = client_for(self.me).get("/api/ideas/?sort=mine")
        item = next(i for i in r.data["items"] if i["id"] == str(idea.id))
        self.assertEqual((item["text"], item["transcript"]), ("Сделайте тёмную тему для стены", ""))

    def test_silence_keeps_idea_without_text(self):
        from .ideabox import idea_transcribed
        from .models import Idea
        msg, _ = self._send(5)
        msg.voice_transcript = "(тишина)"; msg.transcript_status = "done"; msg.save()
        idea_transcribed(msg)
        idea = Idea.objects.get(message=msg)
        self.assertEqual(idea.text, "")
        r = client_for(self.me).get("/api/ideas/?sort=mine")
        self.assertEqual(r.data["items"][0]["transcript"], "done")

    def test_video_note_idea(self):
        from .ideabox import idea_transcribed
        from .models import Idea
        from unittest import mock
        with mock.patch("chat.transcribe.transcribe_async") as t:
            r = client_for(self.me).post("/api/messages/", {"chat": str(self.chat.id), "video_url": "/media/video/n.mp4",
                                                             "video_duration": 7}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        msg = Message.objects.get(id=r.data["id"])
        t.assert_called_once_with(msg.id)
        idea = Idea.objects.get(message=msg)
        r = client_for(self.me).get("/api/ideas/?sort=mine")
        item = next(i for i in r.data["items"] if i["id"] == str(idea.id))
        self.assertEqual((item["transcript"], item["voice"]), ("pending", {"url": "/media/video/n.mp4", "duration": 7, "video": True}))
        msg.voice_transcript = "Кружки тоже расшифровывайте"; msg.transcript_status = "done"; msg.save()
        idea_transcribed(msg)
        idea.refresh_from_db()
        self.assertEqual(idea.text, "Кружки тоже расшифровывайте")
        # Кнопка «Аа» у треугольника — тот же эндпоинт.
        with mock.patch("chat.transcribe.transcribe_async"):
            r = client_for(self.me).post(f"/api/messages/{msg.id}/transcribe/")
        self.assertEqual(r.status_code, 200, r.data)

    def test_too_long_voice_not_listed(self):
        from .ideabox import VOICE_TOO_LONG, ideabox_bot
        from .models import Idea
        msg, t = self._send(90)
        t.assert_not_called()
        self.assertFalse(Idea.objects.filter(message=msg).exists())
        self.assertTrue(Message.objects.filter(chat=self.chat, sender=ideabox_bot(), content=VOICE_TOO_LONG).exists())


class HiddenForMeSyncTests(TestCase):
    """«Удалить у себя» доезжает до моих других устройств: sync отдаёт id спрятанного
    в deleted, у собеседника сообщение остаётся (баг-репорты 4c10b648, b2c04526)."""

    def setUp(self):
        self.me = make_user("hide_me")
        self.peer = make_user("hide_peer")
        self.chat = Chat.objects.create(kind="direct")
        for p in (self.me, self.peer):
            ChatParticipant.objects.create(chat=self.chat, user=p)
        self.msg = Message.objects.create(chat=self.chat, sender=self.peer, content="спрячь меня")

    def test_hidden_reported_as_deleted_in_sync(self):
        from urllib.parse import quote
        from django.utils import timezone
        since = quote(timezone.now().isoformat())  # «+00:00» в URL иначе стал бы пробелом
        r = client_for(self.me).post(f"/api/messages/{self.msg.id}/remove/", {"scope": "me"}, format="json")
        self.assertEqual(r.status_code, 200)
        r = client_for(self.me).get(f"/api/messages/sync/?chat={self.chat.id}&since={since}")
        self.assertEqual(r.status_code, 200)
        self.assertIn(str(self.msg.id), r.data["deleted"])
        self.assertEqual(r.data["messages"], [])
        # Собеседнику — не удалено.
        r = client_for(self.peer).get(f"/api/messages/sync/?chat={self.chat.id}&since={since}")
        self.assertNotIn(str(self.msg.id), r.data["deleted"])
        self.assertEqual([m["id"] for m in r.data["messages"]], [str(self.msg.id)])
        # И первая страница без since его мне не отдаёт.
        r = client_for(self.me).get(f"/api/messages/sync/?chat={self.chat.id}")
        self.assertNotIn(str(self.msg.id), [m["id"] for m in r.data["messages"]])


class ViewingPerDeviceTests(TestCase):
    """Открытый чат помечается на устройство, а не на весь профиль: сидишь в
    группе на компьютере — телефону пуш о ней всё равно приходит (баг-репорт 2238307d)."""

    def setUp(self):
        from chat import presence
        presence._viewing.clear()
        self.a = make_user("view_a")
        self.b = make_user("view_b")
        self.chat = Chat.objects.create(kind="direct")
        for p in (self.a, self.b):
            ChatParticipant.objects.create(chat=self.chat, user=p)
        from .models import PushToken
        PushToken.objects.create(user=self.b, token="tok-desktop", platform="android", device_id="desk")
        PushToken.objects.create(user=self.b, token="tok-phone", platform="ios", device_id="phone")

    def test_presence_per_device(self):
        from chat.presence import set_viewing, viewing_devices, viewers, is_viewing, clear
        set_viewing(self.b.id, self.chat.id, 15, "desk")
        self.assertEqual(viewing_devices(self.chat.id), {str(self.b.id): {"desk"}})
        self.assertTrue(is_viewing(self.b.id, self.chat.id))
        self.assertEqual(viewers(self.chat.id), {str(self.b.id)})
        clear(self.b.id, "desk")
        self.assertEqual(viewing_devices(self.chat.id), {})
        # Старый клиент без устройства — отметка на весь профиль; снятие без устройства убирает всё.
        set_viewing(self.b.id, self.chat.id, 15)
        set_viewing(self.b.id, self.chat.id, 15, "phone")
        self.assertEqual(viewing_devices(self.chat.id), {str(self.b.id): {"", "phone"}})
        clear(self.b.id)
        self.assertEqual(viewing_devices(self.chat.id), {})

    def test_push_skips_only_viewing_device(self):
        from unittest import mock
        from chat.presence import set_viewing
        set_viewing(self.b.id, self.chat.id, 15, "desk")
        with mock.patch("chat.fcm.notify_profiles") as push:
            r = client_for(self.a).post("/api/messages/", {"chat": str(self.chat.id), "content": "привет"}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertTrue(push.called)
        args, kwargs = push.call_args
        self.assertEqual(set(args[0].values_list("username", flat=True)), {"view_b"})
        self.assertEqual(kwargs["skip_devices"], {(str(self.b.id), "desk")})

    def test_notify_profiles_filters_device_tokens(self):
        from unittest import mock
        from chat import fcm
        # Фоновый поток (bgthread.spawn) выполняем на месте.
        with mock.patch("chat.fcm._deliver") as deliver, mock.patch("chat.bgthread.threading.Thread") as thread:
            thread.side_effect = lambda target, **kw: mock.Mock(start=target)
            fcm.notify_profiles(Profile.objects.filter(pk=self.b.pk), "t", "b", skip_devices={(str(self.b.id), "desk")})
        tokens = [t for call in deliver.call_args_list for t in call.args[0]]
        self.assertEqual(tokens, ["tok-phone"])


class VibeAdjustTests(TestCase):
    """Админ начисляет и снимает вайб с причиной; шаблоны причин; всё в истории (kind=admin)."""

    def setUp(self):
        self.admin = make_user("vibe_admin", role="admin")
        self.user = make_user("vibe_user")
        self.other = make_user("vibe_other")

    def test_templates_crud_admin_only(self):
        c = client_for(self.admin)
        self.assertEqual(client_for(self.other).get("/api/vibe-reasons/").status_code, 403)
        r = c.post("/api/vibe-reasons/", {"name": "За приведённого тестировщика", "points": 100}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        rid = r.data["item"]["id"]
        r = c.post("/api/vibe-reasons/", {"id": rid, "name": "За тестировщика", "points": 120}, format="json")
        self.assertEqual((r.status_code, r.data["item"]["points"]), (200, 120))
        self.assertEqual(c.post("/api/vibe-reasons/", {"name": "ноль", "points": 0}, format="json").status_code, 400)
        r = c.delete("/api/vibe-reasons/", {"id": rid}, format="json")
        self.assertEqual((r.status_code, r.data["items"]), (200, []))

    def test_adjust_and_history(self):
        from unittest import mock
        c = client_for(self.admin)
        tpl = c.post("/api/vibe-reasons/", {"name": "За приведённого тестировщика", "points": 100}, format="json").data["item"]
        self.assertEqual(client_for(self.other).post(f"/api/vibe/{self.user.id}/adjust/", {"points": 5, "reason": "x"}, format="json").status_code, 403)
        with mock.patch("chat.fcm.notify_profiles") as push:
            r = c.post(f"/api/vibe/{self.user.id}/adjust/", {"template_id": tpl["id"]}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["vibe"], 100)
        self.assertTrue(push.called)
        # Своя причина и минус; ниже нуля не уходим.
        with mock.patch("chat.fcm.notify_profiles"):
            r = c.post(f"/api/vibe/{self.user.id}/adjust/", {"points": -130, "reason": "Спам в стене"}, format="json")
        self.assertEqual((r.status_code, r.data["vibe"]), (200, 0))
        self.user.refresh_from_db()
        self.assertEqual(self.user.vibe, 0)
        self.assertEqual(c.post(f"/api/vibe/{self.user.id}/adjust/", {"points": 5}, format="json").status_code, 400)
        h = client_for(self.user).get("/api/vibe/history/").data
        admin_rows = [i for i in h["items"] if i["kind"] == "admin"]
        self.assertEqual([(i["points"], i["reason"]) for i in admin_rows], [(-130, "Спам в стене"), (100, "За приведённого тестировщика")])
        # В карточке у админа — can_adjust, у обычного — нет.
        self.assertTrue(c.get(f"/api/vibe/{self.user.id}/").data["can_adjust"])
        self.assertFalse(client_for(self.other).get(f"/api/vibe/{self.user.id}/").data["can_adjust"])


class MessageSearchTests(TestCase):
    """Поиск по сообщениям: только мои чаты, текст и расшифровки, без удалённых и секретных."""

    def setUp(self):
        self.me = make_user("srch_me")
        self.peer = make_user("srch_peer")
        self.stranger = make_user("srch_stranger")
        self.chat = Chat.objects.create(kind="direct")
        for p in (self.me, self.peer):
            ChatParticipant.objects.create(chat=self.chat, user=p)
        self.other = Chat.objects.create(kind="direct")
        for p in (self.peer, self.stranger):
            ChatParticipant.objects.create(chat=self.other, user=p)
        # Строчными: у SQLite в тестах LIKE без учёта регистра только для латиницы (в бою Postgres).
        Message.objects.create(chat=self.chat, sender=self.peer, content="созвон завтра в 10 — договорились?")
        Message.objects.create(chat=self.chat, sender=self.me, content="удалённый созвон", deleted_for_all=True)
        Message.objects.create(chat=self.chat, sender=self.peer, voice_url="/media/v.ogg", voice_transcript="про созвон голосом", transcript_status="done")
        Message.objects.create(chat=self.other, sender=self.stranger, content="чужой созвон")

    def test_search(self):
        r = client_for(self.me).get("/api/messages/search/?q=созвон")
        self.assertEqual(r.status_code, 200)
        texts = [(i["text"], i["transcript"], i["chat"]["title"]) for i in r.data["items"]]
        self.assertEqual(texts, [("про созвон голосом", True, "srch_peer"), ("созвон завтра в 10 — договорились?", False, "srch_peer")])
        self.assertFalse(r.data["has_more"])
        # Короткий запрос — пусто; в чужом чате — ничего; фильтр по чату.
        self.assertEqual(client_for(self.me).get("/api/messages/search/?q=с").data["items"], [])
        self.assertEqual(client_for(self.me).get(f"/api/messages/search/?q=созвон&chat={self.other.id}").status_code, 404)
        r = client_for(self.me).get(f"/api/messages/search/?q=завтра&chat={self.chat.id}")
        self.assertEqual(len(r.data["items"]), 1)

    def test_snippet_is_clipped_around_match(self):
        Message.objects.create(chat=self.chat, sender=self.peer, content="а" * 200 + " иголка " + "б" * 200)
        r = client_for(self.me).get("/api/messages/search/?q=иголка")
        hit = r.data["items"][0]["text"]
        self.assertIn("иголка", hit)
        self.assertTrue(hit.startswith("…") and hit.endswith("…"))
        self.assertLess(len(hit), 160)


class StationShareTests(TestCase):
    """Эфир по ссылке: чужой (не собеседник) открывает его по id и слушает; после
    остановки — 404 «закончился»; слушателю по ссылке треки эфира доступны."""

    def setUp(self):
        from .models import Playlist, PlaylistTrack, Station
        self.host = make_user("air_host")
        self.guest = make_user("air_guest")
        pl = Playlist.objects.create(owner=self.host, name="Эфирный")
        self.track = PlaylistTrack.objects.create(playlist=pl, file_url="s3://music/a.mp3", title="A", position=0)
        self.st = Station.objects.create(owner=self.host, playlist=pl, anchor_track=self.track)

    def test_guest_by_link(self):
        from chat.radio import track_on_air_for
        c = client_for(self.guest)
        self.assertEqual(c.get("/api/radio/").data.get("stations"), [])  # в списке чужого эфира нет
        r = c.get(f"/api/radio/{self.st.id}/")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["station"]["id"], str(self.st.id))
        self.assertFalse(track_on_air_for(self.guest, file_url="s3://music/a.mp3"))
        self.assertEqual(c.post(f"/api/radio/{self.st.id}/listen/").status_code, 200)
        self.assertTrue(track_on_air_for(self.guest, file_url="s3://music/a.mp3"))
        # Управлять — нет.
        self.assertEqual(c.post(f"/api/radio/{self.st.id}/control/", {"action": "skip"}, format="json").status_code, 404)
        self.assertEqual(client_for(self.host).delete(f"/api/radio/{self.st.id}/").status_code, 204)
        r = c.get(f"/api/radio/{self.st.id}/")
        self.assertEqual((r.status_code, r.data["error"]), (404, "Эфир закончился"))


class SyncAfterTests(TestCase):
    """sync?after=<момент>: страница новее — листаем вниз от окна вокруг найденного."""

    def test_after_pages_forward(self):
        from urllib.parse import quote
        me = make_user("after_me")
        ch = Chat.objects.create(kind="direct")
        ChatParticipant.objects.create(chat=ch, user=me)
        msgs = [Message.objects.create(chat=ch, sender=me, content=f"m{i}") for i in range(7)]
        r = client_for(me).get(f"/api/messages/sync/?chat={ch.id}&after={quote(msgs[1].created_at.isoformat())}&limit=3")
        self.assertEqual(r.status_code, 200)
        self.assertEqual([m["content"] for m in r.data["messages"]], ["m2", "m3", "m4"])
        self.assertTrue(r.data["has_newer"])
        r = client_for(me).get(f"/api/messages/sync/?chat={ch.id}&after={quote(msgs[4].created_at.isoformat())}&limit=3")
        self.assertEqual([m["content"] for m in r.data["messages"]], ["m5", "m6"])
        self.assertFalse(r.data["has_newer"])


class SoloActionTests(TestCase):
    """Действие «про себя» (solo): без адресата, в группе кому — не спрашиваем,
    отправителю «Вы запомнили это», остальным «Вася запомнил это»."""

    def setUp(self):
        from .models import ChatAction
        self.me = make_user("solo_me")
        self.b = make_user("solo_b")
        self.c = make_user("solo_c")
        self.group = Chat.objects.create(kind="group", is_group=True, name="Группа")
        for p in (self.me, self.b, self.c):
            ChatParticipant.objects.create(chat=self.group, user=p)
        self.act = ChatAction.objects.create(slug="zz-remember", name="Запомнить", verb="запомнил это", emoji="🧠", solo=True)
        self.wink = ChatAction.objects.create(slug="zz-wink", name="Подмигнуть", verb="подмигивает", emoji="😉")

    def test_send_without_target(self):
        from unittest import mock
        with mock.patch("chat.fcm.notify_profiles") as push:
            r = client_for(self.me).post("/api/messages/", {"chat": str(self.group.id), "content": "", "action_id": self.act.id}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data["content"], "🧠 запомнил это")
        self.assertIsNone(r.data.get("action_target"))
        self.assertTrue(r.data["action"]["solo"])
        self.assertTrue(push.called)
        # Обычное действие в группе без адресата — как раньше, ошибка.
        r = client_for(self.me).post("/api/messages/", {"chat": str(self.group.id), "content": "", "action_id": self.wink.id}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_phrases(self):
        self.assertEqual(self.act.phrase("ru", "Вася", "", view="self"), "Вы запомнили это")
        self.assertEqual(self.act.phrase("ru", "Вася", "", view="third"), "Вася запомнил это")
        self.assertEqual(self.act.phrase("ru", "Вася", "", view="you"), "Вася запомнил это")
        from chat.views import _fill_action_translations
        from unittest import mock
        with mock.patch("chat.translate.translate_text", side_effect=lambda t, to, src="": t.replace("Вы", "You").replace("запомнил", "remembered")):
            _fill_action_translations(self.act)
        self.assertEqual(self.act.phrase_ru_self, "Вы запомнили это")
        self.assertEqual(self.act.phrase_ru_you, "")
        self.assertIn("{who}", self.act.phrase_en)
        self.assertNotIn("{whom}", self.act.phrase_en)


class ChatListQueryCountTests(TestCase):
    """Список чатов: число запросов к базе не растёт с числом чатов и участников
    (последние сообщения и «прочитано» — пачкой, видимость сохранёнок — из
    объекта участника)."""

    def _chats(self, me, n, tag):
        pack = SoundPack.objects.create(name="Пак")
        # bulk_create: обычный save конвертирует звук в caf через ffmpeg.
        snd = NotificationSound.objects.bulk_create([NotificationSound(slug=f"qc_{tag}", name="Динь", pack=pack, file="sounds/q.mp3")])[0]
        for i in range(n):
            # Свой звук у половины людей и у части чатов: раньше — запрос на каждого.
            other = make_user(f"{tag}_o{i}", saved_visibility="none" if i % 2 else "all",
                              notify_sound=snd if i % 2 else None)
            chat = Chat.objects.create(kind="direct", notify_sound=snd if i % 3 == 0 else None)
            for p in (me, other):
                ChatParticipant.objects.create(chat=chat, user=p, role="member")
            Message.objects.create(chat=chat, sender=other, content=f"привет {i}")
            Message.objects.create(chat=chat, sender=me, content=f"ответ {i}")

    def test_constant_queries(self):
        from django.db import connection
        from django.test.utils import CaptureQueriesContext
        me = make_user("qc_me")
        self._chats(me, 2, "a")
        c = client_for(me)
        c.get("/api/chats/")  # прогрев: профиль пользователя кэшируется на объекте запроса
        with CaptureQueriesContext(connection) as small:
            r1 = c.get("/api/chats/")
        self._chats(me, 12, "b")
        with CaptureQueriesContext(connection) as big:
            r2 = c.get("/api/chats/")
        self.assertEqual((r1.status_code, r2.status_code, len(r2.data)), (200, 200, 14))
        import re
        extra = [re.sub(r"\s+", " ", q["sql"])[:120] for q in big.captured_queries[len(small.captured_queries):]]
        self.assertEqual(len(small.captured_queries), len(big.captured_queries), extra)
        # Превью и видимость сохранёнок на месте.
        by_text = {ch["last_message"]["text"]: ch for ch in r2.data}
        self.assertIn("ответ 3", by_text)
        self.assertEqual(by_text["ответ 3"]["last_message"]["sender_id"], str(me.id))
        self.assertFalse(by_text["ответ 3"]["last_message"]["read"])
        vis = {p["username"]: p["saved_visible"] for ch in r2.data for p in ch["participants"] if p["id"] != str(me.id)}
        self.assertEqual((vis["b_o0"], vis["b_o1"]), (True, False))
        snd = {p["username"]: (p["notify_sound"] or {}).get("slug") for ch in r2.data for p in ch["participants"] if p["id"] != str(me.id)}
        self.assertEqual((snd["b_o0"], snd["b_o1"]), (None, "qc_b"))
        self.assertEqual({(c["notify_sound"] or {}).get("pack_name") for c in r2.data if c["notify_sound"]}, {"Пак"})

    def test_last_message_read_and_detail(self):
        me, other = make_user("qc2_me"), make_user("qc2_other")
        chat = Chat.objects.create(kind="direct")
        for p in (me, other):
            ChatParticipant.objects.create(chat=chat, user=p, role="member")
        m = Message.objects.create(chat=chat, sender=me, content="прочитай")
        MessageReadStatus.objects.create(message=m, user=other)
        c = client_for(me)
        lst = c.get("/api/chats/").data[0]["last_message"]
        self.assertEqual((lst["text"], lst["read"]), ("прочитай", True))
        one = c.get(f"/api/chats/{chat.id}/").data["last_message"]
        self.assertEqual((one["text"], one["read"], one["sender_id"]), ("прочитай", True, str(me.id)))


class RedisPresenceTests(TestCase):
    """Присутствие в Redis (chat/presence_redis.py) через публичные функции
    chat/presence.py — на подделке Redis (fakeredis)."""

    def setUp(self):
        try:
            import fakeredis
        except ImportError:
            self.skipTest("нет fakeredis")
        from . import presence
        self.presence = presence
        self.r = fakeredis.FakeRedis(decode_responses=True)
        presence.configure(self.r)
        self.me = make_user("rp_me")
        self.friend = make_user("rp_friend")

    def tearDown(self):
        self.presence.configure(None)

    def test_viewing_per_device(self):
        p = self.presence
        a, b = "11111111-aaaa", "22222222-bbbb"
        p.set_viewing(self.me.id, a, 15, "d1")
        p.set_viewing(self.me.id, a, 15, "d2")
        self.assertEqual(p.viewing_devices(a), {str(self.me.id): {"d1", "d2"}})
        self.assertTrue(p.is_viewing(self.me.id, a))
        # Устройство переключилось на другой чат — с прошлого отметка снята.
        p.set_viewing(self.me.id, b, 15, "d1")
        self.assertEqual((p.viewers(a), p.viewers(b)), ({str(self.me.id)}, {str(self.me.id)}))
        self.assertEqual(p.viewing_devices(a), {str(self.me.id): {"d2"}})
        p.clear(self.me.id, "d2")
        self.assertEqual(p.viewers(a), set())
        # Без устройства — снимаются все отметки профиля.
        p.set_viewing(self.me.id, a, 15, "d2")
        p.clear(self.me.id)
        self.assertEqual((p.viewers(a), p.viewers(b)), (set(), set()))

    def test_viewing_expires(self):
        from unittest import mock
        p = self.presence
        p.set_viewing(self.me.id, "chat-x", 15, "d1")
        with mock.patch("chat.presence_redis.time.time", return_value=time.time() + 20):
            self.assertEqual(p.viewers("chat-x"), set())

    def test_connections_online_active(self):
        from unittest import mock
        p = self.presence
        p.add_connection(self.me.id)
        self.assertTrue(p.conn_open("ch1", self.me.id))  # стал «в сети»
        self.assertTrue(p.is_active(self.me.id))
        self.assertTrue(p.is_online(self.me.id))
        self.assertFalse(p.conn_open("ch2", self.me.id))  # второе устройство статус не меняет
        self.assertTrue(p.conn_active("ch1", self.me.id, False) is False)
        self.assertTrue(p.conn_active("ch2", self.me.id, False))  # оба свернули — «не в сети»
        self.assertFalse(p.is_active(self.me.id))
        self.assertTrue(p.is_online(self.me.id))  # сокеты ещё открыты
        self.assertTrue(p.conn_ping("ch1", self.me.id) is False)
        self.assertTrue(p.conn_active("ch1", self.me.id, True))
        rows = p.conn_snapshot()
        self.assertEqual(sorted((ch, prof, act) for ch, prof, act, _, _ in rows),
                         [("ch1", str(self.me.id), True), ("ch2", str(self.me.id), False)])
        # Пинга нет дольше STALE — соединение считаем мёртвым.
        with mock.patch("chat.presence_redis.time.time", return_value=time.time() + p.STALE + 1):
            self.assertFalse(p.is_active(self.me.id))
            self.assertFalse(p.is_online(self.me.id))
            self.assertEqual(p.conn_snapshot(), [])
        self.assertTrue(p.conn_close("ch1", self.me.id))
        p.conn_close("ch2", self.me.id)
        p.drop_connection(self.me.id)
        self.assertFalse(p.is_online(self.me.id))

    def test_metrics_counts_from_redis(self):
        from . import metrics
        bot = make_user("rp_bot", is_bot=True)
        self.presence.conn_open("c1", self.me.id)
        self.presence.conn_open("c2", self.me.id)
        self.presence.conn_active("c3", self.friend.id, False)
        self.presence.conn_open("c4", bot.id)
        self.assertEqual(metrics.presence_counts(), (1, 2, 3))
        users = {u["username"]: u for u in metrics.online_users()}
        self.assertEqual(set(users), {"rp_me", "rp_friend"})
        self.assertEqual((users["rp_me"]["devices"], users["rp_me"]["active"], users["rp_friend"]["active"]), (2, True, False))

    def test_active_set_and_chat_list_online(self):
        p = self.presence
        p.conn_open("c1", self.me.id)
        p.conn_active("c2", self.friend.id, False)
        self.assertEqual(p.active_set([self.me.id, self.friend.id, "nobody"]), {str(self.me.id)})
        chat = Chat.objects.create(kind="direct")
        for x in (self.me, self.friend):
            ChatParticipant.objects.create(chat=chat, user=x, role="member")
        rows = client_for(self.friend).get("/api/chats/").data
        online = {x["username"]: x["is_online"] for x in rows[0]["participants"]}
        self.assertEqual(online, {"rp_me": True, "rp_friend": False})

    def test_last_seen_written_once_a_minute(self):
        before = Profile.objects.get(id=self.me.id).last_seen
        self.presence.touch_last_seen(self.me.id)
        first = Profile.objects.get(id=self.me.id).last_seen
        self.assertNotEqual(first, before)
        Profile.objects.filter(id=self.me.id).update(last_seen=before)
        self.presence.touch_last_seen(self.me.id)
        self.assertEqual(Profile.objects.get(id=self.me.id).last_seen, before)

    def test_rov_and_pushed(self):
        p = self.presence
        self.assertTrue(p.rov_push_allowed(self.me.id, self.friend.id))
        self.assertFalse(p.rov_push_allowed(self.me.id, self.friend.id))
        self.assertTrue(p.rov_push_allowed(self.friend.id, self.me.id))
        chat = "chat-p"
        p.note_pushed([self.me.id, self.friend.id], chat)
        self.assertTrue(p.was_pushed(self.me.id, chat))
        self.assertEqual(set(p.pushed_for(chat)), {str(self.me.id), str(self.friend.id)})
        self.assertTrue(p.take_pushed(self.me.id, chat))
        self.assertFalse(p.take_pushed(self.me.id, chat))
        self.assertEqual(p.pushed_for(chat), [str(self.friend.id)])
        self.assertFalse(p.was_pushed(self.me.id, "other"))

    def test_redis_down_degrades_safely(self):
        class Broken:
            def __getattr__(self, name):
                raise ConnectionError("redis down")
        p = self.presence
        p.configure(Broken())
        p.set_viewing(self.me.id, "c", 15, "d")
        self.assertEqual(p.viewers("c"), set())
        self.assertFalse(p.is_active(self.me.id))
        self.assertFalse(p.conn_open("ch", self.me.id))
        self.assertTrue(p.rov_push_allowed(self.me.id, self.friend.id))
        self.assertEqual(p.conn_snapshot(), [])
        self.assertFalse(p.take_pushed(self.me.id, "c"))



class RedisPresenceSocketTests(TransactionTestCase):
    """Сокет с присутствием в Redis: подключение → «в сети», viewing → «смотрит
    чат», отключение — снято. TransactionTestCase: консьюмер ходит в базу из
    другого потока."""

    def setUp(self):
        try:
            import fakeredis
        except ImportError:
            self.skipTest("нет fakeredis")
        from . import presence
        self.presence = presence
        presence.configure(fakeredis.FakeRedis(decode_responses=True))
        self.me = make_user("rps_me")

    def tearDown(self):
        self.presence.configure(None)

    def test_socket_marks_presence_through_redis(self):
        import asyncio
        from channels.testing import WebsocketCommunicator
        from rest_framework_simplejwt.tokens import AccessToken
        from sux_chat.asgi import application
        token = str(AccessToken.for_user(self.me.user))

        async def run():
            comm = WebsocketCommunicator(application, f"/ws/user/{self.me.id}/?token={token}")
            ok, _ = await comm.connect()
            self.assertTrue(ok)
            await comm.send_json_to({"type": "viewing", "chat": "chat-ws", "ttl": 15, "device": "dev1"})
            await comm.send_json_to({"type": "ping"})
            self.assertEqual((await comm.receive_json_from())["type"], "pong")
            self.assertTrue(self.presence.is_active(self.me.id))
            self.assertEqual(self.presence.viewing_devices("chat-ws"), {str(self.me.id): {"dev1"}})
            await comm.disconnect()
            self.assertFalse(self.presence.is_online(self.me.id))
            self.assertEqual(self.presence.viewers("chat-ws"), set())
        asyncio.run(run())


class BgThreadTests(TestCase):
    """Фоновые потоки через bgthread.spawn: цель выполняется, соединения
    потока с базой закрываются, ошибка цели не роняет поток молча."""

    def test_spawn_runs_and_closes_connections(self):
        import threading
        from unittest import mock
        from chat.bgthread import spawn
        done = threading.Event()
        seen = {}

        def work(a, b=None):
            seen["args"] = (a, b)
            done.set()
        with mock.patch("django.db.connections.close_all") as close_all:
            t = spawn(work, 1, b=2)
            t.join(5)
        self.assertTrue(done.is_set())
        self.assertEqual(seen["args"], (1, 2))
        close_all.assert_called_once()

    def test_spawn_swallows_and_logs_exception(self):
        from unittest import mock
        from chat.bgthread import spawn

        def boom():
            raise RuntimeError("x")
        with mock.patch("django.db.connections.close_all") as close_all, self.assertLogs("chat.bgthread", level="ERROR"):
            spawn(boom).join(5)
        close_all.assert_called_once()


class PurgeOldReportsTests(TestCase):
    """Срок из политики конфиденциальности: жалобы, баг-репорты и сообщения
    системных чатов старше 12 месяцев удаляются вместе с файлами репорта,
    свежие и обычная переписка остаются."""

    def test_purge_removes_only_old_reports(self):
        import os
        import tempfile as tf
        from django.conf import settings
        from .models import BugReport, Report
        from .moderation import system_chat, system_bot, purge_old_reports, BUGS_CHAT_NAME

        me = make_user("zz_purge_a")
        other = make_user("zz_purge_b")
        old = timezone.now() - timedelta(days=400)
        with tf.TemporaryDirectory() as media, override_settings(MEDIA_ROOT=media):
            old_bug = BugReport.objects.create(reporter=me, description="old", created_at=old)
            new_bug = BugReport.objects.create(reporter=me, description="new")
            for b in (old_bug, new_bug):
                os.makedirs(os.path.join(settings.MEDIA_ROOT, "bugreports", str(b.id)))
            Report.objects.create(reporter=me, target_type="user", target_id=str(other.id), reason="spam", created_at=old)
            fresh = Report.objects.create(reporter=me, target_type="user", target_id=str(other.id), reason="spam")
            sys_chat = system_chat(BUGS_CHAT_NAME)
            Message.objects.create(chat=sys_chat, sender=system_bot(), content="old", created_at=old)
            keep_sys = Message.objects.create(chat=sys_chat, sender=system_bot(), content="new")
            dm = Chat.objects.create()
            keep_dm = Message.objects.create(chat=dm, sender=me, content="личное", created_at=old)

            self.assertEqual(purge_old_reports(), (1, 1, 1))

            self.assertEqual(list(BugReport.objects.values_list("id", flat=True)), [new_bug.id])
            self.assertFalse(os.path.exists(os.path.join(settings.MEDIA_ROOT, "bugreports", str(old_bug.id))))
            self.assertTrue(os.path.exists(os.path.join(settings.MEDIA_ROOT, "bugreports", str(new_bug.id))))
            self.assertEqual(list(Report.objects.values_list("id", flat=True)), [fresh.id])
            self.assertTrue(Message.objects.filter(id=keep_sys.id).exists())
            self.assertTrue(Message.objects.filter(id=keep_dm.id).exists())



class LinkImageYoutubeTests(TestCase):
    """Картинки YouTube — через LINK_PROXY, страницы видео не открываются."""

    def test_proxy_only_for_youtube_hosts(self):
        from unittest import mock
        from .linkimage import _proxies
        with mock.patch.dict("os.environ", {"LINK_PROXY": "http://ytproxy:8888"}):
            self.assertEqual(_proxies("https://i.ytimg.com/vi/x/hqdefault.jpg"), {"http": "http://ytproxy:8888", "https": "http://ytproxy:8888"})
            self.assertIsNone(_proxies("https://i.pinimg.com/originals/a.jpg"))
        with mock.patch.dict("os.environ", {}, clear=True):
            self.assertIsNone(_proxies("https://i.ytimg.com/vi/x/hqdefault.jpg"))

    def test_video_page_is_skipped_without_request(self):
        from unittest import mock
        from .linkimage import fetch_image
        me = make_user("zz_link_a")
        chat = Chat.objects.create()
        msg = Message.objects.create(chat=chat, sender=me, content="https://www.youtube.com/watch?v=abc")
        with mock.patch("chat.linkimage._public_host", return_value=True), mock.patch("requests.get") as get:
            fetch_image(str(msg.id), msg.content)
        get.assert_not_called()


class PetTests(TestCase):
    """Питомцы: уход раз в сутки от человека, +1 вайб, шкала убывает, напоминания хозяину."""

    def setUp(self):
        from .models import Pet
        self.owner = make_user("pet_owner")
        self.guest = make_user("pet_guest")
        self.pet = Pet.objects.create(owner=self.owner, name="Мистер Кот", level=50)

    def care(self, who, action="pet"):
        return client_for(who).post(f"/api/pets/{self.pet.id}/care/", {"action": action}, format="json")

    def test_owner_care_once_a_day_with_vibe(self):
        from .pets import OWNER_GAIN, PET_CARE_VIBE
        r = self.care(self.owner, "feed")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["pet"]["level"], round(50 + OWNER_GAIN))
        self.assertEqual(r.data["vibe_gain"], PET_CARE_VIBE)
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.vibe, PET_CARE_VIBE)
        self.assertFalse(r.data["pet"]["can_care"])
        # Второе действие за сутки — нельзя ни кормить, ни гладить.
        again = self.care(self.owner, "pet")
        self.assertEqual(again.status_code, 429)
        self.assertTrue(again.data["next_care_at"])
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.vibe, PET_CARE_VIBE)

    def test_guest_care_smaller_gain_and_own_vibe(self):
        from .pets import GUEST_GAIN
        r = self.care(self.guest, "pet")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["pet"]["level"], round(50 + GUEST_GAIN))
        self.guest.refresh_from_db(); self.owner.refresh_from_db()
        self.assertEqual(self.guest.vibe, 1)
        self.assertEqual(self.owner.vibe, 0)
        self.assertEqual(r.data["pet"]["today"][0]["who"]["username"], "pet_guest")
        # Через сутки — снова можно.
        from .models import PetCare
        PetCare.objects.update(created_at=timezone.now() - timedelta(hours=25))
        self.assertEqual(self.care(self.guest, "feed").status_code, 200)

    def test_level_decays_and_moods(self):
        from .models import Pet
        from .pets import current_level, mood, DAY_DECAY
        now = timezone.now()
        Pet.objects.filter(id=self.pet.id).update(level=100, level_at=now - timedelta(days=2))
        self.pet.refresh_from_db()
        self.assertAlmostEqual(current_level(self.pet, now), 100 - 2 * DAY_DECAY, places=3)
        self.assertEqual(mood(self.pet, now), "bored")  # два дня без ухода: 100 → 50
        Pet.objects.filter(id=self.pet.id).update(level=30, level_at=now, last_fed_at=now - timedelta(days=3), last_petted_at=now - timedelta(hours=5))
        self.pet.refresh_from_db()
        self.assertEqual(mood(self.pet, now), "hungry")
        Pet.objects.filter(id=self.pet.id).update(level=0, level_at=now)
        self.pet.refresh_from_db()
        self.assertEqual(mood(self.pet, now), "sick")

    def test_reminders_once_a_day_and_opt_out(self):
        from unittest import mock
        from .models import Pet
        from .pets import send_reminders
        Pet.objects.filter(id=self.pet.id).update(owner_cared_at=timezone.now() - timedelta(hours=26))
        with mock.patch("chat.fcm.notify_profiles") as push:
            self.assertEqual(send_reminders(), 1)
            self.assertEqual(push.call_args.kwargs["extra"]["kind"], "pet")
            # В тот же день повторно — нет.
            self.assertEqual(send_reminders(), 0)
        self.pet.refresh_from_db()
        self.assertEqual(self.pet.reminders, 1)
        # Хозяин поухаживал — счётчик сброшен, напоминаний нет.
        self.care(self.owner)
        self.pet.refresh_from_db()
        self.assertEqual(self.pet.reminders, 0)
        # Выключил напоминания — не шлём.
        from .models import Profile
        Profile.objects.filter(id=self.owner.id).update(notify_pet=False)
        Pet.objects.filter(id=self.pet.id).update(owner_cared_at=timezone.now() - timedelta(days=3), reminded_at=None)
        with mock.patch("chat.fcm.notify_profiles"):
            self.assertEqual(send_reminders(), 0)

    def test_name(self):
        r = client_for(self.owner).patch("/api/pets/mine/", {"name": "  Барсик  "}, format="json")
        self.assertEqual(r.data["pet"]["name"], "Барсик")
        self.assertEqual(client_for(self.owner).patch("/api/pets/mine/", {"name": "  "}, format="json").status_code, 400)
        self.assertEqual(client_for(self.guest).patch("/api/pets/mine/", {"name": "x"}, format="json").status_code, 404)
        self.assertEqual(client_for(self.guest).get(f"/api/pets/of/{self.owner.id}/").data["pet"]["name"], "Барсик")

    def test_color(self):
        r = client_for(self.owner).patch("/api/pets/mine/", {"color": "ginger"}, format="json")
        self.assertEqual(r.data["pet"]["color"], "ginger")
        self.assertEqual(client_for(self.guest).get(f"/api/pets/of/{self.owner.id}/").data["pet"]["color"], "ginger")
        for bad in ("Рыжий", "a" * 25, "<b>"):
            self.assertEqual(client_for(self.owner).patch("/api/pets/mine/", {"color": bad}, format="json").status_code, 400)
        self.assertEqual(client_for(self.owner).patch("/api/pets/mine/", {"color": ""}, format="json").data["pet"]["color"], "")

    def _chat(self, *who, kind="direct", name=""):
        from .models import Chat, ChatParticipant
        chat = Chat.objects.create(kind=kind, is_group=kind == "group", name=name)
        for p in who:
            ChatParticipant.objects.create(chat=chat, user=p)
        return chat

    def test_call_into_chat_and_home(self):
        dm = self._chat(self.owner, self.guest)
        other = self._chat(self.owner, make_user("pet_third"))
        stranger = make_user("pet_stranger")
        foreign = self._chat(self.guest, stranger)
        channel = self._chat(self.owner, kind="channel", name="Канал")
        mine = lambda: client_for(self.owner).patch  # noqa: E731
        # Дома: ни в одном чате, в списке «где питомцы» пусто.
        self.assertIsNone(client_for(self.owner).get(f"/api/pets/of/{self.owner.id}/").data["pet"]["chat"])
        self.assertEqual(client_for(self.guest).get("/api/pets/here/").data["pets"], [])
        # Позвать в личный чат: виден обоим, у хозяина — название (собеседник).
        r = mine()("/api/pets/mine/", {"chat_id": str(dm.id)}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["pet"]["chat"], {"id": str(dm.id), "title": "pet_guest"})
        self.assertEqual([p["chat_id"] for p in client_for(self.guest).get("/api/pets/here/").data["pets"]], [str(dm.id)])
        self.assertEqual(len(client_for(self.guest).get(f"/api/pets/?chat={dm.id}").data["pets"]), 1)
        self.assertEqual(client_for(self.owner).get(f"/api/pets/?chat={other.id}").data["pets"], [])
        # Не участник чата питомца не видит; старый запрос сборки 952 — пусто.
        self.assertEqual(client_for(stranger).get(f"/api/pets/?chat={dm.id}").data["pets"], [])
        self.assertEqual(client_for(stranger).get("/api/pets/here/").data["pets"], [])
        self.assertEqual(client_for(self.guest).get(f"/api/pets/?owners={self.owner.id}").data["pets"], [])
        # Нельзя: чужой чат, канал, мусор; чужого питомца не позвать.
        for bad in (str(foreign.id), str(channel.id), "nope"):
            self.assertEqual(mine()("/api/pets/mine/", {"chat_id": bad}, format="json").status_code, 400, bad)
        self.assertEqual(client_for(self.guest).patch("/api/pets/mine/", {"chat_id": str(dm.id)}, format="json").status_code, 404)
        # Перешёл в другой чат — из первого ушёл.
        mine()("/api/pets/mine/", {"chat_id": str(other.id)}, format="json")
        self.assertEqual(client_for(self.guest).get("/api/pets/here/").data["pets"], [])
        self.assertEqual(len(client_for(self.owner).get(f"/api/pets/?chat={other.id}").data["pets"]), 1)
        # Домой.
        r = mine()("/api/pets/mine/", {"chat_id": None}, format="json")
        self.assertIsNone(r.data["pet"]["chat"])
        self.assertEqual(client_for(self.owner).get("/api/pets/here/").data["pets"], [])
        # Чат удалили — питомец сам дома.
        mine()("/api/pets/mine/", {"chat_id": str(dm.id)}, format="json")
        dm.delete()
        self.pet.refresh_from_db()
        self.assertIsNone(self.pet.chat_id)

    def test_group_pet_limit(self):
        from .models import Pet
        others = [make_user(f"pet_g{i}") for i in range(4)]
        for i, o in enumerate(others):
            Pet.objects.create(owner=o, name=f"Кот{i}")
        group = self._chat(self.owner, self.guest, *others, kind="group", name="Котики")
        group.creator = self.owner
        group.save(update_fields=["creator"])
        call = lambda who: client_for(who).patch("/api/pets/mine/", {"chat_id": str(group.id)}, format="json")  # noqa: E731
        self.assertEqual(group.pet_limit, 3)
        for o in others[:3]:
            self.assertEqual(call(o).status_code, 200)
        r = call(others[3])
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.data["code"], "pets_full")
        self.assertEqual(r.data["limit"], 3)
        self.assertEqual([p["name"] for p in r.data["pets"]], ["Кот0", "Кот1", "Кот2"])
        # Тот, кто уже здесь, позвать себя ещё раз может (мест не занимает).
        self.assertEqual(call(others[0]).status_code, 200)
        # Лимит меняет только владелец группы.
        self.assertEqual(client_for(self.guest).post(f"/api/chats/{group.id}/configure/", {"pet_limit": 5}, format="json").status_code, 403)
        # Уменьшил до 2 — ушёл пришедший последним.
        r = client_for(self.owner).post(f"/api/chats/{group.id}/configure/", {"pet_limit": 2}, format="json")
        self.assertEqual(r.data["pet_limit"], 2)
        here = list(Pet.objects.filter(chat=group).order_by("chat_at").values_list("name", flat=True))
        self.assertEqual(here, ["Кот0", "Кот1"])
        # Владелец группы отправляет домой чужого, участник — нет, хозяин — своего.
        kot0 = Pet.objects.get(name="Кот0")
        self.assertEqual(client_for(self.guest).post(f"/api/pets/{kot0.id}/home/").status_code, 403)
        self.assertEqual(client_for(self.owner).post(f"/api/pets/{kot0.id}/home/").status_code, 200)
        kot1 = Pet.objects.get(name="Кот1")
        self.assertEqual(client_for(others[1]).post(f"/api/pets/{kot1.id}/home/").status_code, 200)
        self.assertFalse(Pet.objects.filter(chat=group).exists())
        # 0 — выключены: не позвать, а кто был — дома.
        call(others[2])
        client_for(self.owner).post(f"/api/chats/{group.id}/configure/", {"pet_limit": 0}, format="json")
        self.assertFalse(Pet.objects.filter(chat=group).exists())
        r = call(others[2])
        self.assertEqual((r.status_code, r.data["code"]), (409, "pets_off"))
        # Потолок — 10, мусор — 400.
        self.assertEqual(client_for(self.owner).post(f"/api/chats/{group.id}/configure/", {"pet_limit": 99}, format="json").data["pet_limit"], 10)
        self.assertEqual(client_for(self.owner).post(f"/api/chats/{group.id}/configure/", {"pet_limit": "x"}, format="json").status_code, 400)
        # В личном чате лимита нет.
        dm = self._chat(self.owner, others[3])
        self.assertEqual(client_for(others[3]).patch("/api/pets/mine/", {"chat_id": str(dm.id)}, format="json").status_code, 200)

    def test_look_sex_accessories_species(self):
        from unittest import mock
        from datetime import timedelta
        from django.utils import timezone
        from .models import Pet
        mine = lambda d: client_for(self.owner).patch("/api/pets/mine/", d, format="json")  # noqa: E731
        r = mine({"accessories": ["bow_tie"]})
        self.assertEqual((r.data["pet"]["sex"], r.data["pet"]["accessories"]), ("m", ["bow_tie"]))
        # Сменил пол — украшения по умолчанию для пола (null).
        r = mine({"sex": "f"})
        self.assertEqual((r.data["pet"]["sex"], r.data["pet"]["accessories"]), ("f", None))
        self.assertEqual(mine({"accessories": ["bow_head", "bow_head"]}).data["pet"]["accessories"], ["bow_head"])
        self.assertIsNone(mine({"accessories": None}).data["pet"]["accessories"])
        for bad in ({"sex": "x"}, {"accessories": "bow"}, {"accessories": ["<b>"]}, {"accessories": [""]}, {"accessories": ["a"] * 9}):
            self.assertEqual(mine(bad).status_code, 400, bad)
        # Вид меняет только админ; сменил — украшения по умолчанию.
        self.assertEqual(mine({"species": "rabbit"}).status_code, 403)
        admin = make_user("pet_admin", role="admin")
        Pet.objects.create(owner=admin, species="cat", accessories=["bow_tie"])
        r = client_for(admin).patch("/api/pets/mine/", {"species": "rabbit"}, format="json")
        self.assertEqual((r.data["pet"]["species"], r.data["pet"]["accessories"]), ("rabbit", None))
        self.assertEqual(client_for(admin).patch("/api/pets/mine/", {"species": "dragon"}, format="json").status_code, 400)
        # Напоминание по виду и полу: кролик-девочка проголодалась и подгрызает.
        self.pet.refresh_from_db()
        Pet.objects.filter(id=self.pet.id).update(species="rabbit", sex="f", level=40, level_at=timezone.now(),
                                                  last_petted_at=timezone.now(), last_fed_at=timezone.now() - timedelta(days=3),
                                                  owner_cared_at=timezone.now() - timedelta(days=2), created_at=timezone.now() - timedelta(days=5))
        with mock.patch("chat.fcm.notify_profiles") as push:
            from .pets import send_reminders
            send_reminders()
        bodies = [str(c.kwargs["body"]) for c in push.call_args_list]
        self.assertTrue(any("проголодалась и подгрызает" in b for b in bodies), bodies)

    def test_vibe_history_shows_care(self):
        self.care(self.guest, "feed")
        items = client_for(self.guest).get("/api/vibe/history/").data["items"]
        self.assertEqual(items[0]["kind"], "pet_care")
        self.assertEqual(items[0]["pet"], "Мистер Кот")
        self.assertEqual(items[0]["who"]["username"], "pet_owner")
