import logging
import sys

# Настраиваем логирование для вывода в stdout
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    stream=sys.stdout
)

logger = logging.getLogger(__name__)


class RequestLoggingMiddleware:
    """Middleware для логирования всех HTTP запросов"""
    
    def __init__(self, get_response):
        self.get_response = get_response
        print("[Middleware] ✅ RequestLoggingMiddleware инициализирован")

    def __call__(self, request):
        # Логируем входящий запрос
        auth_header = request.headers.get('Authorization', 'нет')
        auth_preview = auth_header[:50] + '...' if auth_header != 'нет' and len(auth_header) > 50 else auth_header
        
        print(f"[Middleware] 📥 {request.method} {request.path}")
        print(f"[Middleware] 📥 Authorization: {auth_preview}")
        print(f"[Middleware] 📥 User: {request.user}")
        print(f"[Middleware] 📥 Authenticated: {request.user.is_authenticated}")
        print(f"[Middleware] 📥 Headers: {dict(request.headers)}")
        
        logger.info(f"[Middleware] 📥 {request.method} {request.path}")
        logger.info(f"[Middleware] 📥 Authorization: {auth_preview}")
        logger.info(f"[Middleware] 📥 User: {request.user}")
        logger.info(f"[Middleware] 📥 Authenticated: {request.user.is_authenticated}")
        
        response = self.get_response(request)
        
        # Логируем ответ
        print(f"[Middleware] 📤 {request.method} {request.path} -> {response.status_code}")
        logger.info(f"[Middleware] 📤 {request.method} {request.path} -> {response.status_code}")
        
        return response
