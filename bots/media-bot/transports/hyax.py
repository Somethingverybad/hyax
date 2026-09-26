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
COOKIES_DIR = os.getenv("COOKIES_DIR", "").strip()
# Локальные /media/... (без S3) раздаёт nginx, а не api.
MEDIA = os.getenv("HYAX_MEDIA", "http://nginx/media").rstrip("/")
#: Владелец по нику — запас на случай, если сервер ещё не отдаёт bot_owner.
OWNER_USERNAME = os.getenv("HYAX_BOT_OWNER", "").strip().lstrip("@")

HELP = (
    "Пришлите ссылку — предложу, что скачать: mp3 или видео в нужном качестве.\n"
    "Напишите название — найду на YouTube и покажу, из чего выбрать.\n\n"
    "YouTube, TikTok, Instagram и всё, что умеет yt-dlp.\n\n"
    "Команды:\n"
    "/audio <ссылка> — сразу mp3, без вопросов\n"
    "/video <ссылка> — сразу видео\n"
    "/help — это сообщение\n\n"
    "Владельцу: пришлите файл кук (Netscape, youtube.txt) — применю сразу; /cookies — что сейчас загружено."
)

#: Площадка по доменам в файле кук → имя файла в COOKIES_DIR.
COOKIE_SITES = (("youtube", ("youtube.com", "google.com")), ("instagram", ("instagram.com",)), ("tiktok", ("tiktok.com",)))
#: Без этих кук YouTube считает, что входа нет (см. «Please sign in»).
YT_LOGIN_COOKIES = {"SID", "LOGIN_INFO", "__Secure-1PSID"}

#: Что предлагаем кнопками. mp3 первым: чаще всего нужен именно он.
CHOICES = (("mp3", "🎵 MP3"), ("1080", "1080p"), ("720", "720p"), ("480", "480p"), ("360", "360p"))

#: Ссылки под кнопками: в data лезет только короткий ключ, сама ссылка живёт
#: здесь. Память чистим по размеру — бот не хранилище.
LINKS: dict[str, str] = {}
LINKS_MAX = 500

#: Inline: первое слово запроса — формат. «@ytbot mp3 название», «@ytbot 720
#: название»; без формата — mp3. Дальше — название для поиска или ссылка.
INLINE_MODES = {"mp3": "mp3", "audio": "mp3", "музыка": "mp3", "1080": "1080", "720": "720", "480": "480", "360": "360", "video": None, "видео": None}
MODE_LABEL = {"mp3": "MP3", "1080": "1080p", "720": "720p", "480": "480p", "360": "360p"}


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

    def is_owner(self, sender: dict | None) -> bool:
        sender = sender or {}
        oid = self.me.get("bot_owner")
        if oid and str(sender.get("id")) == str(oid):
            return True
        return bool(OWNER_USERNAME) and (sender.get("username") or "").lower() == OWNER_USERNAME.lower()

    async def fetch_file(self, file_url: str, limit: int = 512 * 1024) -> bytes:
        """Скачать вложение сообщения: S3 — по временной подписи, локальное — у nginx."""
        if file_url.startswith("s3://"):
            async with self.s.get(f"{API}/media/sign/", params={"key": file_url[5:]}, headers=_headers()) as r:
                r.raise_for_status()
                url = (await r.json())["url"]
        else:
            url = f"{MEDIA}/{file_url.split('/media/', 1)[-1]}" if "/media/" in file_url else file_url
        async with self.s.get(url) as r:
            r.raise_for_status()
            data = await r.content.read(limit + 1)
            if len(data) > limit:
                raise ValueError("файл слишком большой для кук")
            return data

    async def upload(self, path: str, name: str) -> dict:
        """Загрузить файл и получить его адрес на сервере."""
        data = aiohttp.FormData()
        ctype = mimetypes.guess_type(name)[0] or "application/octet-stream"
        with open(path, "rb") as fh:
            data.add_field("file", fh, filename=name, content_type=ctype)
            async with self.s.post(f"{API}/upload/", headers=_headers(), data=data) as r:
                r.raise_for_status()
                return await r.json()

    async def media_payload(self, media: Media) -> dict:
        """Загрузить файл и собрать поля сообщения с ним."""
        ext = ".mp3" if media.is_audio else ".mp4"
        name = safe_name(media.title, ext)
        up = await self.upload(media.path, name)
        payload = {"content": "", "file_url": up.get("file_url"), "file_name": name}
        if up.get("poster_url"):
            payload["poster_url"] = up["poster_url"]
        if not media.is_audio and media.width and media.height:
            payload["file_width"] = media.width
            payload["file_height"] = media.height
        return payload

    async def send_media(self, chat_id: str, media: Media) -> None:
        payload = {"chat": chat_id, **(await self.media_payload(media))}
        await self.s.post(f"{API}/messages/", headers=_headers(), json=payload)

    # ---- inline (см. backend/chat/inline.py) ----
    async def answer_inline(self, query_id: str, results: list[dict]) -> None:
        await self.s.post(f"{API}/bots/inline/{query_id}/answer/", headers=_headers(), json={"results": results})

    async def fill_message(self, message_id: str, payload: dict) -> None:
        """Заполнить свою заглушку «через @бота» готовым содержимым."""
        await self.s.post(f"{API}/bots/inline/messages/{message_id}/", headers=_headers(), json=payload)


