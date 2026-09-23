"""Бот для хуякса: ссылка в чат — файл в ответ.

Бот живёт как обычный аккаунт с пометкой «бот»: ходит в то же API, что и
приложение, только авторизуется заголовком «Authorization: Bot <токен>»
(см. backend/chat/bot_auth.py). Отдельного протокола у ботов нет и не нужно.

Сообщения слушаем личным сокетом — тем же, которым их получает приложение.
Опрос оставлен страховкой на случай оборванной связи.

Файл отдаём обычной загрузкой одним запросом: бот стоит рядом с сервером, и
ограничение шлюза, ради которого в приложении сделана загрузка кусками, здесь
не мешает.
"""
from __future__ import annotations

import asyncio
import json
import logging
import mimetypes
import os
import shutil
import tempfile

import aiohttp

from core.download import Media, fetch, find_url, safe_name

log = logging.getLogger("media-bot.hyax")

API = os.getenv("HYAX_API", "http://api:8000/api").rstrip("/")
WS = os.getenv("HYAX_WS", "ws://api:8000/ws").rstrip("/")
TOKEN = os.getenv("HYAX_BOT_TOKEN", "").strip()
DEFAULT_MODE = os.getenv("HYAX_QUALITY", "720").strip()
# Сколько ссылок качаем одновременно: yt-dlp и ffmpeg жадны до диска и сети.
LIMIT = asyncio.Semaphore(int(os.getenv("HYAX_PARALLEL", "2")))

HELP = (
    "Пришлите ссылку — верну файл.\n"
    "YouTube, TikTok, Instagram и всё, что умеет yt-dlp.\n\n"
    "Команды:\n"
    "/audio <ссылка> — только звук, mp3\n"
    "/video <ссылка> — видео (по умолчанию)\n"
    "/help — это сообщение"
)


def _headers() -> dict:
    return {"Authorization": f"Bot {TOKEN}"}


class Hyax:
    def __init__(self, session: aiohttp.ClientSession):
        self.s = session
        self.me: dict = {}

    async def whoami(self) -> dict:
        async with self.s.get(f"{API}/profiles/current/", headers=_headers()) as r:
            r.raise_for_status()
            self.me = await r.json()
            return self.me

    async def send_text(self, chat_id: str, text: str) -> None:
        await self.s.post(f"{API}/messages/", headers=_headers(),
                          json={"chat": chat_id, "content": text})

    async def upload(self, path: str, name: str) -> dict:
        """Загрузить файл и получить его адрес на сервере."""
        data = aiohttp.FormData()
        ctype = mimetypes.guess_type(name)[0] or "application/octet-stream"
        with open(path, "rb") as fh:
            data.add_field("file", fh, filename=name, content_type=ctype)
            async with self.s.post(f"{API}/upload/", headers=_headers(), data=data) as r:
                r.raise_for_status()
                return await r.json()

    async def send_media(self, chat_id: str, media: Media) -> None:
        ext = ".mp3" if media.is_audio else ".mp4"
        name = safe_name(media.title, ext)
        up = await self.upload(media.path, name)
        payload = {
            "chat": chat_id,
            "content": "",
            "file_url": up.get("file_url"),
            "file_name": name,
        }
        if not media.is_audio and media.width and media.height:
            payload["file_width"] = media.width
            payload["file_height"] = media.height
        await self.s.post(f"{API}/messages/", headers=_headers(), json=payload)


async def handle(hx: Hyax, chat_id: str, text: str) -> None:
    """Разобрать сообщение и ответить файлом."""
    body = (text or "").strip()
    if body in ("/start", "/help"):
        await hx.send_text(chat_id, HELP)
        return

    mode = DEFAULT_MODE
    if body.startswith("/audio"):
        mode, body = "audio", body[len("/audio"):]
    elif body.startswith("/video"):
        body = body[len("/video"):]

    url = find_url(body)
    if not url:
        await hx.send_text(chat_id, "Не вижу ссылки. Пришлите ссылку на видео или /help.")
        return

    await hx.send_text(chat_id, "Качаю…")
    out_dir = tempfile.mkdtemp(prefix="media-bot-")
    try:
        async with LIMIT:
            media = await asyncio.to_thread(fetch, url, mode, out_dir)
        await hx.send_media(chat_id, media)
    except Exception as e:
        log.exception("не вышло скачать %s", url)
        await hx.send_text(chat_id, f"Не получилось: {str(e)[:200]}")
    finally:
        shutil.rmtree(out_dir, ignore_errors=True)


async def listen(hx: Hyax) -> None:
    """Личный сокет: те же события, что получает приложение."""
    me_id = hx.me["id"]
    url = f"{WS}/user/{me_id}/?token={TOKEN}"
    async with hx.s.ws_connect(url, heartbeat=30) as ws:
        log.info("на связи как %s", hx.me.get("username"))
        async for msg in ws:
            if msg.type is not aiohttp.WSMsgType.TEXT:
                continue
            try:
                data = json.loads(msg.data)
            except ValueError:
                continue
            body = data.get("data") or {}
            if body.get("type") != "new_message":
                continue
            m = body.get("message") or {}
            sender = (m.get("sender") or {}).get("id")
            if not sender or sender == me_id:
                continue  # своё эхо
            chat_id = body.get("chat_id") or m.get("chat")
            if chat_id:
                asyncio.create_task(handle(hx, str(chat_id), m.get("content") or ""))


async def main() -> None:
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    if not TOKEN:
        raise SystemExit("Нет HYAX_BOT_TOKEN — создайте бота и впишите его токен")
    async with aiohttp.ClientSession() as session:
        hx = Hyax(session)
        while True:
            try:
                await hx.whoami()
                await listen(hx)
                log.warning("сокет закрыт, переподключаюсь")
            except Exception:
                log.exception("сбой связи, повтор через 5 с")
            await asyncio.sleep(5)


if __name__ == "__main__":
    asyncio.run(main())
