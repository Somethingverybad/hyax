"""Живой перевод: субтитры звонков и перевод вставленного текста.

Клиенты — звонки WYX в браузере и на компьютере, расширение «WYX Переводчик»
для Opera и Chrome (Google Meet, Zoom в браузере) — сами режут речь
собеседника на фразы по паузам и шлют каждую сюда коротким WAV (16 кГц,
моно). Сервер распознаёт фразу и переводит на язык слушателя тем же
переводчиком, что и сообщения (chat/translate.py).

Распознавание — облачный Whisper-совместимый API (/audio/transcriptions:
OpenAI, Groq, свой faster-whisper-server):
  LIVE_STT_URL   — полный адрес эндпоинта, например
                   https://api.groq.com/openai/v1/audio/transcriptions;
  LIVE_STT_KEY   — ключ (уходит как Authorization: Bearer);
  LIVE_STT_MODEL — модель; по умолчанию whisper-large-v3-turbo для Groq,
                   whisper-1 для остальных;
  LIVE_STT_PROXY — прокси для запроса: из России OpenAI и Groq закрыты.
Без LIVE_STT_URL — OpenRouter тем же ретранслятором, что перевод (своих
ключей не нужно): модели, которые слышат звук, — Voxtral (Mistral, сделан для
распознавания речи), при сбое Gemini 2.5 Flash; LIVE_STT_OPENROUTER_MODEL —
свой список через запятую. Проверено 2026-10-20 на фразах 4–5 с: Voxtral
0,9–1,2 с, Gemini ~2 с, оба слово в слово и с верным языком.
Нет и OpenRouter (или LIVE_STT_PROVIDER=local) — локальный faster-whisper из
chat/transcribe.py. Он один на сервер, работает по очереди с голосовыми и на
CPU медленный (~3,4 с на фразу) — годится для проверки, не для живых звонков.

Язык фразы Whisper определяет сам. Если он ошибается (украинский принял за
русский и т. п.), клиент закрепляет язык (lang) — тогда распознаём и
переводим как с него.
"""
import logging
import os
import re
import tempfile
import time

import httpx
from django.core.cache import cache
from rest_framework import permissions
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from .translate import (
    TranslateNotConfigured, detect_lang, live_lang, norm_lang, same_text, translate_text,
)

logger = logging.getLogger(__name__)

#: Фраза не длиннее 30 с: 16 кГц × 16 бит × 30 с ≈ 960 КБ, плюс запас.
MAX_AUDIO_BYTES = 1_200_000
MAX_TEXT = 5000
#: Запросов в минуту на человека: фраза короче секунды не уходит, так что
#: даже скороговорка в групповом звонке укладывается.
SPEECH_PER_MIN = 60
TEXT_PER_MIN = 30

# Whisper (OpenAI) отвечает названием языка, а не кодом: "russian".
_WHISPER_NAMES = {
    "russian": "ru", "english": "en", "korean": "ko", "ukrainian": "uk", "belarusian": "be",
    "kazakh": "kk", "uzbek": "uz", "azerbaijani": "az", "armenian": "hy", "georgian": "ka",
    "german": "de", "french": "fr", "spanish": "es", "italian": "it", "portuguese": "pt",
    "polish": "pl", "czech": "cs", "dutch": "nl", "swedish": "sv", "finnish": "fi",
    "romanian": "ro", "hungarian": "hu", "greek": "el", "bulgarian": "bg", "serbian": "sr",
    "turkish": "tr", "arabic": "ar", "hebrew": "he", "persian": "fa", "hindi": "hi",
    "chinese": "zh", "japanese": "ja", "thai": "th", "vietnamese": "vi", "indonesian": "id",
}

# Что Whisper «слышит» в шуме и тишине: титры из обучающих видео.
_PHANTOM = re.compile(
    r"продолжение следует|субтитры (сделал|создавал|подготовил|делал)|редактор субтитров|корректор"
    r"|спасибо за просмотр|подписывайтесь на (канал|наш)|ставьте лайк"
    r"|thanks? (you )?for watching|please subscribe|subscribe to (my|the|our) channel"
    r"|ご視聴ありがとうございました|字幕|amara\.org",
    re.I,
)


class SttNotConfigured(Exception):
    pass


class SttBusy(Exception):
    pass


def whisper_lang(value):
    """Код языка из ответа Whisper: "russian", "Russian" или "ru" → "ru"."""
    v = (value or "").strip().lower()
    return _WHISPER_NAMES.get(v) or (v[:2] if len(v) <= 3 else "")


