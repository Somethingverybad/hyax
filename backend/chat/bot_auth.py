"""Аутентификация ботов по токену.

Боты не логинятся паролем — они ходят в API с заголовком
``Authorization: Bot <token>`` (или ``X-Bot-Token: <token>``). Токен выдаётся
при создании бота владельцем. Если заголовка бота нет — возвращаем None, и
запрос обрабатывают обычные механизмы (JWT).
"""
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed

from .models import Profile


class BotTokenAuthentication(BaseAuthentication):
    def authenticate(self, request):
        token = (request.headers.get("X-Bot-Token") or "").strip()
        if not token:
            auth = request.headers.get("Authorization", "")
            if auth[:4].lower() == "bot ":
                token = auth[4:].strip()
        if not token:
            return None  # не наш способ аутентификации

        try:
            bot = Profile.objects.select_related("user").get(bot_token=token, is_bot=True)
        except Profile.DoesNotExist:
            raise AuthenticationFailed("Неверный токен бота")
        return (bot.user, None)

    def authenticate_header(self, request):
        return "Bot"
