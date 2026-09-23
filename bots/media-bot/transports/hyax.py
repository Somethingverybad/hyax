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
import hashlib
import json
import logging
import mimetypes
import os
import shutil
import tempfile

import aiohttp

from core.download import Media, fetch, find_url, fmt_duration, safe_name, search

log = logging.getLogger("media-bot.hyax")

API = os.getenv("HYAX_API", "http://api:8000/api").rstrip("/")
WS = os.getenv("HYAX_WS", "ws://api:8000/ws").rstrip("/")
TOKEN = os.getenv("HYAX_BOT_TOKEN", "").strip()
DEFAULT_MODE = os.getenv("HYAX_QUALITY", "720").strip()
# Сколько ссылок качаем одновременно: yt-dlp и ffmpeg жадны до диска и сети.
LIMIT = asyncio.Semaphore(int(os.getenv("HYAX_PARALLEL", "2")))

HELP = (
    "Пришлите ссылку — предложу, что скачать: mp3 или видео в нужном качестве.\n"
    "Напишите название — найду на YouTube и покажу, из чего выбрать.\n\n"
    "YouTube, TikTok, Instagram и всё, что умеет yt-dlp.\n\n"
    "Команды:\n"
    "/audio <ссылка> — сразу mp3, без вопросов\n"
    "/video <ссылка> — сразу видео\n"
    "/help — это сообщение"
)

#: Что предлагаем кнопками. mp3 первым: чаще всего нужен именно он.
CHOICES = (("mp3", "🎵 MP3"), ("1080", "1080p"), ("720", "720p"), ("480", "480p"), ("360", "360p"))

#: Ссылки под кнопками: в data лезет только короткий ключ, сама ссылка живёт
#: здесь. Память чистим по размеру — бот не хранилище.
LINKS: dict[str, str] = {}
LINKS_MAX = 500


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

    async def send_text(self, chat_id: str, text: str, buttons: list | None = None) -> None:
        payload = {"chat": chat_id, "content": text}
        if buttons:
            payload["buttons"] = buttons
        await self.s.post(f"{API}/messages/", headers=_headers(), json=payload)

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


def remember(url: str) -> str:
    """Короткий ключ для ссылки: в кнопку помещается 128 символов, а ссылки
    бывают длиннее — и светить их в data незачем."""
    key = hashlib.sha1(url.encode()).hexdigest()[:12]
    LINKS[key] = url
    if len(LINKS) > LINKS_MAX:
        for old in list(LINKS)[: LINKS_MAX // 2]:
            LINKS.pop(old, None)
    return key


def choice_rows(key: str) -> list[list[dict]]:
    """Кнопки выбора: mp3 отдельной строкой, качества — по две в ряд."""
    rows = [[{"text": CHOICES[0][1], "data": f"dl|mp3|{key}"}]]
    rest = [{"text": t, "data": f"dl|{m}|{key}"} for m, t in CHOICES[1:]]
    rows += [rest[i:i + 2] for i in range(0, len(rest), 2)]
    return rows


async def offer(hx: Hyax, chat_id: str, url: str, title: str = "") -> None:
    """Предложить, в каком виде скачать."""
    key = remember(url)
    head = f"«{title}»\n" if title else ""
    await hx.send_text(chat_id, f"{head}Что скачать?", buttons=choice_rows(key))


async def do_search(hx: Hyax, chat_id: str, query: str) -> None:
    """Поиск по названию: результаты кнопками, нажатие ведёт к выбору формата."""
    await hx.send_text(chat_id, f"Ищу «{query}»…")
    try:
        found = await asyncio.to_thread(search, query, 5)
    except Exception as e:
        log.exception("поиск не удался")
        await hx.send_text(chat_id, f"Поиск не вышел: {str(e)[:150]}")
        return
    if not found:
        await hx.send_text(chat_id, "Ничего не нашлось. Попробуйте иначе или пришлите ссылку.")
        return
    rows = []
    for i, item in enumerate(found, 1):
        dur = fmt_duration(item["duration"])
        label = f"{i}. {item['title'][:44]}" + (f" · {dur}" if dur else "")
        rows.append([{"text": label, "data": f"pick|{remember(item['url'])}"}])
    await hx.send_text(chat_id, f"Нашёл по запросу «{query}»:", buttons=rows)


async def download_and_send(hx: Hyax, chat_id: str, url: str, mode: str) -> None:
    await hx.send_text(chat_id, "Качаю…" if mode != "mp3" else "Достаю звук…")
    out_dir = tempfile.mkdtemp(prefix="media-bot-")
    try:
        async with LIMIT:
            media = await asyncio.to_thread(fetch, url, "audio" if mode == "mp3" else mode, out_dir)
        await hx.send_media(chat_id, media)
    except Exception as e:
        log.exception("не вышло скачать %s", url)
        await hx.send_text(chat_id, f"Не получилось: {str(e)[:200]}")
    finally:
        shutil.rmtree(out_dir, ignore_errors=True)


async def on_button(hx: Hyax, chat_id: str, data: str) -> None:
    """Нажали кнопку: «dl|<формат>|<ключ>» или «pick|<ключ>»."""
    parts = data.split("|")
    if parts[0] == "pick" and len(parts) == 2:
        url = LINKS.get(parts[1])
        if not url:
            await hx.send_text(chat_id, "Эта находка устарела — поищите заново.")
            return
        await offer(hx, chat_id, url)
        return
    if parts[0] == "dl" and len(parts) == 3:
        url = LINKS.get(parts[2])
        if not url:
            await hx.send_text(chat_id, "Ссылка устарела — пришлите её заново.")
            return
        await download_and_send(hx, chat_id, url, parts[1])


async def handle(hx: Hyax, chat_id: str, text: str) -> None:
    """Разобрать сообщение и ответить файлом."""
    body = (text or "").strip()
    if body in ("/start", "/help"):
        await hx.send_text(chat_id, HELP)
        return

    # Команды с явным форматом: без вопросов, сразу качаем.
    direct = None
    if body.startswith("/audio"):
        direct, body = "mp3", body[len("/audio"):]
    elif body.startswith("/video"):
        direct, body = DEFAULT_MODE, body[len("/video"):]

    url = find_url(body)
    if url:
        if direct:
            await download_and_send(hx, chat_id, url, direct)
        else:
            await offer(hx, chat_id, url)
        return

    query = body.lstrip("/").strip()
    if len(query) < 2:
        await hx.send_text(chat_id, "Пришлите ссылку или напишите название — найду.")
        return
    await do_search(hx, chat_id, query)


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
            if body.get("type") == "button":
                chat_id = body.get("chat_id")
                if chat_id:
                    asyncio.create_task(on_button(hx, str(chat_id), body.get("data") or ""))
                continue
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
