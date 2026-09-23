"""Тестовый музыкальный бот поверх VK Audio API.

Модуль намеренно не получает токены и cookies сам. Он работает только с
``VK_AUDIO_TOKEN`` из окружения и выключен по умолчанию. Доступность методов
``audio.*`` зависит от типа токена и прав приложения: обычный service token
получит ошибку VK 28.

Сценарий без специальных кнопок клиента:

* пользователь пишет запрос в личный чат с системным ботом;
* бот возвращает нумерованный список из десяти записей;
* пользователь отвечает номером;
* разрешённая пользователем запись сохраняется в S3/локальное media и
  отправляется обычным аудиосообщением Hyax.

Это диагностический MVP, а не обещание доступности публичного Audio API VK.
Использовать его следует только для собственных или разрешённых записей.
"""
from __future__ import annotations

import logging
import os
import re
import subprocess
import threading
import uuid
from dataclasses import asdict, dataclass
from pathlib import Path
from urllib.parse import urlparse

import httpx
from django.conf import settings
from django.contrib.auth.models import User
from django.core.cache import cache
from django.db import close_old_connections

from .models import ChatParticipant, Message, Profile
from .s3 import s3_enabled, upload_file as s3_upload

logger = logging.getLogger(__name__)

TRUE_VALUES = {"1", "true", "yes", "on"}
SEARCH_LIMIT = 10
SEARCH_TTL = 20 * 60
MAX_AUDIO_BYTES = 80 * 1024 * 1024
ALLOWED_AUDIO_HOST_SUFFIXES = (
    ".vkuseraudio.net",
    ".userapi.com",
    ".vk-cdn.net",
    ".vk.com",
)


def music_bot_enabled() -> bool:
    return os.getenv("VK_MUSIC_BOT_ENABLED", "").strip().lower() in TRUE_VALUES


def music_bot_username() -> str:
    return (os.getenv("VK_MUSIC_BOT_USERNAME") or "vk_music").strip()[:150]


class VkAudioError(RuntimeError):
    def __init__(self, message: str, *, code: int | None = None):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class VkTrack:
    owner_id: int
    id: int
    artist: str
    title: str
    duration: int = 0
    url: str = ""
    access_key: str = ""

    @classmethod
    def from_vk(cls, row: dict) -> "VkTrack":
        return cls(
            owner_id=int(row.get("owner_id") or 0),
            id=int(row.get("id") or 0),
            artist=str(row.get("artist") or "Неизвестный исполнитель")[:200],
            title=str(row.get("title") or "Без названия")[:200],
            duration=int(row.get("duration") or 0),
            url=str(row.get("url") or ""),
            access_key=str(row.get("access_key") or ""),
        )

    @classmethod
    def from_cache(cls, row: dict) -> "VkTrack":
        return cls(**row)

    @property
    def raw_id(self) -> str:
        value = f"{self.owner_id}_{self.id}"
        return f"{value}_{self.access_key}" if self.access_key else value


class VkAudioClient:
    def __init__(self, token: str | None = None, api_version: str | None = None):
        self.token = (token or os.getenv("VK_AUDIO_TOKEN") or "").strip()
        self.api_version = (api_version or os.getenv("VK_AUDIO_API_VERSION") or "5.131").strip()

    def _call(self, method: str, **params):
        if not self.token:
            raise VkAudioError("На сервере не задан VK_AUDIO_TOKEN")
        query = {"access_token": self.token, "v": self.api_version, **params}
        try:
            response = httpx.get(
                f"https://api.vk.com/method/{method}",
                params=query,
                timeout=15.0,
                follow_redirects=False,
            )
            response.raise_for_status()
            payload = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise VkAudioError(f"VK не ответил корректно: {exc}") from exc

        error = payload.get("error") if isinstance(payload, dict) else None
        if error:
            code = int(error.get("error_code") or 0)
            message = str(error.get("error_msg") or "Неизвестная ошибка VK")
            raise VkAudioError(message, code=code)
        if not isinstance(payload, dict) or "response" not in payload:
            raise VkAudioError("VK вернул ответ без поля response")
        return payload["response"]

    def search(self, query: str, *, offset: int = 0, count: int = SEARCH_LIMIT) -> list[VkTrack]:
        response = self._call(
            "audio.search",
            q=query,
            offset=max(0, offset),
            count=max(1, min(count, 50)),
            auto_complete=1,
            sort=2,
        )
        rows = response.get("items", []) if isinstance(response, dict) else []
        return [VkTrack.from_vk(row) for row in rows if row.get("owner_id") and row.get("id")]

    def get_by_id(self, track: VkTrack) -> VkTrack:
        response = self._call("audio.getById", audios=track.raw_id)
        if not isinstance(response, list) or not response:
            raise VkAudioError("VK не вернул выбранную аудиозапись")
        resolved = VkTrack.from_vk(response[0])
        if not resolved.url:
            raise VkAudioError("VK не выдал ссылку на аудиозапись: возможно, она ограничена правообладателем")
        return resolved


