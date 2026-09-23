"""Скачивание видео и музыки по ссылке — общее ядро для всех транспортов.

Транспорт (телеграм, хуякс) отвечает только за «откуда пришла ссылка и куда
положить файл». Здесь — сама загрузка: yt-dlp, выбор качества и приведение
видео к виду, который без вопросов играет на телефоне.

Куки берутся из COOKIES_DIR, если он задан: без них YouTube отдаёт не всё.
"""
from __future__ import annotations

import json
import logging
import os
import re
import subprocess
import tempfile
from dataclasses import dataclass

from yt_dlp import YoutubeDL

log = logging.getLogger("media-bot.download")

URL_RE = re.compile(r"https?://\S+", re.I)
COOKIES_DIR = os.getenv("COOKIES_DIR", "").strip()

#: Высота кадра для режимов качества. «audio» — только звук.
LONG_CAP = {360: 360, 480: 480, 720: 720, 1080: 1080}


@dataclass
class Media:
    path: str
    title: str
    is_audio: bool
    duration: float = 0.0
    width: int = 0
    height: int = 0


def find_url(text: str) -> str | None:
    m = URL_RE.search(text or "")
    return m.group(0) if m else None


def _platform(url: str) -> str:
    u = (url or "").lower()
    if "youtu" in u:
        return "youtube"
    if "tiktok" in u:
        return "tiktok"
    if "instagram" in u:
        return "instagram"
    return "other"


def _cookies_for(url: str) -> str | None:
    """Файл кук для площадки, если он есть. YouTube без них отдаёт не всё."""
    if not COOKIES_DIR:
        return None
    path = os.path.join(COOKIES_DIR, f"{_platform(url)}.txt")
    return path if os.path.exists(path) else None


def probe(path: str) -> tuple[float, int, int]:
    """Длительность и размер кадра через ffprobe: нужны, чтобы клиент нарисовал
    плеер правильных пропорций и не дёргал раскладку при загрузке."""
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=width,height:format=duration",
             "-of", "json", path],
            capture_output=True, text=True, timeout=60,
        ).stdout
        data = json.loads(out or "{}")
        dur = float((data.get("format") or {}).get("duration") or 0)
        st = (data.get("streams") or [{}])[0]
        return dur, int(st.get("width") or 0), int(st.get("height") or 0)
    except Exception:
        return 0.0, 0, 0


#: Ошибки, при которых виноваты куки, а не ссылка. С протухшей сессией YouTube
#: отвечает «страницу нужно перезагрузить», и без кук тот же ролик качается.
COOKIE_ERRORS = (
    "page needs to be reloaded",
    "sign in to confirm",
    "login required",
    "this content isn",
    "http error 403",
)


def _looks_like_cookie_problem(err: Exception) -> bool:
    text = str(err).lower()
    return any(m in text for m in COOKIE_ERRORS)


def fetch(url: str, mode: str = "720", out_dir: str | None = None) -> Media:
    """Скачать по ссылке. mode: «audio» либо высота кадра (360/480/720/1080).

    Видео просим сразу в H.264 и mp4: это единственная связка, которая играет
    везде без перекодирования — а перекодировать час видео на сервере дорого.
    """
    out_dir = out_dir or tempfile.mkdtemp(prefix="media-bot-")
    # YouTube с куками сейчас отвечает «страницу нужно перезагрузить» и не даёт
    # ничего, а без них отдаёт нормальные 720p. Поэтому для него сначала
    # пробуем без кук, а с куками — только если без них не вышло (возрастные и
    # приватные ролики). На других площадках наоборот: там куки и нужны.
    first, second = (False, True) if _platform(url) == "youtube" else (True, False)
    try:
        return _fetch(url, mode, out_dir, use_cookies=first)
    except Exception as e:
        if not _cookies_for(url):
            raise
        log.warning("не вышло (%s) — пробую %s кук", str(e)[:70],
                    "с" if second else "без")
        return _fetch(url, mode, out_dir, use_cookies=second)


def _fetch(url: str, mode: str, out_dir: str, use_cookies: bool) -> Media:
    outtmpl = os.path.join(out_dir, "%(id)s.%(ext)s")
    cookies = _cookies_for(url) if use_cookies else None

    if mode == "audio":
        opts = {
            "format": "bestaudio/best",
            "outtmpl": outtmpl,
            "noplaylist": True,
            "quiet": True,
            "postprocessors": [
                {"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "192"},
            ],
        }
        if cookies:
            opts["cookiefile"] = cookies
        with YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)
            title = info.get("title") or "Аудио"
            path = os.path.splitext(ydl.prepare_filename(info))[0] + ".mp3"
        dur, _, _ = probe(path)
        return Media(path=path, title=title, is_audio=True, duration=dur)

    cap = LONG_CAP.get(int(mode), 720)
    # Раньше здесь стояло ещё и ограничение по ширине с жёстким требованием
    # avc1+mp4a — под него подходил только старый совмещённый поток, и вместо
    # запрошенных 720p приходило 360p. Теперь ограничение по высоте, а H.264
    # и AAC — предпочтение через сортировку: их играют все устройства, но если
    # их нет, лучше отдать другой кодек, чем уронить качество.
    fmt = f"bestvideo[height<={cap}]+bestaudio/best[height<={cap}]/best"
    opts = {"format": fmt, "merge_output_format": "mp4", "outtmpl": outtmpl,
            "format_sort": [f"res:{cap}", "vcodec:h264", "acodec:aac"],
            "noplaylist": True, "quiet": True}
    if cookies:
        opts["cookiefile"] = cookies
    with YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)
        title = info.get("title") or "Видео"
        path = ydl.prepare_filename(info)
        if not os.path.exists(path):  # после склейки расширение меняется
            path = os.path.splitext(path)[0] + ".mp4"
    dur, w, h = probe(path)
    return Media(path=path, title=title, is_audio=False, duration=dur, width=w, height=h)


def safe_name(title: str, ext: str) -> str:
    """Имя файла из заголовка: без слэшей и прочего, что ломает пути."""
    clean = re.sub(r"[^\w\s.,()\[\]-]", "", title, flags=re.U).strip() or "media"
    return f"{clean[:80]}{ext}"


def search(query: str, limit: int = 5) -> list[dict]:
    """Поиск по YouTube: [{title, url, uploader, duration}].

    Только перечень, без загрузки: ссылки берём и качаем потом, когда человек
    выберет строку. Куки здесь не нужны — выдача поиска открыта.
    """
    opts = {"quiet": True, "skip_download": True, "extract_flat": True, "noplaylist": True}
    with YoutubeDL(opts) as ydl:
        info = ydl.extract_info(f"ytsearch{limit}:{query}", download=False)
    out = []
    for e in (info.get("entries") or []):
        if not e:
            continue
        vid = e.get("id") or ""
        out.append({
            "url": e.get("url") or f"https://www.youtube.com/watch?v={vid}",
            "title": e.get("title") or "Без названия",
            "uploader": e.get("uploader") or e.get("channel") or "",
            "duration": e.get("duration") or 0,
        })
    return out


def fmt_duration(seconds) -> str:
    s = int(seconds or 0)
    if s <= 0:
        return ""
    h, rest = divmod(s, 3600)
    m, sec = divmod(rest, 60)
    return f"{h}:{m:02d}:{sec:02d}" if h else f"{m}:{sec:02d}"
