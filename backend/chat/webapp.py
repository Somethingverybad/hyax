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
        if not bot or bot.bot_closed_to(me):
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
        qs = (Profile.objects.filter(is_bot=True, bot_private=False).exclude(webapp_url="")
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
    "ru": {"open": "Открыть в WYX", "get": "Скачать WYX", "web": "Веб-версия", "bot": "бот", "app": "Мини-приложение «{t}»",
           "missing": "Такого профиля нет", "missing_link": "Ссылка не работает", "missing_hint": "Проверьте ссылку.",
           "lead": "Откройте ссылку на телефоне с WYX — или скачайте приложение.",
           "channel": "канал", "stickers": "стикерпак", "emoji": "набор эмодзи", "sounds": "пак звуков",
           "theme": "тема оформления", "playlist": "плейлист", "adult": "Пак для взрослых"},
    "en": {"open": "Open in WYX", "get": "Get WYX", "web": "Web version", "bot": "bot", "app": "Mini app “{t}”",
           "missing": "No such profile", "missing_link": "This link doesn't work", "missing_hint": "Check the link.",
           "lead": "Open this link on a phone with WYX — or get the app.",
           "channel": "channel", "stickers": "sticker pack", "emoji": "emoji pack", "sounds": "sound pack",
           "theme": "theme", "playlist": "playlist", "adult": "Adult pack"},
    "ko": {"open": "WYX에서 열기", "get": "WYX 다운로드", "web": "웹 버전", "bot": "봇", "app": "미니 앱 「{t}」",
           "missing": "프로필이 없어요", "missing_link": "링크가 작동하지 않아요", "missing_hint": "링크를 확인해 주세요.",
           "lead": "WYX가 설치된 휴대폰에서 링크를 열거나 앱을 다운로드하세요.",
           "channel": "채널", "stickers": "스티커 팩", "emoji": "이모지 팩", "sounds": "사운드 팩",
           "theme": "테마", "playlist": "플레이리스트", "adult": "성인용 팩"},
}

#: Веб-версия мессенджера: кнопка «Веб-версия» на карточках wyx.su ведёт туда
#: тем же путём, а картинки из /media/ (кроме аватаров) берутся оттуда.
WEB_ORIGIN = os.getenv("WEB_ORIGIN", "https://huyax.e-tree.su").rstrip("/")


def _page_lang(request) -> str:
    accept = (request.headers.get("Accept-Language") or "").lower()
    return "en" if accept.startswith("en") else "ko" if accept.startswith("ko") else "ru"


def _abs_image(url) -> str:
    """Картинка для карточки и превью: аватары — с wyx.su, прочие файлы из
    /media/ — с основного домена, внешние https как есть."""
    url = (url or "").strip()
    if url.startswith("/media/avatars/"):
        return WYX_ORIGIN + url
    if url.startswith("/media/"):
        return WEB_ORIGIN + url
    return url if url.startswith("http") else ""