def phantom(text):
    """Не речь, а галлюцинация Whisper на шуме: «Продолжение следует…»."""
    t = (text or "").strip()
    if not re.search(r"[^\W\d_]", t):
        return True  # «...», «!», пусто
    return len(t) < 90 and bool(_PHANTOM.search(t))


def _cloud(data, lang):
    url = os.environ["LIVE_STT_URL"]
    model = os.environ.get("LIVE_STT_MODEL") or ("whisper-large-v3-turbo" if "groq.com" in url else "whisper-1")
    form = {"model": model, "response_format": "verbose_json", "temperature": "0"}
    if lang:
        form["language"] = lang
    headers = {"Authorization": f"Bearer {os.environ['LIVE_STT_KEY']}"} if os.environ.get("LIVE_STT_KEY") else {}
    with httpx.Client(proxy=os.environ.get("LIVE_STT_PROXY") or None, timeout=20) as c:
        r = c.post(url, data=form, files={"file": ("speech.wav", data, "audio/wav")}, headers=headers)
    r.raise_for_status()
    body = r.json()
    segs = body.get("segments") or []
    # Все куски «скорее не речь» — это шум, а не тихий собеседник.
    if segs and all((s.get("no_speech_prob") or 0) > 0.6 for s in segs):
        return "", lang
    return (body.get("text") or "").strip(), whisper_lang(body.get("language")) or lang


OPENROUTER_STT_MODELS = ("mistralai/voxtral-small-24b-2507", "google/gemini-2.5-flash")
_STT_SYSTEM = (
    'You transcribe a short phrase of speech from a phone call. Reply with JSON only: '
    '{"lang": "<ISO 639-1 code>", "text": "<exact words spoken>"}. Do not translate, answer or comment. '
    'If there is no clear speech (noise, silence, music), reply {"lang": "", "text": ""}.'
)


def _openrouter(data, lang):
    """Распознавание моделью, которая слышит звук, через OpenRouter. Ответ —
    JSON {lang, text}; модель не ответила или вернула ошибку — следующая."""
    import base64
    import json
    from . import translate as T
    models = [m.strip() for m in (os.environ.get("LIVE_STT_OPENROUTER_MODEL") or ",".join(OPENROUTER_STT_MODELS)).split(",") if m.strip()]
    base = (os.environ.get("OPENROUTER_BASE_URL") or "https://openrouter.ai/api/v1").rstrip("/")
    headers = {"HTTP-Referer": "https://wyx.su", "X-Title": "WYX"}
    if T._openrouter_key():
        headers["Authorization"] = f"Bearer {T._openrouter_key()}"
    if os.environ.get("OPENROUTER_RELAY_TOKEN"):
        headers["X-Relay-Token"] = os.environ["OPENROUTER_RELAY_TOKEN"]
    content = [{"type": "input_audio", "input_audio": {"data": base64.b64encode(data).decode(), "format": "wav"}}]
    if lang:
        content.append({"type": "text", "text": f"The speaker talks in language with ISO 639-1 code: {lang}."})
    last = None
    for model in models:
        try:
            r = httpx.post(
                f"{base}/chat/completions", headers=headers, timeout=15,
                verify=T._ssl_for(os.environ.get("OPENROUTER_RELAY_CA") or ""),
                json={"model": model, "temperature": 0, "max_tokens": 400,
                      "messages": [{"role": "system", "content": _STT_SYSTEM}, {"role": "user", "content": content}]},
            )
            r.raise_for_status()
            out = (r.json()["choices"][0]["message"]["content"] or "").strip()
        except Exception as e:
            last = e
            logger.warning("live stt: %s не ответил (%s), пробую следующую", model, type(e).__name__)
            continue
        m = re.search(r"\{.*\}", out, re.S)
        try:
            obj = json.loads(m.group(0)) if m else None
        except ValueError:
            obj = None
        if obj is None:
            return out, lang  # ответил текстом без JSON — это и есть расшифровка
        return str(obj.get("text") or "").strip(), (str(obj.get("lang") or "").strip().lower()[:2] or lang)
    raise last or RuntimeError("live stt: нет моделей")


def _engine():
    """Чем распознавать: свой Whisper-адрес, иначе OpenRouter, иначе локально."""
    if os.environ.get("LIVE_STT_URL"):
        return _cloud
    from .translate import _openrouter_on
    if os.environ.get("LIVE_STT_PROVIDER", "").strip().lower() != "local" and _openrouter_on():
        return _openrouter
    return _local