def ensure_music_bot(*, force: bool = False) -> Profile | None:
    """Создаёт системного бота. Без флага функция ничего не меняет."""
    if not force and not music_bot_enabled():
        return None
    username = music_bot_username()
    bot = Profile.objects.filter(username=username, is_bot=True).first()
    if bot:
        return bot
    if Profile.objects.filter(username=username).exists() or User.objects.filter(username=username).exists():
        raise RuntimeError(f"Имя системного бота @{username} уже занято")
    user = User.objects.create(username=username, email=f"{username}@bot.local", is_active=True)
    user.set_unusable_password()
    user.save(update_fields=["password"])
    return Profile.objects.create(
        user=user,
        username=username,
        is_bot=True,
        bio="Поиск собственных и разрешённых аудиозаписей в VK. Напишите название трека.",
    )


def _state_key(chat_id) -> str:
    return f"vk-music-search:{chat_id}"


def _friendly_error(exc: VkAudioError) -> str:
    if exc.code == 28:
        return (
            "VK отклонил токен: методы audio.* недоступны с service token (ошибка 28). "
            "Нужен пользовательский токен приложения, которому VK разрешил Audio API."
        )
    if exc.code in (5, 27):
        return "VK отклонил авторизацию. Проверьте VK_AUDIO_TOKEN и права приложения."
    if exc.code == 15:
        return "VK запретил доступ к этой аудиозаписи."
    return f"Ошибка VK{f' {exc.code}' if exc.code else ''}: {exc}"


def _send_bot_message(chat, bot, *, content: str = "", file_url: str | None = None,
                      file_name: str | None = None, file_size: int | None = None) -> Message:
    message = Message.objects.create(
        chat=chat,
        sender=bot,
        content=content,
        file_url=file_url,
        file_name=file_name,
        file_size=file_size,
    )
    # Локальный импорт исключает цикл при загрузке views.py и даёт тому же
    # сообщению WebSocket/push-путь, что и обычной отправке пользователя.
    from .views import _notify_new_message
    _notify_new_message(message, bot, None)
    return message


def _is_vk_audio_url(value: str) -> bool:
    parsed = urlparse(value)
    host = (parsed.hostname or "").lower()
    return parsed.scheme == "https" and any(host == suffix[1:] or host.endswith(suffix)
                                             for suffix in ALLOWED_AUDIO_HOST_SUFFIXES)


def _safe_file_part(value: str) -> str:
    value = re.sub(r"[\\/:*?\"<>|\x00-\x1f]+", " ", value)
    value = re.sub(r"\s+", " ", value).strip(" .")
    return (value or "track")[:100]


def _download_audio(url: str, target: Path) -> None:
    """Получает как HLS, так и прямые ссылки и всегда создаёт настоящий MP3."""
    try:
        subprocess.run(
            [
                "ffmpeg", "-nostdin", "-y", "-loglevel", "error",
                "-protocol_whitelist", "http,https,tcp,tls,crypto",
                "-headers", "Referer: https://vk.com/\r\nUser-Agent: Mozilla/5.0\r\n",
                "-i", url, "-vn", "-c:a", "libmp3lame", "-b:a", "192k", str(target),
            ],
            check=True,
            timeout=180,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
    except FileNotFoundError as exc:
        raise VkAudioError("На сервере не установлен ffmpeg") from exc
    except subprocess.TimeoutExpired as exc:
        raise VkAudioError("VK слишком долго отдавал аудиопоток") from exc
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or b"").decode("utf-8", "ignore")[-300:]
        raise VkAudioError(f"ffmpeg не смог получить поток VK: {detail or 'неизвестная ошибка'}") from exc
    if not target.exists() or target.stat().st_size == 0:
        raise VkAudioError("После обработки получился пустой аудиофайл")
    if target.stat().st_size > MAX_AUDIO_BYTES:
        raise VkAudioError("Аудиофайл больше тестового лимита 80 МБ")


