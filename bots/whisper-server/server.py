"""Распознаватель речи WYX: faster-whisper одной копией для всего API.

Стоит на нидерландском сервере (crystal): на московском каждый воркер API
держал свою копию модели (~0,7 ГБ), и память кончалась. Клиент —
backend/chat/transcribe.py (WHISPER_URL / WHISPER_TOKEN / WHISPER_CA).

POST /transcribe?beam=2&vad=1&wait=120&suffix=.ogg[&lang=ru]
  тело — сам звук (application/octet-stream) или {"url": "<подписанная ссылка
  на хранилище>"} (application/json): тогда файл качаем сами, только с хостов
  из FETCH_HOSTS.
  → {text, language, duration, segments: [{no_speech_prob}]}
GET /health → {ok, model}

Доступ: Authorization: Bearer <WHISPER_TOKEN> и адрес из ALLOW_FROM (если
задан). TLS — свой сертификат (TLS_CERT/TLS_KEY), как у ретранслятора.
Распознаём по одному (семафор): ядра делим с соседями по серверу; кто ждёт
дольше wait секунд — 503, клиент решит сам (звонок фразу пропустит).
"""
import hmac
import ipaddress
import json
import logging
import os
import ssl
import tempfile
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from faster_whisper import WhisperModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("whisper")

TOKEN = os.environ["WHISPER_TOKEN"]
ALLOW = [ipaddress.ip_network(x.strip(), strict=False) for x in os.environ.get("ALLOW_FROM", "").split(",") if x.strip()]
FETCH_HOSTS = {h.strip() for h in os.environ.get("FETCH_HOSTS", "storage.yandexcloud.net").split(",") if h.strip()}
MODEL_NAME = os.environ.get("WHISPER_MODEL", "small")
THREADS = int(os.environ.get("WHISPER_THREADS", "3"))
MAX_BYTES = 40 * 1024 * 1024

log.info("загружаю модель %s (%d потоков)", MODEL_NAME, THREADS)
MODEL = WhisperModel(MODEL_NAME, device="cpu", compute_type="int8", cpu_threads=THREADS,
                     download_root=os.environ.get("MODEL_DIR", "/models"))
RUN = threading.Semaphore(1)
log.info("модель готова")


def _fetch(url: str) -> bytes:
    u = urlparse(url)
    if u.scheme != "https" or u.hostname not in FETCH_HOSTS:
        raise ValueError("чужой адрес")
    with urllib.request.urlopen(url, timeout=60) as r:
        data = r.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError("файл слишком большой")
    return data


class Handler(BaseHTTPRequestHandler):
    server_version = "wyx-whisper"
    protocol_version = "HTTP/1.1"
    timeout = 90  # сокет: медленный клиент не держит поток вечно

    def log_message(self, fmt, *args):  # без адресов ссылок и тел в журнале
        pass

    def _send(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _allowed(self) -> bool:
        if not _ip_ok(self.client_address[0]):
            return False
        got = (self.headers.get("Authorization") or "").removeprefix("Bearer ").strip()
        return hmac.compare_digest(got.encode(), TOKEN.encode())

    def do_GET(self):
        if urlparse(self.path).path == "/health":
            return self._send(200, {"ok": True, "model": MODEL_NAME})
        self._send(404, {"error": "not found"})

    def do_POST(self):
        u = urlparse(self.path)
        length = int(self.headers.get("Content-Length") or 0)
        if u.path != "/transcribe":
            return self._send(404, {"error": "not found"})
        if not self._allowed():
            return self._send(403, {"error": "forbidden"})
        if length <= 0 or length > MAX_BYTES:
            return self._send(413, {"error": "bad length"})
        body = self.rfile.read(length)
        q = {k: v[-1] for k, v in parse_qs(u.query).items()}
        try:
            beam = min(5, max(1, int(q.get("beam", 2))))
            vad = q.get("vad", "1") != "0"
            wait = min(300.0, max(0.0, float(q.get("wait", 120))))
            lang = (q.get("lang") or "")[:5] or None
            suffix = q.get("suffix", ".ogg")
            if not (suffix.startswith(".") and len(suffix) <= 8 and suffix[1:].isalnum()):
                suffix = ".ogg"
            if (self.headers.get("Content-Type") or "").startswith("application/json"):
                data = _fetch(json.loads(body)["url"])
            else:
                data = body
        except Exception as e:
            return self._send(400, {"error": f"bad request: {type(e).__name__}"})
        t0 = time.monotonic()
        if not RUN.acquire(timeout=wait):
            return self._send(503, {"error": "busy"})
        tmp_path = None
        try:
            # Файл закрываем до чтения: Windows не даёт открыть ещё не закрытый
            # временный файл второй раз (на Linux можно было и так).
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
                tmp.write(data)
                tmp_path = tmp.name
            segments, info = MODEL.transcribe(tmp_path, language=lang, beam_size=beam, vad_filter=vad,
                                              condition_on_previous_text=False)
            segs = list(segments)
        except Exception as e:
            log.exception("распознавание не удалось")
            return self._send(500, {"error": type(e).__name__})
        finally:
            RUN.release()
            if tmp_path:
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass
        log.info("%.1f с звука за %.1f с, %s", info.duration or 0, time.monotonic() - t0, info.language)
        self._send(200, {
            "text": " ".join(s.text.strip() for s in segs).strip(),
            "language": info.language or "",
            "duration": info.duration or 0,
            "segments": [{"no_speech_prob": s.no_speech_prob} for s in segs],
        })


def _ip_ok(addr) -> bool:
    if not ALLOW:
        return True
    ip = ipaddress.ip_address(addr)
    return any(ip in n for n in ALLOW)


class Server(ThreadingHTTPServer):
    daemon_threads = True
    tls = None

    def verify_request(self, request, client_address):
        return _ip_ok(client_address[0])  # чужой адрес — закрыть ещё до TLS

    def process_request_thread(self, request, client_address):
        # Рукопожатие TLS — в потоке запроса, а не в общем accept(): зависший
        # клиент не блокирует остальных.
        if self.tls:
            try:
                request.settimeout(30)
                request = self.tls.wrap_socket(request, server_side=True)
            except Exception:
                self.shutdown_request(request)
                return
        super().process_request_thread(request, client_address)


def main():
    srv = Server(("0.0.0.0", int(os.environ.get("PORT", "8745"))), Handler)
    if os.environ.get("TLS_CERT"):
        srv.tls = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
        srv.tls.load_cert_chain(os.environ["TLS_CERT"], os.environ["TLS_KEY"])
    log.info("слушаю :%s", srv.server_address[1])
    srv.serve_forever()


if __name__ == "__main__":
    main()