def _wyx_card(lang, *, title, sub="", desc="", image="", deep="", web_path=""):
    """Карточка wyx.su: что за ссылка, «Открыть в WYX» (whoyax://…),
    «Веб-версия» и «Скачать». Без deep — ссылка битая (404)."""
    from django.http import HttpResponse
    from django.utils.html import escape
    T = _PAGE_TEXT[lang]
    og_image = f'<meta property="og:image" content="{escape(image)}">' if image else ""
    ava_html = (f'<img class="ava" src="{escape(image)}" alt="">' if image
                else '<img class="ava" src="/mark.svg" alt="">')
    open_btn = f'<a class="pill primary" href="{escape(deep)}">{T["open"]}</a>' if deep else ""
    web_btn = f'<a class="pill" href="{escape(WEB_ORIGIN + web_path)}">{T["web"]}</a>' if deep and web_path else ""
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
.u h1{{margin:18px 0 4px;font-size:26px;color:var(--title);overflow-wrap:anywhere}}.u .sub{{color:var(--muted);margin:0 0 10px}}
.u .desc{{margin:0 0 22px;white-space:pre-line;overflow-wrap:anywhere}}.u .cta{{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}}
.u .lead{{color:var(--muted);font-size:14px;margin-top:22px}}</style></head>
<body><header class="top"><div class="wrap"><a class="brand" href="/" aria-label="WYX"><img src="/mark.svg" alt="" width="30" height="30"><span>WYX</span></a></div></header>
<main class="u">{ava_html}<h1>{escape(title)}</h1>{f'<p class="sub">{escape(sub)}</p>' if sub else ''}{f'<p class="desc">{escape(desc)}</p>' if desc else ''}
<div class="cta">{open_btn}{web_btn}<a class="pill" href="/#download">{T['get']}</a></div>
<p class="lead">{T['lead']}</p></main></body></html>"""
    resp = HttpResponse(html, content_type="text/html; charset=utf-8", status=200 if deep else 404)
    resp["Cache-Control"] = "public, max-age=300"
    return resp


def wyx_user_page(request, username):
    """https://wyx.su/u/<ник>[?app] без установленного приложения: карточка
    (и превью ссылки в других мессенджерах) и кнопки «Открыть» / «Скачать».
    С приложением сюда не попадают — ссылку перехватывает приложение."""
    from urllib.parse import quote
    lang = _page_lang(request)
    T = _PAGE_TEXT[lang]
    p = Profile.objects.filter(username__iexact=username).first()
    if p is not None and p.is_bot and p.bot_private:
        p = None  # приватный бот — снаружи его как будто нет
    if not p:
        return _wyx_card(lang, title=T["missing"], desc=T["missing_hint"])
    want_app = "app" in request.GET and bool(p.webapp_url)
    sub = T["bot"] if p.is_bot else ""
    if p.is_bot and p.webapp_url:
        sub = T["app"].format(t=p.webapp_title or p.username)
    path = f"/u/{quote(p.username)}" + ("?app" if want_app else "")
    return _wyx_card(lang, title=p.username, sub=sub, desc=(p.bio or "").strip()[:300],
                     image=_abs_image(p.avatar_url), deep="whoyax:/" + path, web_path=path)


def wyx_link_page(request, kind, ref):
    """https://wyx.su/<c|stp|sp|t|pl>/<…> без приложения — карточка канала,
    пака, темы или плейлиста; как wyx_user_page для профилей. Закрытое
    (приватный пак, отозванный плейлист) снаружи выглядит битой ссылкой."""
    import uuid as _uuid
    from urllib.parse import quote
    from .models import Chat, Playlist, SoundPack, StickerPack, Theme
    lang = _page_lang(request)
    T = _PAGE_TEXT[lang]
    ref = (ref or "").strip().strip("/")
    try:
        ref_id = _uuid.UUID(ref.lstrip("@"))
    except ValueError:
        ref_id = None
    card = None
    if kind == "c":
        ch = Chat.objects.filter(kind="channel", id=ref_id).first() if ref_id else None
        ch = ch or Chat.objects.filter(kind="channel", username__iexact=ref.lstrip("@")).first()
        if ch is not None and ch.is_public:
            card = dict(title=ch.name or (f"@{ch.username}" if ch.username else T["channel"]),
                        sub=(f"@{ch.username} · " if ch.username and ch.name != f"@{ch.username}" else "") + T["channel"],
                        desc=(ch.description or "").strip()[:300], image=_abs_image(ch.avatar_url))
    elif kind == "stp" and ref_id:
        pk = StickerPack.objects.filter(id=ref_id, is_public=True).first()
        if pk is not None:
            first = pk.stickers.order_by("order", "created_at").values_list("file_url", flat=True).first() if not pk.is_adult else None
            card = dict(title=T["adult"] if pk.is_adult else pk.name,
                        sub=T["emoji"] if pk.kind == "emoji" else T["stickers"],
                        image=_abs_image(first) if first and not str(first).endswith(".tgs") else "")
    elif kind == "sp" and ref_id:
        pk = SoundPack.objects.filter(id=ref_id, is_public=True).first()
        if pk is not None:
            card = dict(title=T["adult"] if pk.is_adult else pk.name, sub=T["sounds"],
                        image="" if pk.is_adult else _abs_image(pk.cover_url))
    elif kind == "t" and ref_id:
        th = Theme.objects.filter(id=ref_id, is_public=True).first()
        if th is not None:
            card = dict(title=th.name, sub=T["theme"])
    elif kind == "pl" and ref:
        pl = Playlist.objects.filter(share_token=ref).exclude(share_token="").first()
        if pl is not None:
            card = dict(title=pl.name, sub=T["playlist"])
    if card is None:
        return _wyx_card(lang, title=T["missing_link"], desc=T["missing_hint"])
    path = f"/{kind}/{quote(ref)}"
    post = request.GET.get("post")
    if kind == "c" and post:
        path += f"?post={quote(post)}"
    return _wyx_card(lang, deep="whoyax:/" + path, web_path=path, **card)
