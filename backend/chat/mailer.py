"""Письма через Resend (https://resend.com): HTTP API, ключ в окружении.

RESEND_API_KEY — ключ; без него письма не уходят, вызывающий получает
MailNotConfigured и отвечает клиенту «пока не настроено».
RESEND_FROM — отправитель, по умолчанию WYX <noreply@wyx.su>; домен должен
быть подтверждён в Resend, иначе API вернёт 403.
"""
import logging
import os

import httpx

logger = logging.getLogger(__name__)


class MailNotConfigured(Exception):
    pass


def send_email(to, subject, text, html=None):
    key = os.environ.get("RESEND_API_KEY", "").strip()
    if not key:
        raise MailNotConfigured()
    sender = os.environ.get("RESEND_FROM", "WYX <noreply@wyx.su>")
    payload = {"from": sender, "to": [to], "subject": subject, "text": text}
    if html:
        payload["html"] = html
    r = httpx.post("https://api.resend.com/emails", headers={"Authorization": f"Bearer {key}"}, json=payload, timeout=15)
    if r.status_code >= 300:
        logger.error("Resend %s: %s", r.status_code, r.text[:300])
        r.raise_for_status()
    return r.json().get("id")


def code_email(code, purpose):
    """Тема и текст письма с кодом: привязка почты или сброс пароля."""
    if purpose == "reset":
        subject = "Восстановление пароля WYX"
        intro = "Вы запросили сброс пароля в WYX."
    else:
        subject = "Подтверждение почты WYX"
        intro = "Вы привязываете эту почту к аккаунту WYX."
    text = f"{intro}\n\nКод: {code}\n\nОн действует 15 минут. Если это не вы — просто не обращайте внимания на письмо."
    html = (
        f"<p>{intro}</p>"
        f"<p style=\"font-size:28px;letter-spacing:6px;font-weight:600;font-family:ui-monospace,Menlo,monospace\">{code}</p>"
        "<p>Код действует 15 минут. Если это не вы — просто не обращайте внимания на письмо.</p>"
    )
    return subject, text, html
