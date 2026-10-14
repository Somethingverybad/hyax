"""Перевод сообщений: ru / en / ko.

Провайдер выбирается по ключам в окружении (первый найденный):
  GEMINI_API_KEY      — Google Gemini (бесплатный тариф, лучшее качество для чата);
  DEEPL_API_KEY       — DeepL Free (500 000 знаков в месяц);
  LIBRETRANSLATE_URL  — свой LibreTranslate (бесплатно, качество слабее).
TRANSLATE_PROVIDER=gemini|deepl|libre задаёт провайдера явно.
Без ключей перевод не настроен: эндпоинты отвечают 503, автоперевод молчит.

Автоперевод работает в личных незашифрованных чатах: при отправке сервер
смотрит, хочет ли отправитель переводить «на язык получателя»
(ChatParticipant.translate_out) или получатель — «на мой язык»
(translate_in), и если языки разные, переводит в фоне и дописывает
Message.translations[язык]. Оригинал не трогаем: клиент показывает перевод
с пометкой и даёт посмотреть исходник. Один язык у обоих — ничего не делаем.
"""
import logging
import os
import threading

import httpx

logger = logging.getLogger(__name__)

LANGS = {"ru": "Russian", "en": "English", "ko": "Korean"}


class TranslateNotConfigured(Exception):
    pass


def provider():
    p = os.environ.get("TRANSLATE_PROVIDER", "").strip().lower()
    if p:
        return p
    if os.environ.get("GEMINI_API_KEY"):
        return "gemini"
    if os.environ.get("DEEPL_API_KEY"):
        return "deepl"
    if os.environ.get("LIBRETRANSLATE_URL"):
        return "libre"
    return ""


def norm_lang(code):
    code = (code or "").strip().lower()[:2]
    return code if code in LANGS else ""


def translate_text(text, target, source=""):
    """Перевод строки. Бросает TranslateNotConfigured без провайдера."""
    target = norm_lang(target)
    if not text or not text.strip() or not target:
        return text
    p = provider()
    if p == "gemini":
        return _gemini(text, target)
    if p == "deepl":
        return _deepl(text, target, source)
    if p == "libre":
        return _libre(text, target, source)
    raise TranslateNotConfigured()


def _gemini(text, target):
    key = os.environ["GEMINI_API_KEY"]
    model = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")
    prompt = (
        f"Translate the chat message below into {LANGS[target]}. Output only the translation, nothing else. "
        "Keep emojis, line breaks, @mentions, links and the casual tone. "
        f"If the message is already in {LANGS[target]}, output it unchanged.\n\nMessage:\n{text}"
    )
    r = httpx.post(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        params={"key": key},
        json={"contents": [{"parts": [{"text": prompt}]}], "generationConfig": {"temperature": 0.2}},
        timeout=30,
    )
    r.raise_for_status()
    out = r.json()["candidates"][0]["content"]["parts"][0]["text"]
    return out.strip()


def _deepl(text, target, source):
    key = os.environ["DEEPL_API_KEY"]
    host = "api-free.deepl.com" if key.endswith(":fx") else "api.deepl.com"
    data = {"text": [text], "target_lang": target.upper()}
    if norm_lang(source):
        data["source_lang"] = norm_lang(source).upper()
    r = httpx.post(f"https://{host}/v2/translate", headers={"Authorization": f"DeepL-Auth-Key {key}"}, json=data, timeout=30)
    r.raise_for_status()
    return r.json()["translations"][0]["text"]


def _libre(text, target, source):
    url = os.environ["LIBRETRANSLATE_URL"].rstrip("/")
    data = {"q": text, "source": norm_lang(source) or "auto", "target": target, "format": "text"}
    if os.environ.get("LIBRETRANSLATE_KEY"):
        data["api_key"] = os.environ["LIBRETRANSLATE_KEY"]
    r = httpx.post(f"{url}/translate", json=data, timeout=30)
    r.raise_for_status()
    return r.json()["translatedText"]


def wanted_targets(message, sender):
    """Языки, на которые нужен перевод этого сообщения (личка, не секретный чат)."""
    from .models import ChatParticipant
    chat = message.chat
    if chat.kind != "direct" or not (message.content or "").strip():
        return []
    parts = list(ChatParticipant.objects.filter(chat=chat).select_related("user"))
    me = next((p for p in parts if p.user_id == sender.id), None)
    src = norm_lang(sender.language) or "ru"
    out = set()
    for p in parts:
        if p.user_id == sender.id:
            continue
        tgt = norm_lang(p.user.language) or "ru"
        if tgt == src:
            continue
        if (me and me.translate_out) or p.translate_in:
            out.add(tgt)
    return sorted(out)


def schedule(message, sender, request=None):
    """Перевести в фоне и разослать обновлённое сообщение в сокет чата."""
    try:
        targets = wanted_targets(message, sender)
    except Exception:
        logger.exception("translate: targets")
        return
    if not targets or not provider():
        return
    mid, src = message.id, norm_lang(sender.language) or "ru"

    def run():
        from .models import Message
        from .serializers import MessageSerializer
        try:
            msg = Message.objects.select_related("chat", "sender").get(id=mid)
            tr = dict(msg.translations or {})
            for t in targets:
                if t in tr:
                    continue
                tr[t] = translate_text(msg.content or "", t, src)
            Message.objects.filter(id=mid).update(translations=tr)
            msg.translations = tr
            from channels.layers import get_channel_layer
            from asgiref.sync import async_to_sync
            layer = get_channel_layer()
            if layer:
                async_to_sync(layer.group_send)(f"chat_{msg.chat_id}", {"type": "chat_message", "message": MessageSerializer(msg).data})
        except TranslateNotConfigured:
            pass
        except Exception:
            logger.exception("translate: message %s", mid)

    threading.Thread(target=run, daemon=True).start()