def parse_cookies(text: str) -> tuple[list[tuple[str, str]], int]:
    """Netscape-файл → [(домен, имя)], число строк-кук. Строки #HttpOnly_ — тоже куки."""
    out, n = [], 0
    for line in text.splitlines():
        raw = line[len("#HttpOnly_"):] if line.startswith("#HttpOnly_") else line
        if not raw.strip() or raw.startswith("#"):
            continue
        parts = raw.split("\t")
        if len(parts) < 7:
            continue
        n += 1
        out.append((parts[0].lstrip(".").lower(), parts[5]))
    return out, n


def cookie_site(entries: list[tuple[str, str]], file_name: str) -> str | None:
    for site, domains in COOKIE_SITES:
        if any(any(d.endswith(dom) for dom in domains) for d, _ in entries):
            return site
    stem = os.path.splitext(os.path.basename(file_name or ""))[0].lower()
    return stem if stem in dict(COOKIE_SITES) else None


def cookies_status() -> str:
    if not COOKIES_DIR:
        return "Папка кук не настроена (COOKIES_DIR)."
    import datetime as _dt
    lines = []
    for site, _ in COOKIE_SITES:
        p = os.path.join(COOKIES_DIR, f"{site}.txt")
        if not os.path.exists(p):
            lines.append(f"• {site}: нет файла")
            continue
        try:
            entries, n = parse_cookies(open(p, encoding="utf-8", errors="ignore").read())
        except Exception:
            entries, n = [], 0
        when = _dt.datetime.fromtimestamp(os.path.getmtime(p)).strftime("%d.%m %H:%M")
        login = "вход есть ✅" if site != "youtube" or any(name in YT_LOGIN_COOKIES for _, name in entries) else "без входа ⚠️"
        lines.append(f"• {site}: {n} кук, обновлён {when}, {login}")
    return "Куки:\n" + "\n".join(lines)


async def on_cookies_file(hx: Hyax, chat_id: str, m: dict) -> None:
    """Владелец прислал файл кук — проверить, понять площадку, положить в COOKIES_DIR."""
    if not COOKIES_DIR:
        await hx.send_text(chat_id, "Папка кук не настроена (COOKIES_DIR) — некуда сохранять.")
        return
    try:
        data = await hx.fetch_file(m.get("file_url") or "")
        text = data.decode("utf-8", errors="ignore")
    except Exception as e:
        log.exception("куки: не скачал файл")
        await hx.send_text(chat_id, f"Не смог скачать файл: {str(e)[:120]}")
        return
    entries, n = parse_cookies(text)
    if n == 0:
        await hx.send_text(chat_id, "Это не похоже на файл кук в формате Netscape (cookies.txt): нужны строки из 7 полей через табуляцию.")
        return
    site = cookie_site(entries, m.get("file_name") or "")
    if not site:
        await hx.send_text(chat_id, "Не понял, для какой площадки эти куки: домены не YouTube, Instagram и не TikTok. Назовите файл youtube.txt / instagram.txt / tiktok.txt.")
        return
    os.makedirs(COOKIES_DIR, exist_ok=True)
    dst = os.path.join(COOKIES_DIR, f"{site}.txt")
    tmp = dst + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(text if text.endswith("\n") else text + "\n")
    os.chmod(tmp, 0o600)
    os.replace(tmp, dst)
    login = ""
    if site == "youtube":
        login = " Вход есть ✅." if any(name in YT_LOGIN_COOKIES for _, name in entries) else " ⚠️ Авторизационных кук (SID, LOGIN_INFO) нет — экспортируйте из браузера, где вы вошли в YouTube."
    await hx.send_text(chat_id, f"Куки для {site} обновлены: {n} записей.{login}")


