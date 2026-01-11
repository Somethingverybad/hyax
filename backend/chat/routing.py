from django.urls import re_path
from . import consumers

# Django Channels URLRouter получает путь БЕЗ начального слеша
# Путь приходит как "ws/chat/..." или "ws/user/..."
websocket_urlpatterns = [
    re_path(r'^ws/chat/(?P<chat_id>[^/]+)/$', consumers.ChatConsumer.as_asgi()),
    re_path(r'^ws/user/(?P<user_id>[^/]+)/$', consumers.UserConsumer.as_asgi()),
]
