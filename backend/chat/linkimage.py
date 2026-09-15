"""Ссылка на картинку → вложение.

Если сообщение состоит из одной http(s)-ссылки на картинку, сервер скачивает
её к себе (в S3, если он включён) и подменяет текст вложением: в переписке
видно саму картинку, а не голый URL. Работает в фоновом потоке — сообщение
уже доставлено, картинка доезжает клиентам обычной синхронизацией по
updated_at, как и расшифровка голосовых (см. chat/transcribe.py).

Осторожность с чужими адресами: ходим только в публичную сеть (иначе ссылкой
можно было бы заставить сервер сходить к себе же — 127.0.0.1, 10.0.0.0/8 или
169.254.169.254 с метаданными облака) и определяем тип по сигнатуре самого
файла, а не по расширению в ссылке.
"""
import ipaddress
import logging
import os
import re
import socket
import threading
import uuid
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

# Сообщение = одна ссылка и ничего больше: подпись к картинке не трогаем.
URL_ONLY_RE = re.compile(r'^\s*(https?://[^\s<>"\']+)\s*$', re.IGNORECASE)

# Тип определяем по сигнатуре самого файла, а не по расширению в ссылке и не
# по Content-Type: его многие отдают как application/octet-stream (наш же
# nginx на /apk/ — тоже), и строгая проверка заголовка отбрасывала картинки.
MAX_BYTES = 25 * 1024 * 1024
TIMEOUT = (8, 25)  # соединение, чтение

IMAGE_TYPES = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}


def sniff(head: bytes):
    """(mime, расширение) по первым байтам — или None, если это не картинка."""
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg", ".jpg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png", ".png"
    if head.startswith(b"GIF87a") or head.startswith(b"GIF89a"):
        return "image/gif", ".gif"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp", ".webp"
    return None


def image_url_in(content):
    """Ссылка, если всё сообщение — это она; иначе None."""
    m = URL_ONLY_RE.match(content or "")
    return m.group(1) if m else None


def _public_host(url) -> bool:
    host = urlparse(url).hostname
    if not host:
        return False
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        return False
    for info in infos:
        try:
            ip = ipaddress.ip_address(info[4][0])
        except ValueError:
            return False
        if (ip.is_private or ip.is_loopback or ip.is_link_local
                or ip.is_reserved or ip.is_multicast or ip.is_unspecified):
            return False
    return bool(infos)


def fetch_image(message_id, url):
    import requests
    from django.conf import settings
    from .models import Message
    from .s3 import s3_enabled, upload_file as s3_upload

    msg = Message.objects.filter(id=message_id).first()
    if not msg or msg.file_url:
        return
    if not _public_host(url):
        logger.info("link-image: непубличный адрес, пропускаю")
        return

    tmp_path = None
    try:
        r = requests.get(url, timeout=TIMEOUT, stream=True, allow_redirects=True,
                         headers={"User-Agent": "hyax-link-image/1.0"})
        if r.status_code != 200:
            return
        header_ctype = (r.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        chunks = r.iter_content(65536)
        first = next(chunks, b"")
        kind = sniff(first)
        if not kind:
            # Сигнатура не картиночная — доверяем заголовку, только если он
            # прямо называет тип из нашего списка.
            ext = IMAGE_TYPES.get(header_ctype)
            if not ext:
                return
            kind = (header_ctype, ext)
        ctype, ext = kind

        rel = os.path.join("messages", f"{uuid.uuid4()}{ext}")
        tmp_path = os.path.join(settings.MEDIA_ROOT, rel)
        os.makedirs(os.path.dirname(tmp_path), exist_ok=True)
        got = 0
        with open(tmp_path, "wb") as out:
            out.write(first)
            got += len(first)
            for chunk in chunks:
                got += len(chunk)
                if got > MAX_BYTES:
                    raise ValueError("слишком большая картинка")
                out.write(chunk)
        if not got:
            raise ValueError("пустой ответ")

        from .views import _probe_dims
        dims = _probe_dims(tmp_path)

        file_url = f"/media/{rel}"
        if s3_enabled():
            try:
                file_url = s3_upload(tmp_path, rel, ctype)
                os.remove(tmp_path)
                tmp_path = None
            except Exception:
                logger.exception("link-image: S3 недоступен, оставляю локально")

        # Имя файла — из ссылки, чтобы в «Скачать» было человеческое.
        base = os.path.basename(urlparse(url).path) or f"image{ext}"
        if not os.path.splitext(base)[1]:
            base += ext
        msg.file_url = file_url
        msg.file_name = base[:120]
        msg.file_size = got
        if dims:
            msg.file_width, msg.file_height = dims
        msg.content = None
        msg.save(update_fields=["file_url", "file_name", "file_size",
                                "file_width", "file_height", "content", "updated_at"])
        logger.info("link-image: %s → %s (%d б)", url[:80], file_url, got)
    except Exception:
        logger.exception("link-image: не удалось забрать картинку")
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass


def fetch_async(message_id, url):
    threading.Thread(target=fetch_image, args=(str(message_id), url), daemon=True).start()
