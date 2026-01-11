"""
ASGI config for sux_chat project.

It exposes the ASGI callable as a module-level variable named ``application``.

For more information on this file, see
https://docs.djangoproject.com/en/5.2/howto/deployment/asgi/
"""

import os
from django.core.asgi import get_asgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'sux_chat.settings')

# Инициализируем Django ASGI application для обработки HTTP запросов
# Это должно быть вызвано ДО импорта chat.routing
django_asgi_app = get_asgi_application()

# Импортируем routing ПОСЛЕ инициализации Django
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.auth import AuthMiddlewareStack

# Импортируем routing только после того, как Django настроен
def get_websocket_urlpatterns():
    from chat import routing
    return routing.websocket_urlpatterns

application = ProtocolTypeRouter({
    "http": django_asgi_app,
    "websocket": AuthMiddlewareStack(
        URLRouter(
            get_websocket_urlpatterns()
        )
    ),
})
