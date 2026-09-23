"""Темы оформления: схема, проверка и API.

Тема — только данные: набор цветов (#RRGGBB) и параметры формы в заданных
пределах. Никакого CSS, ссылок и произвольных ключей: чужая тема не может
сломать интерфейс или спрятать элемент управления. Схема та же, что на клиенте
(sux-chat-app/src/themes/types.ts) — менять вместе.
"""
import re

from django.db import models as dj
from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Theme, UserTheme

BUILTIN_IDS = ("dark", "light", "neo", "glass-light", "glass-dark")

COLOR_KEYS = (
    "background", "foreground",
    "surface1", "surface2", "surface3", "surface4",
    "mutedForeground", "subtleForeground",
    "primary", "primaryForeground", "primaryDeep",
    "accent", "accentForeground",
    "destructive", "destructiveForeground",
    "success", "successForeground",
    "online", "amber",
    "border", "divider", "ring", "ink", "accentSoft",
    "bubbleOwn", "bubbleOwnFg", "bubbleIn", "bubbleInFg",
    "chatCanvas",
)
SHAPE_LIMITS = {
    "radius": (0, 24), "radiusField": (0, 20), "borderWidth": (1, 4),
    "shadowOffset": (0, 8), "iconStroke": (1, 2.5),
}
SHAPE_FLAGS = ("rowCards", "floatingNav")
HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")
MAX_THEMES_PER_USER = 30


class ThemeError(ValueError):
    pass


def _luminance(hex_color):
    n = int(hex_color[1:], 16)
    out = []
    for v in ((n >> 16) & 255, (n >> 8) & 255, n & 255):
        x = v / 255
        out.append(x / 12.92 if x <= 0.03928 else ((x + 0.055) / 1.055) ** 2.4)
    return 0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2]