def download_track(track: VkTrack) -> tuple[str, str, int]:
    if not _is_vk_audio_url(track.url):
        raise VkAudioError("VK вернул ссылку на неподдерживаемом домене")
    rel = Path("messages") / "vk" / f"{track.owner_id}_{track.id}_{uuid.uuid4().hex[:8]}.mp3"
    target = Path(settings.MEDIA_ROOT) / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        _download_audio(track.url, target)
        size = target.stat().st_size
        filename = f"{_safe_file_part(track.artist)} — {_safe_file_part(track.title)}.mp3"
        if s3_enabled():
            marker = s3_upload(str(target), rel.as_posix(), "audio/mpeg")
            target.unlink(missing_ok=True)
            return marker, filename, size
        return f"/media/{rel.as_posix()}", filename, size
    except Exception:
        target.unlink(missing_ok=True)
        raise


def _show_results(message: Message, bot: Profile, query: str) -> None:
    tracks = VkAudioClient().search(query, count=SEARCH_LIMIT)
    if not tracks:
        _send_bot_message(message.chat, bot, content="Ничего не найдено. Попробуйте другой запрос.")
        return
    cache.set(_state_key(message.chat_id), [asdict(track) for track in tracks], SEARCH_TTL)
    lines = [f"Нашёл по запросу «{query}»:" ]
    for index, track in enumerate(tracks, 1):
        duration = f" · {track.duration // 60}:{track.duration % 60:02d}" if track.duration else ""
        lines.append(f"{index}. {track.artist} — {track.title}{duration}")
    lines.append("\nОтветьте номером. Импортируйте только записи, на которые у вас есть права.")
    _send_bot_message(message.chat, bot, content="\n".join(lines))


def _send_selected(message: Message, bot: Profile, selected: int, rows: list[dict]) -> None:
    if selected < 1 or selected > len(rows):
        _send_bot_message(message.chat, bot, content=f"Введите номер от 1 до {len(rows)}.")
        return
    track = VkTrack.from_cache(rows[selected - 1])
    _send_bot_message(message.chat, bot, content=f"Получаю: {track.artist} — {track.title}…")
    resolved = VkAudioClient().get_by_id(track)
    file_url, file_name, file_size = download_track(resolved)
    _send_bot_message(
        message.chat,
        bot,
        content=f"{resolved.artist} — {resolved.title}",
        file_url=file_url,
        file_name=file_name,
        file_size=file_size,
    )


def process_message(message_id) -> None:
    """Синхронная логика одного сообщения; вынесена отдельно для тестов."""
    message = Message.objects.select_related("chat", "sender").filter(id=message_id).first()
    if not message or not message.sender or message.sender.is_bot or message.chat.kind != "direct":
        return
    bot = Profile.objects.filter(username=music_bot_username(), is_bot=True).first()
    if not bot or not ChatParticipant.objects.filter(chat=message.chat, user=bot).exists():
        return
    text = (message.content or "").strip()
    if not text:
        return
    try:
        if text.lower() in ("/start", "/help", "help", "помощь"):
            _send_bot_message(
                message.chat,
                bot,
                content=("Напишите исполнителя и название. Я покажу до 10 результатов VK; "
                         "затем ответьте номером нужного трека."),
            )
            return
        rows = cache.get(_state_key(message.chat_id)) or []
        if text.isdigit() and rows:
            _send_selected(message, bot, int(text), rows)
        else:
            _show_results(message, bot, text[:200])
    except VkAudioError as exc:
        logger.warning("VK music bot: %s (code=%s)", exc, exc.code)
        _send_bot_message(message.chat, bot, content=_friendly_error(exc))
    except Exception:
        logger.exception("VK music bot failed")
        _send_bot_message(message.chat, bot, content="Не удалось обработать запрос. Ошибка записана на сервере.")


def maybe_handle_message(message: Message) -> None:
    """Запускает обработку только для включённого системного VK-бота."""
    if not music_bot_enabled() or not message.sender or message.sender.is_bot:
        return
    bot = Profile.objects.filter(username=music_bot_username(), is_bot=True).only("id").first()
    if not bot or not ChatParticipant.objects.filter(chat=message.chat, user=bot).exists():
        return

    def run():
        close_old_connections()
        try:
            process_message(message.id)
        finally:
            close_old_connections()

    threading.Thread(target=run, daemon=True, name=f"vk-music-{message.id}").start()
