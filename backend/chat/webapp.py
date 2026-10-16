"""Мини-приложения ботов: веб-страница бота открывается внутри WYX.

Как устроено:
• у бота есть адрес мини-приложения (Profile.webapp_url, ставится в студии или
  PATCH bots/<id>/), а в сообщениях бота — кнопки {text, web_app: {url}};
• клиент открывает страницу во встроенном окне и передаёт ей «данные запуска»
  (init_data): кто открыл, когда, из какого чата — подписанные ключом из
  токена бота. Сервер бота проверяет подпись своим токеном и узнаёт
  пользователя без отдельного входа (документация — bots.html#webapp);
• страница может отправить боту данные (sendData) — бот получает событие
  web_app_data в личный сокет.

Подпись — HMAC-SHA256: secret = HMAC_SHA256(key="WebAppData", msg=токен бота),
hash = hex(HMAC_SHA256(key=secret, msg=строки «ключ=значение» по алфавиту через \n)).
Это распространённая схема мини-приложений, готовые библиотеки проверки
подходят как есть — с токеном бота WYX.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import time
from urllib.parse import parse_qsl, urlencode, urlparse

from django.conf import settings
from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import ChatParticipant, Profile

#: Данные запуска действуют сутки: дольше страница должна открываться заново.
INIT_TTL = 24 * 3600
#: Сколько страница может отправить боту за раз (sendData).
DATA_MAX = 4096
#: Нейтральный адрес: ссылки на мини-приложения и аватары для страниц ботов.
WYX_ORIGIN = os.getenv("WYX_ORIGIN", "https://wyx.su").rstrip("/")


def valid_app_url(url: str) -> bool:
    """Только https: страница получает данные пользователя. В отладке —
    ещё http://localhost и 127.0.0.1 (проверка на своей машине)."""
    if not url or len(url) > 1024:
        return False
    try:
        u = urlparse(url)
    except ValueError:
        return False
    if u.scheme == "https" and u.netloc:
        return True
    return bool(settings.DEBUG and u.scheme == "http" and (u.hostname or "") in ("localhost", "127.0.0.1"))


def _secret(token: str) -> bytes:
    return hmac.new(b"WebAppData", token.encode(), hashlib.sha256).digest()


def _check_string(fields: dict) -> str:
    return "\n".join(f"{k}={fields[k]}" for k in sorted(fields))


def sign_init_data(bot, me, chat_id=None, start_param="") -> tuple[str, str]:
    """Данные запуска для страницы бота → (строка init_data, query_id)."""
    avatar = me.avatar_url or ""
    if avatar.startswith("/media/avatars/"):
        avatar = WYX_ORIGIN + avatar  # wyx.su отдаёт аватары (nginx wyx.conf)
    user = {"id": str(me.id), "username": me.username, "language_code": (me.language or "")[:8]}
    if avatar.startswith("http"):
        user["photo_url"] = avatar
    query_id = secrets.token_urlsafe(12)
    fields = {
        "query_id": query_id,
        "user": json.dumps(user, ensure_ascii=False, separators=(",", ":")),
        "auth_date": str(int(time.time())),
    }
    if chat_id:
        fields["chat_id"] = str(chat_id)
    if start_param:
        fields["start_param"] = str(start_param)[:64]
    fields["hash"] = hmac.new(_secret(bot.bot_token), _check_string(fields).encode(), hashlib.sha256).hexdigest()
    return urlencode(fields), query_id


