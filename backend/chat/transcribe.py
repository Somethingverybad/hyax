"""Расшифровка голосовых — faster-whisper на CPU.

Где распознаём:
  WHISPER_URL — свой распознаватель на другом сервере (bots/whisper-server,
                стоит в Нидерландах): одна копия модели на всех, память API не
                растёт. Ключ — WHISPER_TOKEN, сертификат — WHISPER_CA (свой,
                самоподписанный, как у ретранслятора перевода).
  иначе / если он не ответил — локально, в процессе API.

Локальная модель (~0,7 ГБ в памяти) живёт не больше чем в ОДНОМ процессе на
контейнер: воркеров gunicorn несколько, и раньше каждый при первом голосовом
грузил свою копию — три копии съедали 2 ГБ, и ядро убивало воркеры (09.11).
Право держать модель — блокировка файла (flock): кто взял, тот и держит до
конца жизни процесса; остальные локально не распознают (статус error, можно
попросить ещё раз). Процесс умер — блокировка снята, модель может взять другой.

Веса скачиваются один раз в /app/whisper-models (bind-mount ./backend, так что
переживают пересборку образа). Расшифровки в процессе идут по одной — семафор,
чтобы ядра не задушить остальной API. Результат пишется в Message и через
updated_at доезжает до клиентов обычным /messages/sync/.

Модель: WHISPER_MODEL в env (по умолчанию small — ~470 МБ, 5–8 с на минуту
речи на этом сервере; medium заметно точнее, но в 3–4 раза медленнее).
"""
from .bgthread import spawn
import logging
import os
import threading

logger = logging.getLogger(__name__)

_model = None
_model_lock = threading.Lock()
_run_lock = threading.Semaphore(1)

MODEL_NAME = os.getenv("WHISPER_MODEL", "small")
#: Голосовые длиннее минуты не расшифровываем: модель одна на сервер и работает
#: по очереди — 15-минутное заняло бы её на минуты и задержало расшифровку у всех.
TRANSCRIBE_MAX_SECONDS = 60
TOO_LONG_ERROR = "Сообщение слишком длинное для расшифровки"


def media_of(msg):
    """Что расшифровывать: голосовое или видео-сообщение («треугольник» — whisper
    берёт звуковую дорожку из mp4 сам). (ссылка, длительность)."""
    if msg.voice_url:
        return msg.voice_url, msg.voice_duration or 0
    if msg.video_url:
        return msg.video_url, msg.video_duration or 0
    return None, 0


def too_long(msg) -> bool:
    return media_of(msg)[1] > TRANSCRIBE_MAX_SECONDS
MODEL_DIR = os.getenv("WHISPER_MODEL_DIR", "/app/whisper-models")


class LocalBusy(RuntimeError):
    """Локальную модель уже держит другой процесс этого контейнера."""


_owner_fd = None