def _local(data, lang):
    """Тот же faster-whisper, что расшифровывает голосовые. Занят дольше
    нескольких секунд — фразу пропускаем: в живом звонке она уже устарела."""
    from .transcribe import _run_lock, get_model
    if not _run_lock.acquire(timeout=6):
        raise SttBusy()
    try:
        with tempfile.NamedTemporaryFile(suffix=".wav") as tmp:
            tmp.write(data)
            tmp.flush()
            segments, info = get_model().transcribe(tmp.name, language=lang or None, beam_size=1,
                                                    vad_filter=False, condition_on_previous_text=False)
            segs = list(segments)
    finally:
        _run_lock.release()
    if segs and all(s.no_speech_prob > 0.6 for s in segs):
        return "", lang
    return " ".join(s.text.strip() for s in segs).strip(), (getattr(info, "language", "") or lang)[:2]


def recognize(data, lang=""):
    """Распознать фразу: (текст, язык). Шум и галлюцинации — пустой текст."""
    text, found = _engine()(data, lang)
    if phantom(text):
        return "", found
    return text, found


def _rate_ok(user_id, kind, per_min):
    """Не больше per_min запросов в минуту на человека (кэш Django)."""
    key = f"live:{kind}:{user_id}:{int(time.time() // 60)}"
    cache.add(key, 0, 120)
    try:
        return cache.incr(key) <= per_min
    except ValueError:  # ключ успел истечь между add и incr
        return True


def _my_lang(request):
    me = getattr(request.user, "profile", None)
    return norm_lang(getattr(me, "language", "")) or "ru"


class LiveSpeechView(APIView):
    """POST live/speech/ — фраза из звонка. multipart: audio — WAV до 30 с;
    to — на какой язык переводить (по умолчанию язык профиля); lang —
    закреплённый язык речи, если автоопределение ошибается.
    Ответ {text, lang, to, translation}: перевод пустой, если собеседник уже
    говорит на языке to; text пустой — в фразе не было речи."""
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        if not _rate_ok(request.user.id, "speech", SPEECH_PER_MIN):
            return Response({"error": "Слишком часто — подождите минуту"}, status=429)
        audio = request.FILES.get("audio")
        if not audio:
            return Response({"error": "Нет звука"}, status=400)
        if audio.size > MAX_AUDIO_BYTES:
            return Response({"error": "Фраза слишком длинная"}, status=413)
        to = live_lang(request.data.get("to")) or _my_lang(request)
        lang = live_lang(request.data.get("lang"))
        try:
            text, found = recognize(audio.read(), lang)
        except SttBusy:
            return Response({"error": "Распознавание занято"}, status=503)
        except Exception:
            logger.exception("live: распознавание не удалось")
            return Response({"error": "Не удалось распознать речь"}, status=502)
        src = lang or live_lang(found)
        out = {"text": text, "lang": src, "to": to, "translation": ""}
        if not text or src == to:
            return Response(out)
        try:
            tr = translate_text(text, to, src, trust_source=bool(src))
            out["translation"] = "" if same_text(tr, text) else tr
        except TranslateNotConfigured:
            return Response({**out, "error": "Перевод пока не настроен"}, status=503)
        except Exception:
            logger.exception("live: перевод фразы не удался")
            return Response({**out, "error": "Не удалось перевести"}, status=502)
        return Response(out)


class LiveTextView(APIView):
    """POST live/text/ {text, to?, other?, from?} — перевод вставленного текста.
    Направление само: текст не на моём языке (to, по умолчанию язык профиля) —
    на мой; уже на моём — на язык собеседника (other, по умолчанию en, а для
    англоязычных — ru). from — закреплённый язык текста: по письменности
    испанский не отличить от английского, украинский — от русского.
    Ответ {text, from, to, translation}."""
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [JSONParser]

    def post(self, request):
        if not _rate_ok(request.user.id, "text", TEXT_PER_MIN):
            return Response({"error": "Слишком часто — подождите минуту"}, status=429)
        text = (request.data.get("text") or "").strip()
        if len(text) > MAX_TEXT:
            return Response({"error": "Текст слишком длинный"}, status=413)
        mine = live_lang(request.data.get("to")) or _my_lang(request)
        other = live_lang(request.data.get("other")) or ("ru" if mine == "en" else "en")
        locked = live_lang(request.data.get("from"))
        src = locked or detect_lang(text)
        if not text or not src:
            return Response({"error": "Здесь переводить нечего"}, status=400)
        to = other if src == mine else mine
        try:
            tr = translate_text(text, to, src, trust_source=bool(locked))
        except TranslateNotConfigured:
            return Response({"error": "Перевод пока не настроен"}, status=503)
        except Exception:
            logger.exception("live: перевод текста не удался")
            return Response({"error": "Не удалось перевести"}, status=502)
        if same_text(tr, text):
            return Response({"error": "Текст уже на этом языке"}, status=422)
        return Response({"text": text, "from": src, "to": to, "translation": tr})