def human_error(e: Exception) -> str:
    """Ошибка yt-dlp — человеческим языком. «Please sign in» — ролик доступен
    только с аккаунта, а куки бота протухли: без владельца тут не починить."""
    msg = str(e)
    if "Please sign in" in msg or "Sign in to confirm" in msg:
        return "YouTube просит войти в аккаунт: у этого ролика ограничение, а куки бота устарели. Владельцу нужно обновить youtube.txt."
    if "Private video" in msg:
        return "Это приватное видео."
    if "Video unavailable" in msg:
        return "Видео недоступно."
    return f"Не получилось: {msg.splitlines()[-1][:200]}"


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
        await hx.send_text(chat_id, human_error(e))
    finally:
        shutil.rmtree(out_dir, ignore_errors=True)


def parse_inline(query: str) -> tuple[str, str]:
    """«mp3 название» → ("mp3", "название"); без формата — mp3."""
    words = (query or "").strip().split(None, 1)
    if words and words[0].lower() in INLINE_MODES:
        mode = INLINE_MODES[words[0].lower()] or DEFAULT_MODE
        return mode, (words[1] if len(words) > 1 else "").strip()
    return "mp3", (query or "").strip()


async def on_inline_query(hx: Hyax, query_id: str, query: str) -> None:
    """«@ytbot mp3 название» — список находок; ссылка — варианты формата."""
    mode, rest = parse_inline(query)
    words = (query or "").split()
    explicit = bool(words) and words[0].lower() in INLINE_MODES
    url = find_url(rest)
    results: list[dict] = []
    if url:
        key = remember(url)
        for m in ([mode] if explicit else [c[0] for c in CHOICES]):
            results.append({"id": f"{m}|{key}", "title": f"{MODE_LABEL.get(m, m)} по ссылке", "description": url[:120]})
    elif len(rest) >= 2:
        try:
            found = await asyncio.to_thread(search, rest, 8)
        except Exception:
            log.exception("inline: поиск не удался")
            found = []
        for item in found:
            dur = fmt_duration(item["duration"])
            desc = " · ".join(x for x in (MODE_LABEL.get(mode, mode), dur, item.get("uploader", "")) if x)
            results.append({"id": f"{mode}|{remember(item['url'])}", "title": item["title"][:120], "description": desc[:200], "thumb_url": item.get("thumb") or ""})
    await hx.answer_inline(query_id, results)


async def on_inline_chosen(hx: Hyax, message_id: str, result_id: str) -> None:
    """Выбрали строку: качаем и заполняем заглушку файлом (или текстом ошибки)."""
    parts = result_id.split("|")
    url = LINKS.get(parts[1]) if len(parts) == 2 else None
    if not url:
        await hx.fill_message(message_id, {"content": "Эта находка устарела — поищите заново."})
        return
    mode = parts[0]
    out_dir = tempfile.mkdtemp(prefix="media-bot-")
    try:
        async with LIMIT:
            media = await asyncio.to_thread(fetch, url, "audio" if mode == "mp3" else mode, out_dir)
        await hx.fill_message(message_id, await hx.media_payload(media))
    except Exception as e:
        log.exception("inline: не вышло скачать %s", url)
        await hx.fill_message(message_id, {"content": human_error(e)})
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


async def handle(hx: Hyax, chat_id: str, text: str, owner: bool = False) -> None:
    """Разобрать сообщение и ответить файлом."""
    body = (text or "").strip()
    if body in ("/start", "/help"):
        await hx.send_text(chat_id, HELP)
        return
    if body == "/cookies":
        await hx.send_text(chat_id, cookies_status() if owner else "Эта команда только для владельца бота.")
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
            if body.get("type") == "inline_query":
                asyncio.create_task(on_inline_query(hx, str(body.get("query_id")), body.get("query") or ""))
                continue
            if body.get("type") == "inline_chosen":
                asyncio.create_task(on_inline_chosen(hx, str(body.get("message_id")), body.get("result_id") or ""))
                continue
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
            if not chat_id:
                continue
            owner = hx.is_owner(m.get("sender"))
            # Файл .txt от владельца — это куки: применяем и отчитываемся.
            if m.get("file_url") and (m.get("file_name") or "").lower().endswith(".txt"):
                if owner:
                    asyncio.create_task(on_cookies_file(hx, str(chat_id), m))
                else:
                    asyncio.create_task(hx.send_text(str(chat_id), "Файлы кук принимаю только от владельца бота."))
                continue
            asyncio.create_task(handle(hx, str(chat_id), m.get("content") or "", owner))


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
