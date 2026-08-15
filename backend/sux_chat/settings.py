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
    "localhost", 
    "127.0.0.1", 
    "95.214.63.151",
    "192.168.0.5",  # Ваш локальный IP-адрес
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

# Channels configuration
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
]

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
        'rest_framework_simplejwt.authentication.JWTAuthentication',
    ),
}