def _claim_local() -> bool:
    """Стать единственным процессом с локальной моделью (flock до конца жизни)."""
    global _owner_fd
    if _owner_fd is not None:
        return True
    import fcntl
    fd = os.open(os.getenv("WHISPER_LOCK", "/tmp/hyax-whisper-local.lock"), os.O_CREAT | os.O_RDWR, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        os.close(fd)
        return False
    _owner_fd = fd
    return True


def get_model():
    global _model
    if _model is None:
        with _model_lock:
            if _model is None:
                if not _claim_local():
                    raise LocalBusy("локальная модель уже в другом процессе")
                from faster_whisper import WhisperModel
                logger.warning("whisper: загружаю модель %s", MODEL_NAME)
                _model = WhisperModel(MODEL_NAME, device="cpu", compute_type="int8",
                                      cpu_threads=max(1, (os.cpu_count() or 2) - 1),
                                      download_root=MODEL_DIR)
    return _model


def _audio_source(voice_url: str):
    """Локальный путь к файлу или подписанная ссылка для s3://."""
    from django.conf import settings
    if voice_url.startswith("s3://"):
        from .s3 import presigned_get
        return presigned_get(voice_url[len("s3://"):], expires=600)
    rel = voice_url.split("?")[0]
    if rel.startswith(settings.MEDIA_URL):
        rel = rel[len(settings.MEDIA_URL):]
    return os.path.join(settings.MEDIA_ROOT, rel.lstrip("/"))


def remote_on() -> bool:
    return bool(os.environ.get("WHISPER_URL"))


def remote_transcribe(*, url=None, data=None, suffix=".ogg", lang="", beam=2, vad=True, wait=120, timeout=150):
    """Распознать на своём удалённом сервере (bots/whisper-server). Ссылку на
    хранилище он качает сам; локальный файл уходит телом запроса. Ответ —
    {text, language, duration, segments: [{no_speech_prob}]}."""
    import httpx
    from .translate import _ssl_for
    params = {"beam": beam, "vad": int(bool(vad)), "wait": wait, "suffix": suffix}
    if lang:
        params["lang"] = lang
    headers = {"Authorization": f"Bearer {os.environ.get('WHISPER_TOKEN', '')}"}
    with httpx.Client(timeout=timeout, verify=_ssl_for(os.environ.get("WHISPER_CA") or "")) as c:
        if url:
            r = c.post(os.environ["WHISPER_URL"], params=params, json={"url": url}, headers=headers)
        else:
            r = c.post(os.environ["WHISPER_URL"], params=params, content=data,
                       headers={**headers, "Content-Type": "application/octet-stream"})
    r.raise_for_status()
    return r.json()


def _local_transcribe(src: str, suffix: str):
    """(текст, язык, длительность) — моделью в этом процессе."""
    tmp_path = None
    try:
        if src.startswith("http"):
            import requests, tempfile
            data = requests.get(src, timeout=60).content
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
                tmp.write(data)
                tmp_path = src = tmp.name
        segments, info = get_model().transcribe(src, beam_size=2, vad_filter=True,
                                                condition_on_previous_text=False)
        text = " ".join(s.text.strip() for s in segments).strip()
        return text, getattr(info, "language", "") or "", getattr(info, "duration", 0) or 0
    finally:
        if tmp_path:  # раньше скачанные голосовые копились во /tmp контейнера
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


def transcribe_message(message_id: str):
    from .models import Message
    msg = Message.objects.filter(id=message_id).first()
    url = media_of(msg)[0] if msg else None
    if not msg or not url or too_long(msg):
        return
    suffix = os.path.splitext(url.split("?")[0])[1] or ".ogg"
    try:
        src = _audio_source(url)
        res = None
        if remote_on():
            try:
                if src.startswith("http"):
                    body = remote_transcribe(url=src, suffix=suffix)
                else:
                    with open(src, "rb") as f:
                        body = remote_transcribe(data=f.read(), suffix=suffix)
                res = ((body.get("text") or "").strip(), body.get("language") or "", body.get("duration") or 0)
            except Exception as e:
                logger.warning("whisper: удалённый распознаватель не ответил (%s: %s) — пробую локально",
                               type(e).__name__, str(e)[:120])
        if res is None:
            with _run_lock:
                res = _local_transcribe(src, suffix)
        text, lang, duration = res
        msg.voice_transcript = text or "(тишина)"
        msg.transcript_status = "done"
        msg.transcript_lang = lang[:8]
        logger.info("whisper: %s — %s, %.0f с аудио%s", message_id, lang, duration, "" if remote_on() else " (локально)")
    except LocalBusy:
        logger.warning("whisper: %s — удалённый недоступен, а локальная модель в другом процессе", message_id)
        msg.transcript_status = "error"
    except Exception:
        logger.exception("whisper: расшифровка не удалась (%s)", message_id)
        msg.transcript_status = "error"
    msg.save(update_fields=["voice_transcript", "transcript_status", "transcript_lang", "updated_at"])
    # Голосовая идея в «Долгом ящике»: текст — в список идей (chat/ideabox.py).
    try:
        from .ideabox import idea_transcribed
        idea_transcribed(msg)
    except Exception:
        logger.exception("ideabox: расшифровка %s не легла в идею", message_id)
    # Автоперевод расшифровки — уже вне блокировки whisper (сеть, не CPU).
    if msg.transcript_status == "done":
        from .translate import translate_transcript
        translate_transcript(msg.id)


def transcribe_async(message_id: str):
    spawn(transcribe_message, str(message_id))