def contrast(a, b):
    hi, lo = sorted((_luminance(a), _luminance(b)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)


def clean_theme(raw):
    """Проверить и нормализовать тему. Возвращает (name, data) либо ThemeError.
    В data попадают только известные ключи — всё лишнее молча отбрасывается."""
    if not isinstance(raw, dict):
        raise ThemeError("Тема должна быть объектом")
    name = raw.get("name")
    if not isinstance(name, str) or not name.strip():
        raise ThemeError("Укажите название темы")
    name = name.strip()[:40]
    base = raw.get("base")
    if base not in ("light", "dark"):
        raise ThemeError("base: light или dark")

    colors_in = raw.get("colors")
    if not isinstance(colors_in, dict):
        raise ThemeError("Нет цветов темы")
    colors = {}
    for key in COLOR_KEYS:
        value = colors_in.get(key)
        if not isinstance(value, str) or not HEX.match(value):
            raise ThemeError(f"Цвет «{key}» должен быть в виде #RRGGBB")
        colors[key] = value.upper()

    shape_in = raw.get("shape")
    if not isinstance(shape_in, dict):
        raise ThemeError("Нет параметров формы")
    if shape_in.get("style") not in ("flat", "outlined", "glass"):
        raise ThemeError("shape.style: flat, outlined или glass")
    shape = {"style": shape_in["style"]}
    for key, (lo, hi) in SHAPE_LIMITS.items():
        value = shape_in.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not (lo <= value <= hi):
            raise ThemeError(f"shape.{key}: число от {lo} до {hi}")
        shape[key] = value
    for key in SHAPE_FLAGS:
        if not isinstance(shape_in.get(key), bool):
            raise ThemeError(f"shape.{key}: true или false")
        shape[key] = shape_in[key]

    # Нечитаемую тему не принимаем: ею можно спрятать интерфейс от самого
    # себя и от того, кто её установит. Порог мягкий (2:1) — отсекает «белым по
    # белому», вкус не ограничивает; строже предупреждает уже редактор.
    for label, fg, bg in (
        ("текст на фоне", "foreground", "background"),
        ("текст на карточке", "foreground", "surface1"),
        ("текст на акцентной кнопке", "primaryForeground", "primary"),
        ("текст на красной кнопке", "destructiveForeground", "destructive"),
        ("свои сообщения", "bubbleOwnFg", "bubbleOwn"),
        ("входящие сообщения", "bubbleInFg", "bubbleIn"),
    ):
        if contrast(colors[fg], colors[bg]) < 2:
            raise ThemeError(f"Слишком низкий контраст: {label}")

    return name, {"version": 1, "base": base, "colors": colors, "shape": shape}


def theme_payload(theme, me=None):
    data = theme.data or {}
    return {
        "id": str(theme.id), "name": theme.name,
        "base": data.get("base"), "colors": data.get("colors"), "shape": data.get("shape"),
        "author": theme.author.username if theme.author_id else None,
        "is_public": theme.is_public,
        "mine": bool(me) and theme.author_id == me.id,
        "installed": bool(me) and UserTheme.objects.filter(user=me, theme=theme).exists(),
        "installs": theme.installed_by.count(),
        "updated_at": theme.updated_at.isoformat(),
    }


def _me(request):
    return getattr(request.user, "profile", None)


class ThemesView(APIView):
    """GET — мои темы и установленные чужие. POST — создать тему."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        me = _me(request)
        if not me:
            return Response({"error": "Profile not found"}, status=404)
        themes = Theme.objects.filter(dj.Q(author=me) | dj.Q(installed_by__user=me)).distinct().select_related("author")
        return Response({"themes": [theme_payload(t, me) for t in themes]})

    def post(self, request):
        me = _me(request)
        if not me:
            return Response({"error": "Profile not found"}, status=404)
        if Theme.objects.filter(author=me).count() >= MAX_THEMES_PER_USER:
            return Response({"error": f"Не больше {MAX_THEMES_PER_USER} своих тем"}, status=400)
        try:
            name, data = clean_theme(request.data)
        except ThemeError as e:
            return Response({"error": str(e)}, status=400)
        theme = Theme.objects.create(name=name, author=me, data=data, is_public=request.data.get("is_public") is not False)
        return Response(theme_payload(theme, me), status=201)


class ThemeDetailView(APIView):
    """GET — тема по ссылке /t/<id>. PATCH/DELETE — только автор."""
    permission_classes = [permissions.IsAuthenticated]

    def _visible(self, request, pk):
        me = _me(request)
        theme = Theme.objects.filter(pk=pk).select_related("author").first()
        if not theme:
            return me, None
        mine = bool(me) and theme.author_id == me.id
        has = bool(me) and UserTheme.objects.filter(user=me, theme=theme).exists()
        return me, (theme if theme.is_public or mine or has else None)

    def get(self, request, pk):
        me, theme = self._visible(request, pk)
        if not theme:
            return Response({"error": "Тема не найдена"}, status=404)
        return Response(theme_payload(theme, me))

    def patch(self, request, pk):
        me, theme = self._visible(request, pk)
        if not theme:
            return Response({"error": "Тема не найдена"}, status=404)
        if not me or theme.author_id != me.id:
            return Response({"error": "Менять тему может только автор"}, status=403)
        try:
            theme.name, theme.data = clean_theme(request.data)
        except ThemeError as e:
            return Response({"error": str(e)}, status=400)
        if isinstance(request.data.get("is_public"), bool):
            theme.is_public = request.data["is_public"]
        theme.save()
        return Response(theme_payload(theme, me))

    def delete(self, request, pk):
        me, theme = self._visible(request, pk)
        if not theme:
            return Response({"error": "Тема не найдена"}, status=404)
        if not me or theme.author_id != me.id:
            return Response({"error": "Удалить тему может только автор"}, status=403)
        theme.delete()
        return Response({"ok": True})


class ThemeInstallView(APIView):
    """POST — установить чужую тему себе, DELETE — убрать."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        me = _me(request)
        theme = Theme.objects.filter(pk=pk).first()
        if not me or not theme or (not theme.is_public and theme.author_id != me.id):
            return Response({"error": "Тема не найдена"}, status=404)
        if theme.author_id != me.id:
            UserTheme.objects.get_or_create(user=me, theme=theme)
        return Response(theme_payload(theme, me))

    def delete(self, request, pk):
        me = _me(request)
        if not me:
            return Response({"error": "Profile not found"}, status=404)
        UserTheme.objects.filter(user=me, theme_id=pk).delete()
        if me.active_theme == str(pk):
            me.active_theme = ""
            me.save(update_fields=["active_theme"])
        return Response({"ok": True})
