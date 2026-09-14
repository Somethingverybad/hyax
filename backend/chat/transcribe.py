"""Расшифровка голосовых — локально, faster-whisper на CPU.

Модель грузится лениво при первом запросе и живёт в процессе; веса
скачиваются один раз в /app/whisper-models (bind-mount ./backend, так что
переживают пересборку образа). Расшифровки идут по одной — семафор, чтобы
четыре ядра не задушить остальной API. Результат пишется в Message и
через updated_at доезжает до клиентов обычным /messages/sync/.

Модель: WHISPER_MODEL в env (по умолчанию small — ~470 МБ, 5–8 с на минуту
речи на этом сервере; medium заметно точнее, но в 3–4 раза медленнее).
"""
import logging
import os
import threading

logger = logging.getLogger(__name__)

_model = None
_model_lock = threading.Lock()
_run_lock = threading.Semaphore(1)

MODEL_NAME = os.getenv("WHISPER_MODEL", "small")
MODEL_DIR = os.getenv("WHISPER_MODEL_DIR", "/app/whisper-models")


def get_model():
    global _model
    if _model is None:
        with _model_lock:
            if _model is None:
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


def transcribe_message(message_id: str):
    from .models import Message
    msg = Message.objects.filter(id=message_id).first()
    if not msg or not msg.voice_url:
        return
    with _run_lock:
        try:
            src = _audio_source(msg.voice_url)
            if src.startswith("http"):
                import requests, tempfile
                data = requests.get(src, timeout=60).content
                tmp = tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(msg.voice_url)[1] or ".ogg")
                tmp.write(data); tmp.close(); src = tmp.name
            segments, info = get_model().transcribe(src, beam_size=2, vad_filter=True,
                                                    condition_on_previous_text=False)
            text = " ".join(s.text.strip() for s in segments).strip()
            msg.voice_transcript = text or "(тишина)"
            msg.transcript_status = "done"
            logger.info("whisper: %s — %s, %.0f с аудио", message_id, info.language, info.duration)
        except Exception:
            logger.exception("whisper: расшифровка не удалась (%s)", message_id)
            msg.transcript_status = "error"
        msg.save(update_fields=["voice_transcript", "transcript_status", "updated_at"])


def transcribe_async(message_id: str):
    threading.Thread(target=transcribe_message, args=(str(message_id),), daemon=True).start()
