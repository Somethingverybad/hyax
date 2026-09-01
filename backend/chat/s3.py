"""S3-совместимое объектное хранилище для вложений сообщений.

Включается через .env (S3_ENABLED=1). Если выключено — вьюха загрузки пишет
файлы локально, как раньше. На S3 уходят только вложения сообщений (фото,
видео, файлы) — основной объём; звуки/стикеры/аватары остаются локально,
чтобы не ломать серверную конверсию (ffmpeg работает с локальными путями).

Совместимо с Yandex Object Storage, Selectel, MinIO, AWS S3.
  S3_ENABLED=1
  S3_ENDPOINT_URL=https://storage.yandexcloud.net
  S3_BUCKET=hyax-media
  S3_ACCESS_KEY_ID=...
  S3_SECRET_ACCESS_KEY=...
  S3_REGION=ru-central1
  S3_PUBLIC_URL=            # опционально: свой домен/CDN перед бакетом
"""
import mimetypes
import os


def s3_enabled() -> bool:
    return os.getenv("S3_ENABLED", "").strip().lower() in ("1", "true", "yes")


def _cfg():
    return {
        "endpoint": os.getenv("S3_ENDPOINT_URL", "").rstrip("/"),
        "bucket": os.getenv("S3_BUCKET", ""),
        "key": os.getenv("S3_ACCESS_KEY_ID", ""),
        "secret": os.getenv("S3_SECRET_ACCESS_KEY", ""),
        "region": os.getenv("S3_REGION", "ru-central1"),
        "public": os.getenv("S3_PUBLIC_URL", "").rstrip("/"),
    }


def _client(c):
    import boto3
    from botocore.config import Config

    return boto3.client(
        "s3",
        endpoint_url=c["endpoint"],
        aws_access_key_id=c["key"],
        aws_secret_access_key=c["secret"],
        region_name=c["region"],
        config=Config(signature_version="s3v4"),
    )


def public_url(key: str) -> str:
    c = _cfg()
    base = c["public"] or f'{c["endpoint"]}/{c["bucket"]}'
    return f"{base}/{key}"


def upload_file(local_path: str, key: str, content_type: str | None = None) -> str:
    """Загружает локальный файл в бакет ПРИВАТНО и возвращает маркер s3://key.
    Прямого публичного URL нет — доступ только по временной подписанной ссылке
    (см. presigned_get), которую сервер выдаёт после проверки прав."""
    c = _cfg()
    cl = _client(c)
    ctype = content_type or mimetypes.guess_type(local_path)[0] or "application/octet-stream"
    extra = {"ACL": "private", "ContentType": ctype}
    # Шифрование at-rest, если задан KMS-ключ (Yandex/AWS). Иначе полагаемся на
    # дефолтное шифрование бакета, настроенное в консоли.
    kms = os.getenv("S3_SSE_KMS_KEY_ID", "").strip()
    if kms:
        extra["ServerSideEncryption"] = "aws:kms"
        extra["SSEKMSKeyId"] = kms
    with open(local_path, "rb") as f:
        cl.upload_fileobj(f, c["bucket"], key, ExtraArgs=extra)
    return f"s3://{key}"


def presigned_get(key: str, expires: int = 3600) -> str:
    """Временная подписанная ссылка на приватный объект (по умолчанию 1 час)."""
    c = _cfg()
    cl = _client(c)
    return cl.generate_presigned_url(
        "get_object",
        Params={"Bucket": c["bucket"], "Key": key},
        ExpiresIn=expires,
    )
