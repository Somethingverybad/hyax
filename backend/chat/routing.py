from django.urls import re_path
from . import consumers

websocket_urlpatterns = [
    re_path(r'ws/chat/(?P<chat_id>[^/]+)/$', consumers.ChatConsumer.as_asgi()),
    re_path(r'ws/user/(?P<user_id>[^/]+)/$', consumers.UserConsumer.as_asgi()),
    # Страница трансляции звонка в OBS: вход по ключу первым сообщением (chat/obs.py).
    re_path(r'ws/obs/$', consumers.ObsConsumer.as_asgi()),
]