def check_init_data(bot, init_data: str, max_age: int = INIT_TTL) -> dict | None:
    """Проверить подпись и срок. → поля (user — уже словарь) или None."""
    try:
        fields = dict(parse_qsl(init_data or "", keep_blank_values=True, strict_parsing=True))
    except ValueError:
        return None
    got = fields.pop("hash", "")
    if not got or not bot.bot_token:
        return None
    want = hmac.new(_secret(bot.bot_token), _check_string(fields).encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(got, want):
        return None
    try:
        if time.time() - int(fields.get("auth_date", "0")) > max_age:
            return None
        fields["user"] = json.loads(fields.get("user") or "{}")
    except (ValueError, TypeError):
        return None
    return fields


def _bot(pk):
    return Profile.objects.filter(id=pk, is_bot=True).first() if pk else None


class WebAppInitView(APIView):
    """POST {bot_id, url?, chat_id?, start_param?} — открыть мини-приложение:
    адрес (свой адрес бота или из кнопки его сообщения) и данные запуска."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        from .moderation import blocked_either_way
        me = getattr(request.user, "profile", None)
        if not me or me.is_bot:
            return Response({"error": "Нет профиля"}, status=403)
        bot = _bot(request.data.get("bot_id"))
        if not bot:
            return Response({"error": "Бот не найден"}, status=404)
        if blocked_either_way(me.id, bot.id):
            return Response({"error": "Нельзя открыть приложение этого бота"}, status=403)
        url = (request.data.get("url") or bot.webapp_url or "").strip()
        if not valid_app_url(url):
            return Response({"error": "У бота нет мини-приложения"}, status=404)
        chat_id = request.data.get("chat_id") or None
        if chat_id and not ChatParticipant.objects.filter(chat_id=chat_id, user=me).exists():
            chat_id = None
        init_data, query_id = sign_init_data(bot, me, chat_id, request.data.get("start_param") or "")
        return Response({
            "url": url,
            "init_data": init_data,
            "query_id": query_id,
            "title": bot.webapp_title or bot.username,
            "bot": {"id": str(bot.id), "username": bot.username, "avatar_url": bot.avatar_url},
        })


class WebAppDataView(APIView):
    """POST {bot_id, init_data, data} — страница отправила боту данные
    (WYX.WebApp.sendData). Бот получает событие web_app_data в сокет."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        me = getattr(request.user, "profile", None)
        bot = _bot(request.data.get("bot_id"))
        if not me or not bot:
            return Response({"error": "Бот не найден"}, status=404)
        fields = check_init_data(bot, request.data.get("init_data") or "")
        if not fields or str((fields.get("user") or {}).get("id")) != str(me.id):
            return Response({"error": "Данные запуска устарели — откройте приложение заново"}, status=403)
        data = request.data.get("data")
        data = data if isinstance(data, str) else json.dumps(data, ensure_ascii=False)
        if not data or len(data) > DATA_MAX:
            return Response({"error": f"Данные — от 1 до {DATA_MAX} символов"}, status=400)
        try:
            from asgiref.sync import async_to_sync
            from channels.layers import get_channel_layer
            layer = get_channel_layer()
            if layer:
                async_to_sync(layer.group_send)(f"user_{bot.id}", {"type": "notification", "data": {
                    "type": "web_app_data",
                    "data": data,
                    "query_id": fields.get("query_id"),
                    "chat_id": fields.get("chat_id"),
                    "from_id": str(me.id),
                    "from_username": me.username,
                }})
        except Exception:
            return Response({"error": "Бот сейчас недоступен"}, status=503)
        return Response({"ok": True})


# ---- Каталог и ссылки: https://wyx.su/u/<бот>?app открывает мини-приложение ----


def app_link(username: str) -> str:
    return f"{WYX_ORIGIN}/u/{username}?app"


class WebAppCatalogView(APIView):
    """GET ?q= — каталог мини-приложений: все боты с адресом приложения,
    популярные (с кем больше начатых диалогов) первыми. Это и есть перечень
    стороннего ПО внутри приложения со ссылкой на каждое (App Store 4.7.4)."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        from django.db.models import Count, OuterRef, Q, Subquery, IntegerField
        from django.db.models.functions import Coalesce
        from .moderation import blocked_ids
        me = getattr(request.user, "profile", None)
        users = (ChatParticipant.objects
                 .filter(user=OuterRef("pk"), chat__kind="direct", chat__bot_started=True)
                 .values("user").annotate(c=Count("id")).values("c"))
        qs = (Profile.objects.filter(is_bot=True).exclude(webapp_url="")
              .annotate(users=Coalesce(Subquery(users, output_field=IntegerField()), 0)))
        if me:
            qs = qs.exclude(id__in=blocked_ids(me))
        q = (request.query_params.get("q") or "").strip()
        if q:
            qs = qs.filter(Q(username__icontains=q) | Q(webapp_title__icontains=q) | Q(bio__icontains=q))
        rows = qs.order_by("-users", "username")[:200]
        return Response({"apps": [{
            "bot": {"id": str(b.id), "username": b.username, "avatar_url": b.avatar_url},
            "title": b.webapp_title or b.username,
            "description": (b.bio or "")[:300],
            "users": b.users,
            "link": app_link(b.username),
        } for b in rows]})


_PAGE_TEXT = {
    "ru": {"open": "Открыть в WYX", "get": "Скачать WYX", "bot": "бот", "app": "Мини-приложение «{t}»",
           "missing": "Такого профиля нет", "missing_hint": "Проверьте ссылку.", "lead": "Откройте ссылку на телефоне с WYX — или скачайте приложение."},
    "en": {"open": "Open in WYX", "get": "Get WYX", "bot": "bot", "app": "Mini app “{t}”",
           "missing": "No such profile", "missing_hint": "Check the link.", "lead": "Open this link on a phone with WYX — or get the app."},
    "ko": {"open": "WYX에서 열기", "get": "WYX 다운로드", "bot": "봇", "app": "미니 앱 「{t}」",
           "missing": "프로필이 없어요", "missing_hint": "링크를 확인해 주세요.", "lead": "WYX가 설치된 휴대폰에서 링크를 열거나 앱을 다운로드하세요."},
}


def wyx_user_page(request, username):
    """https://wyx.su/u/<ник>[?app] без установленного приложения: карточка
    (и превью ссылки в других мессенджерах) и кнопки «Открыть» / «Скачать».
    С приложением сюда не попадают — ссылку перехватывает приложение."""
    from django.http import HttpResponse
    from django.utils.html import escape
    accept = (request.headers.get("Accept-Language") or "").lower()
    lang = "en" if accept.startswith("en") else "ko" if accept.startswith("ko") else "ru"
    T = _PAGE_TEXT[lang]
    p = Profile.objects.filter(username__iexact=username).first()
    want_app = "app" in request.GET
    if not p:
        title, sub, desc, avatar, deep = T["missing"], "", T["missing_hint"], "", ""
    else:
        title = p.username
        sub = T["bot"] if p.is_bot else ""
        if p.is_bot and p.webapp_url:
            sub = T["app"].format(t=p.webapp_title or p.username)
        desc = (p.bio or "").strip()[:300]
        avatar = p.avatar_url or ""
        if avatar.startswith("/media/avatars/"):
            avatar = WYX_ORIGIN + avatar
        deep = f"whoyax://u/{p.username}" + ("?app" if want_app and p.webapp_url else "")
    og_image = f'<meta property="og:image" content="{escape(avatar)}">' if avatar.startswith("http") else ""
    ava_html = (f'<img class="ava" src="{escape(avatar)}" alt="">' if avatar.startswith("http")
                else '<img class="ava" src="/mark.svg" alt="">')
    open_btn = f'<a class="pill primary" href="{escape(deep)}">{T["open"]}</a>' if deep else ""
    html = f"""<!doctype html>
<html lang="{lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{escape(title)} — WYX</title>
<meta property="og:title" content="{escape(title)}">
<meta property="og:description" content="{escape(sub or desc or T['lead'])}">
<meta property="og:site_name" content="WYX">{og_image}
<link rel="icon" href="/mark.svg"><link rel="stylesheet" href="/style.css">
<style>.u{{max-width:420px;margin:56px auto;padding:0 16px;text-align:center}}
.u .ava{{width:112px;height:112px;border-radius:28px;object-fit:cover;background:var(--card,#eee)}}
.u h1{{margin:18px 0 4px;font-size:26px;color:var(--title)}}.u .sub{{color:var(--muted);margin:0 0 10px}}
.u .desc{{margin:0 0 22px;white-space:pre-line}}.u .cta{{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}}
.u .lead{{color:var(--muted);font-size:14px;margin-top:22px}}</style></head>
<body><header class="top"><div class="wrap"><a class="brand" href="/" aria-label="WYX"><img src="/mark.svg" alt="" width="30" height="30"><span>WYX</span></a></div></header>
<main class="u">{ava_html}<h1>{escape(title)}</h1>{f'<p class="sub">{escape(sub)}</p>' if sub else ''}{f'<p class="desc">{escape(desc)}</p>' if desc else ''}
<div class="cta">{open_btn}<a class="pill" href="/#download">{T['get']}</a></div>
<p class="lead">{T['lead']}</p></main></body></html>"""
    resp = HttpResponse(html, content_type="text/html; charset=utf-8", status=200 if p else 404)
    resp["Cache-Control"] = "public, max-age=300"
    return resp
