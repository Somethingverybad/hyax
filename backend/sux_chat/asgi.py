"""
ASGI config for sux_chat project.

It exposes the ASGI callable as a module-level variable named ``application``.

For more information on this file, see
https://docs.djangoproject.com/en/5.2/howto/deployment/asgi/
"""

import os
import logging
from django.core.asgi import get_asgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'sux_chat.settings')

logger = logging.getLogger(__name__)

# Инициализируем Django ASGI application для обработки HTTP запросов
# Это должно быть вызвано ДО импорта chat.routing
django_asgi_app = get_asgi_application()

# Импортируем routing ПОСЛЕ инициализации Django
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.auth import AuthMiddlewareStack

# Импортируем routing только после того, как Django настроен
def get_websocket_urlpatterns():
    from chat import routing
    patterns = routing.websocket_urlpatterns
    logger.info(f"[ASGI] Loaded {len(patterns)} WebSocket URL patterns:")
    for p in patterns:
        logger.info(f"  - {p.pattern}")
    return patterns

# Middleware для логирования WebSocket путей
class WebSocketPathLogger:
    def __init__(self, app):
        self.app = app
    
    async def __call__(self, scope, receive, send):
        # Логируем ВСЕ запросы для отладки
        path = scope.get('path', 'N/A')
        scope_type = scope.get('type', 'N/A')
        logger.info(f"[ASGI] ========== Request ==========")
        logger.info(f"[ASGI] Type: {scope_type}")
        logger.info(f"[ASGI] Path: {path}")
        logger.info(f"[ASGI] Query string: {scope.get('query_string', b'').decode()}")
        if 'headers' in scope:
            headers = dict(scope.get('headers', []))
            upgrade = headers.get(b'upgrade', b'').decode() if b'upgrade' in headers else 'N/A'
            connection = headers.get(b'connection', b'').decode() if b'connection' in headers else 'N/A'
            logger.info(f"[ASGI] Upgrade header: {upgrade}")
            logger.info(f"[ASGI] Connection header: {connection}")
        return await self.app(scope, receive, send)

# Логирование загруженных паттернов
patterns = get_websocket_urlpatterns()

application = ProtocolTypeRouter({
    "http": django_asgi_app,
    "websocket": WebSocketPathLogger(
        AuthMiddlewareStack(
            URLRouter(patterns)
        )
    ),
})
