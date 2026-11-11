"""Резервные копии базы в закрытом хранилище (бакет S3, префикс backups/db/).

Дамп снимает pg_dump в контейнере базы (в контейнере API его нет), команда
принимает его со stdin, проверяет и кладёт в хранилище; копии старше
--keep-days удаляет. Запуск — раз в час из cron на сервере: scripts/db-backup.sh.

    python manage.py backup_db < sux_chat.dump        # положить копию
    python manage.py backup_db --list                  # что лежит
    python manage.py backup_db --fetch latest > x.dump # скачать (или --fetch <ключ>)

Восстановление — scripts/db-restore.sh (pg_restore из скачанной копии).
"""
import datetime as dt
import os
import sys
import tempfile

from django.core.management.base import BaseCommand, CommandError

from chat.s3 import _cfg, _client, s3_enabled

PREFIX = "backups/db/"
MAGIC = b"PGDMP"  # начало дампа pg_dump -Fc


def _objects(cl, bucket, prefix):
    out = []
    for page in cl.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=prefix):
        out.extend(page.get("Contents", []))
    return sorted(out, key=lambda o: o["LastModified"])


class Command(BaseCommand):
    help = "Копия базы в хранилище: дамп pg_dump -Fc со stdin → backups/db/, старше --keep-days удаляются"

    def add_arguments(self, p):
        p.add_argument("--keep-days", type=int, default=7)
        p.add_argument("--min-bytes", type=int, default=100_000,
                       help="меньше — не кладём: дамп оборвался или база пустая")
        p.add_argument("--list", dest="show", action="store_true", help="показать копии")
        p.add_argument("--fetch", metavar="KEY", help="скачать копию в stdout: ключ или latest")

    def handle(self, *args, keep_days, min_bytes, show, fetch, **kw):
        if not s3_enabled():
            raise CommandError("S3 выключен (S3_ENABLED)")
        c = _cfg()
        cl = _client(c)
        bucket = c["bucket"]

        if show:
            for o in _objects(cl, bucket, PREFIX):
                self.stdout.write(f'{o["LastModified"]:%Y-%m-%d %H:%M} UTC  {o["Size"] / 1e6:7.1f} МБ  {o["Key"]}')
            return
        if fetch:
            key = fetch
            if fetch == "latest":
                objs = _objects(cl, bucket, PREFIX)
                if not objs:
                    raise CommandError("копий нет")
                key = objs[-1]["Key"]
            self.stderr.write(f"скачиваю {key}")
            cl.download_fileobj(bucket, key, sys.stdout.buffer)
            sys.stdout.buffer.flush()
            return

        with tempfile.NamedTemporaryFile(suffix=".dump") as tmp:
            n = 0
            for chunk in iter(lambda: sys.stdin.buffer.read(1 << 20), b""):
                tmp.write(chunk)
                n += len(chunk)
            tmp.flush()
            tmp.seek(0)
            if tmp.read(len(MAGIC)) != MAGIC:
                raise CommandError("на входе не дамп pg_dump -Fc — не кладу")
            if n < min_bytes:
                raise CommandError(f"дамп подозрительно мал ({n} байт) — не кладу")
            now = dt.datetime.now(dt.timezone.utc)
            key = f"{PREFIX}{now:%Y-%m-%d}/sux_chat-{now:%Y%m%d-%H%M%S}.dump"
            # ACL не ставим — бакет закрытый (см. chat/s3.upload_file).
            extra = {"ContentType": "application/octet-stream"}
            kms = os.getenv("S3_SSE_KMS_KEY_ID", "").strip()
            if kms:
                extra["ServerSideEncryption"] = "aws:kms"
                extra["SSEKMSKeyId"] = kms
            tmp.seek(0)
            cl.upload_fileobj(tmp, bucket, key, ExtraArgs=extra)

        cutoff = now - dt.timedelta(days=keep_days)
        objs = _objects(cl, bucket, PREFIX)
        old = [{"Key": o["Key"]} for o in objs if o["LastModified"] < cutoff and o["Key"] != key]
        for i in range(0, len(old), 1000):
            cl.delete_objects(Bucket=bucket, Delete={"Objects": old[i:i + 1000], "Quiet": True})
        self.stdout.write(f"{now:%Y-%m-%d %H:%M:%S} копия {key} ({n / 1e6:.1f} МБ); "
                          f"хранится {len(objs) - len(old)}, удалено старых {len(old)}")
