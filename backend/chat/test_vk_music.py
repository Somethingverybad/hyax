from unittest.mock import Mock, patch

from django.core.cache import cache
from django.test import SimpleTestCase, TestCase

from .models import Chat, ChatParticipant, Message
from .tests import make_user
from .vk_music import (
    VkAudioClient,
    VkAudioError,
    VkTrack,
    _is_vk_audio_url,
    ensure_music_bot,
    process_message,
)


class VkAudioClientTests(SimpleTestCase):
    @patch("chat.vk_music.httpx.get")
    def test_search_normalizes_response(self, get):
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {
            "response": {
                "count": 1,
                "items": [{
                    "owner_id": 7,
                    "id": 9,
                    "artist": "Artist",
                    "title": "Track",
                    "duration": 123,
                }],
            },
        }
        get.return_value = response

        tracks = VkAudioClient(token="secret").search("query")

        self.assertEqual(tracks, [VkTrack(7, 9, "Artist", "Track", 123)])
        called = get.call_args.kwargs
        self.assertEqual(called["params"]["q"], "query")
        self.assertEqual(called["params"]["access_token"], "secret")

    @patch("chat.vk_music.httpx.get")
    def test_vk_error_is_preserved(self, get):
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {"error": {"error_code": 28, "error_msg": "method unavailable"}}
        get.return_value = response

        with self.assertRaises(VkAudioError) as caught:
            VkAudioClient(token="secret").search("query")
        self.assertEqual(caught.exception.code, 28)

    def test_download_host_allowlist(self):
        self.assertTrue(_is_vk_audio_url("https://psv4.vkuseraudio.net/a.mp3"))
        self.assertTrue(_is_vk_audio_url("https://cs1.userapi.com/a.mp3"))
        self.assertFalse(_is_vk_audio_url("http://psv4.vkuseraudio.net/a.mp3"))
        self.assertFalse(_is_vk_audio_url("https://vkuseraudio.net.evil.example/a.mp3"))


class VkMusicBotFlowTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = make_user("listener")
        self.bot = ensure_music_bot(force=True)
        self.chat = Chat.objects.create(kind="direct")
        ChatParticipant.objects.create(chat=self.chat, user=self.user)
        ChatParticipant.objects.create(chat=self.chat, user=self.bot)

    @patch("chat.views._notify_new_message")
    @patch("chat.vk_music.VkAudioClient.search")
    def test_query_returns_numbered_results(self, search, _notify):
        search.return_value = [VkTrack(7, 9, "Artist", "Track", 123)]
        incoming = Message.objects.create(chat=self.chat, sender=self.user, content="Artist Track")

        process_message(incoming.id)

        reply = Message.objects.filter(chat=self.chat, sender=self.bot).latest("created_at")
        self.assertIn("1. Artist — Track · 2:03", reply.content)
        self.assertIn("Ответьте номером", reply.content)

    @patch("chat.views._notify_new_message")
    @patch("chat.vk_music.download_track")
    @patch("chat.vk_music.VkAudioClient.get_by_id")
    @patch("chat.vk_music.VkAudioClient.search")
    def test_number_sends_audio_message(self, search, get_by_id, download, _notify):
        track = VkTrack(7, 9, "Artist", "Track", 123)
        search.return_value = [track]
        get_by_id.return_value = VkTrack(
            7, 9, "Artist", "Track", 123,
            "https://psv4.vkuseraudio.net/track.mp3",
        )
        download.return_value = ("s3://messages/vk/track.mp3", "Artist — Track.mp3", 1000)
        query = Message.objects.create(chat=self.chat, sender=self.user, content="Artist Track")
        process_message(query.id)

        choice = Message.objects.create(chat=self.chat, sender=self.user, content="1")
        process_message(choice.id)

        audio = Message.objects.filter(chat=self.chat, sender=self.bot, file_url__isnull=False).get()
        self.assertEqual(audio.file_url, "s3://messages/vk/track.mp3")
        self.assertEqual(audio.file_name, "Artist — Track.mp3")
        self.assertEqual(audio.file_size, 1000)
