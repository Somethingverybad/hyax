import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

# === Безопасность ===
SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "unsafe-secret-key")
DEBUG = os.getenv("DEBUG", "False") == "True"
# Для локальной разработки можно использовать ["*"]
# Для продакшена укажите конкретные домены/IP
ALLOWED_HOSTS = [
    "huyax.e-tree.su", 
    "cdn.huyax.e-tree.su",
    "localhost", 
    "127.0.0.1", 
    "95.214.63.151",
    "192.168.0.5",  # Ваш локальный IP-адрес
    "api",  # имя сервиса в docker-compose: по нему ходит бот (bots/media-bot)
    # Или для разработки: ALLOWED_HOSTS = ["*"]
]

# === Приложения ===
INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # External
    "rest_framework",
    "corsheaders",
    "channels",
    "chat",
]

# === Middleware ===
MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "sux_chat.urls"

# === Templates ===
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "sux_chat.wsgi.application"
ASGI_APPLICATION = "sux_chat.asgi.application"

# === Журнал ===
# daphne сам включал вывод INFO в stdout (logging.basicConfig); gunicorn этого
# не делает, и строки chat.* (presence, push, metrics) пропадали из docker logs.
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"plain": {"format": "%(asctime)s %(levelname)-8s %(message)s"}},
    "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "plain"}},
    "root": {"handlers": ["console"], "level": "INFO"},
    "loggers": {
        # Свои обработчики и формат у gunicorn/uvicorn — не дублируем.
        "gunicorn": {"propagate": False},
        "uvicorn": {"propagate": False},
    },
}

# === Redis: несколько процессов api ===
# С REDIS_URL слой каналов, кэш Django и присутствие (chat/presence.py) живут
# в Redis — так api можно запускать несколькими процессами (gunicorn с
# воркерами uvicorn в docker-compose): сокет человека в одном процессе, а
# HTTP-запрос, который шлёт ему событие или решает, нужен ли пуш, — в другом.
# Без REDIS_URL (тесты, локальный стенд) всё в памяти одного процесса.
REDIS_URL = os.getenv("REDIS_URL", "")

if REDIS_URL:
    import sux_chat.channel_serializer  # noqa: F401 — регистрирует формат hyax-json
    CHANNEL_LAYERS = {
        "default": {
            "BACKEND": "channels_redis.core.RedisChannelLayer",
            "CONFIG": {
                # socket_timeout: у redis-py 8 по умолчанию 5 с — ровно столько
                # же ждёт BZPOPMIN в приёме сообщений канала (brpop_timeout), и
                # каждое соединение падало с TimeoutError через 5 с простоя —
                # сокеты рвались и переподключались без конца.
                "hosts": [{"address": REDIS_URL, "socket_timeout": 30}],
                "prefix": "hyax",
                # JSON с UUID и датами (sux_chat/channel_serializer.py): в
                # событиях для сокетов остались UUID, msgpack на них падал.
                "serializer_format": "hyax-json",
                # Очередь на сокет: клиент, который не читает (свёрнутое
                # приложение), не должен копить сотни событий.
                "capacity": 500,
                "expiry": 30,
            },
        },
    }
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.redis.RedisCache",
            "LOCATION": REDIS_URL,
            "KEY_PREFIX": "hyax",
        },
    }
else:
    CHANNEL_LAYERS = {
        "default": {
            "BACKEND": "channels.layers.InMemoryChannelLayer",
        },
    }

# === База данных (PostgreSQL в Docker) ===
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.getenv("POSTGRES_DB"),
        "USER": os.getenv("POSTGRES_USER"),
        "PASSWORD": os.getenv("POSTGRES_PASSWORD"),
        "HOST": "db",  # имя контейнера PostgreSQL из docker-compose.yml
        "PORT": "5432",
        # Пул соединений Django (psycopg 3, OPTIONS pool) пробовали 24.10 и
        # откатили: под ASGI соединение возвращается в пул только через
        # connection.close(), а при обрыве запроса клиентом и в фоновых
        # потоках этого не происходит — через часы (а в час пик — минуты)
        # пул исчерпан и воркер отвечает 500 (PoolTimeout). Пул должен жить
        # вне процесса (pgbouncer): там соединение освобождается по закрытию
        # TCP, которое гарантирует сборщик мусора.
    }
}

# === Пароли ===
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# === Локализация ===
LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

# === Статика ===
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "static"

# === Медиа файлы ===
# JWT: дефолтные 5 минут не годятся — по этому же токену авторизуется
# WebSocket, а он живёт часами (чаты, звонки). Клиент всё равно обновляет
# токен перед каждым подключением, но с суточным сроком это редкий случай.
from datetime import timedelta

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(days=1),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=90),
}

MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

# === Безопасность и HTTPS ===
CSRF_COOKIE_SECURE = True
SESSION_COOKIE_SECURE = True
SECURE_SSL_REDIRECT = False
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# === CORS настройки ===
# Для локальной разработки можно использовать CORS_ALLOW_ALL_ORIGINS = True
# Для продакшена используйте конкретные домены/IP в CORS_ALLOWED_ORIGINS

CORS_ALLOWED_ORIGINS = [
    "https://huyax.e-tree.su",
    "https://cdn.huyax.e-tree.su",
    "http://huyax.e-tree.su",
    "http://localhost:5143",  # Electron версия
    "http://localhost:5173",  # PWA версия (dev)
    "http://localhost:5174",  # PWA версия (preview)
    "http://95.214.63.151:8080",
    # Добавьте IP вашего компьютера для доступа из локальной сети:
    # "http://192.168.0.5",  # Замените на ваш IP
    # "http://192.168.0.5:80",
]

# ВРЕМЕННО для локальной разработки - разрешить все источники
# ⚠️ ВНИМАНИЕ: Закомментируйте это в продакшене!
CORS_ALLOW_ALL_ORIGINS = True  # True для локальной разработки, False для продакшена
CORS_ALLOW_CREDENTIALS = True

# Разрешенные методы
CORS_ALLOW_METHODS = [
    "DELETE",
    "GET",
    "OPTIONS",
    "PATCH",
    "POST",
    "PUT",
]

# Разрешенные заголовки
CORS_ALLOW_HEADERS = [
    "accept",
    "accept-encoding",
    "authorization",
    "content-type",
    "dnt",
    "origin",
    "user-agent",
    "x-csrftoken",
    "x-requested-with",
    # Условный запрос списка чатов (ETag → 304), см. ChatViewSet.list.
    'if-none-match',
]
# ETag списка чатов должен быть виден скрипту приложения (capacitor://, app://).
CORS_EXPOSE_HEADERS = ['ETag']

CSRF_TRUSTED_ORIGINS = [
    "https://huyax.e-tree.su",
    "http://huyax.e-tree.su",
    "http://localhost:5143",
    "http://localhost:5173",
    "http://localhost:5174",
    "http://95.214.63.151:8080",
]

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': (
        'chat.device_auth.DeviceJWTAuthentication',  # JWT + проверка, что сеанс не завершён
        'chat.bot_auth.BotTokenAuthentication',
    ),
}
