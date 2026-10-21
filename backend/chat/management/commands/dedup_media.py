"""Дубли в хранилище S3: одинаковые файлы, загруженные до дедупликации
(FileBlob, views._finalize_dedup), и объекты, на которые ничего не ссылается.

    manage.py dedup_media                 # только посчитать и показать
    manage.py dedup_media --apply         # переписать ссылки на один экземпляр и удалить лишние
    manage.py dedup_media --orphans       # кандидаты в сироты: ключ не встречается нигде в базе, объект старше 30 дней
    manage.py dedup_media --orphans --apply-orphans   # удалить этих кандидатов (после просмотра списка!)
    manage.py dedup_media --prefix messages/ --prefix music/   # по умолчанию эти два

Как ищем одинаковое: ETag объекта, загруженного одним куском, — это MD5
содержимого; группируем по (размер, ETag). У многочастных загрузок ETag не
хеш — такие сравниваем по sha256, скачивая только те, у кого совпал размер
с кем-то ещё. Канонический экземпляр группы — самый старый по дате в бакете.

Ссылки в базе: все текстовые поля моделей chat, чьё имя кончается на _url или
равно sticker_file, со значением s3://<ключ>. Адрес вложения секретного чата
лежит внутри шифротекста, в JSON-полях (кнопки ботов, свои реакции, темы) —
тоже не разглядеть, поэтому «без ссылок» не значит «не нужен»: удаляем только
те дубли, чьи ссылки мы сами переписали на канонический экземпляр. Сироты
лишь считаются.
"""
from __future__ import annotations

import hashlib
import os
from collections import defaultdict

from django.apps import apps
from django.core.management.base import BaseCommand
from django.db import models, transaction

from chat.s3 import _cfg, _client, s3_enabled


def _url_fields():
    """(модель, поле) — где в базе лежат адреса файлов."""
    out = []
    for m in apps.get_app_config("chat").get_models():
        for f in m._meta.get_fields():
            if isinstance(f, (models.TextField, models.CharField)) and (f.name.endswith("_url") or f.name == "sticker_file"):
                out.append((m, f.name))
    return out


class Command(BaseCommand):
    help = "Дубли и сироты в S3: посчитать, с --apply — схлопнуть"

    def add_arguments(self, p):
        p.add_argument("--apply", action="store_true", help="переписать ссылки и удалить лишние объекты")
        p.add_argument("--prefix", action="append", help="префиксы в бакете (по умолчанию messages/ и music/)")
        p.add_argument("--limit", type=int, default=0, help="показать не больше N групп")
        p.add_argument("--orphans", action="store_true", help="основательно проверить объекты без ссылок: ключ ищется во всех текстовых и JSON-полях")
        p.add_argument("--apply-orphans", action="store_true", help="удалить найденных кандидатов в сироты")
        p.add_argument("--min-age-days", type=int, default=30, help="сироты моложе не трогаем (недозалитое, в работе)")

    def handle(self, *args, **o):
        if not s3_enabled():
            self.stderr.write("S3 выключено (S3_ENABLED)")
            return
        c = _cfg()
        s3 = _client(c)
        bucket = c["bucket"]
        prefixes = o["prefix"] or ["messages/", "music/"]

        # 1. Все объекты.
        objs = {}
        for prefix in prefixes:
            token = None
            while True:
                kw = {"Bucket": bucket, "Prefix": prefix, "MaxKeys": 1000}
                if token:
                    kw["ContinuationToken"] = token
                r = s3.list_objects_v2(**kw)
                for x in r.get("Contents", []):
                    objs[x["Key"]] = {"size": x["Size"], "etag": x["ETag"].strip('"'), "at": x["LastModified"]}
                if not r.get("IsTruncated"):
                    break
                token = r.get("NextContinuationToken")
        total_bytes = sum(v["size"] for v in objs.values())
        self.stdout.write(f"объектов: {len(objs)}, {total_bytes / 1e9:.2f} ГБ в {', '.join(prefixes)}")

        # 2. Ссылки из базы: ключ → [(модель, поле, pk)].
        refs = defaultdict(list)
        for m, field in _url_fields():
            for pk, val in m.objects.filter(**{f"{field}__startswith": "s3://"}).values_list("pk", field):
                refs[val[5:]].append((m, field, pk))
        self.stdout.write(f"ссылок из базы: {sum(len(v) for v in refs.values())} на {len(refs)} ключей")

        # 3. Группы одинаковых. Однократные ETag — сразу; многочастные — по sha256 при совпадении размера.
        by_sig = defaultdict(list)
        multipart_by_size = defaultdict(list)
        for key, v in objs.items():
            if "-" in v["etag"]:
                multipart_by_size[v["size"]].append(key)
            else:
                by_sig[("md5", v["size"], v["etag"])].append(key)
        hashed = 0
        for size, keys in multipart_by_size.items():
            if len(keys) < 2:
                continue
            for key in keys:
                h = hashlib.sha256()
                body = s3.get_object(Bucket=bucket, Key=key)["Body"]
                for chunk in iter(lambda: body.read(4 * 1024 * 1024), b""):
                    h.update(chunk)
                hashed += 1
                by_sig[("sha", size, h.hexdigest())].append(key)
        if hashed:
            self.stdout.write(f"многочастных сравнили по sha256: {hashed}")
        groups = [sorted(keys, key=lambda k: objs[k]["at"]) for keys in by_sig.values() if len(keys) > 1]
        groups.sort(key=lambda g: -objs[g[0]]["size"] * (len(g) - 1))
        # Канонический — самый старый из тех, на кого есть ссылки (иначе просто самый старый).
        for g in groups:
            g.sort(key=lambda k: (not refs.get(k), objs[k]["at"]))
        removable = [(g[0], [k for k in g[1:] if refs.get(k)]) for g in groups]
        dup_bytes = sum(objs[k]["size"] for _, rest in removable for k in rest)
        dup_count = sum(len(rest) for _, rest in removable)
        blind = sum(1 for g in groups for k in g[1:] if not refs.get(k))
        self.stdout.write(f"групп дублей: {len(groups)}, лишних со ссылками (можно удалить): {dup_count}, освободится {dup_bytes / 1e9:.2f} ГБ; "
                          f"лишних без ссылок (не трогаем — могут быть вложения секретных чатов): {blind}")
        for g in groups[: o["limit"] or 15]:
            self.stdout.write(f"  {objs[g[0]]['size'] / 1e6:7.1f} МБ × {len(g)}  {g[0]}  (ссылок: {sum(len(refs.get(k, [])) for k in g)})")

        orphans = [k for k in objs if k not in refs]
        orphan_bytes = sum(objs[k]["size"] for k in orphans)
        self.stdout.write(f"без ссылок в базе: {len(orphans)}, {orphan_bytes / 1e9:.2f} ГБ (секретные чаты, JSON-поля, удалённые аккаунты — не удаляем)")

        if o["orphans"]:
            self._orphans(s3, bucket, objs, orphans, refs, o)
        if not o["apply"]:
            if not o["orphans"]:
                self.stdout.write("ничего не менял: запустите с --apply")
            return

        # 4. Применить: ссылки → канонический ключ, лишнее удалить.
        freed = 0
        deleted = 0
        rewritten = 0
        for canon, rest in removable:
            if not rest:
                continue
            with transaction.atomic():
                for key in rest:
                    for m, field, pk in refs.get(key, []):
                        m.objects.filter(pk=pk).update(**{field: f"s3://{canon}"})
                        rewritten += 1
            for key in rest:
                s3.delete_object(Bucket=bucket, Key=key)
                freed += objs[key]["size"]
                deleted += 1
        self.stdout.write(f"дубли: переписано ссылок {rewritten}, удалено {deleted} объектов, {freed / 1e9:.2f} ГБ")

    def _orphans(self, s3, bucket, objs, orphans, refs, o):
        """Кандидаты в сироты: ключ не встречается ни в одном текстовом или JSON-поле
        базы (включая шифротекст, кнопки ботов, темы), объект старше min-age-days."""
        import json
        from datetime import timedelta
        from django.utils import timezone
        # Весь текст базы одной строкой: все Text/Char/JSON-поля всех моделей chat.
        parts = []
        scanned = 0
        for m in apps.get_models():
            names = [f.name for f in m._meta.get_fields()
                     if isinstance(f, (models.TextField, models.CharField, models.JSONField))]
            if not names:
                continue
            for row in m.objects.values_list(*names).iterator(chunk_size=2000):
                scanned += 1
                for v in row:
                    if v:
                        parts.append(v if isinstance(v, str) else json.dumps(v, ensure_ascii=False))
        haystack = "\n".join(parts)
        # Самопроверка поиска: каждый ключ, у которого ссылки точно есть, обязан
        # находиться подстрокой. Не нашёлся хоть один — поиск дырявый, не удаляем.
        known = [k for k in objs if refs.get(k)]
        missed = [k for k in known if os.path.basename(k) not in haystack]
        self.stdout.write(f"самопроверка: строк просмотрено {scanned}, моделей {len(list(apps.get_models()))}; "
                          f"известных ключей {len(known)}, не найдено подстрокой {len(missed)}")
        if missed:
            self.stderr.write("самопроверка не прошла — удаление отключено; примеры: " + ", ".join(missed[:3]))
            o["apply_orphans"] = False
        try:
            with open(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))), "private", "s3_orphans.log"), encoding="utf-8") as f:
                orphan_log = f.read()
        except OSError:
            orphan_log = ""
        cutoff = timezone.now() - timedelta(days=o["min_age_days"])
        cands, young, mentioned = [], 0, 0
        for key in orphans:
            if objs[key]["at"] > cutoff:
                young += 1
                continue
            base = os.path.basename(key)
            if base in haystack:
                mentioned += 1
                continue
            cands.append(key)
        cands.sort(key=lambda k: -objs[k]["size"])
        cand_bytes = sum(objs[k]["size"] for k in cands)
        logged = sum(1 for k in cands if os.path.basename(k) in orphan_log)
        self.stdout.write(f"сироты: моложе {o['min_age_days']} дн. — {young} (пропущены); упомянуты где-то в базе — {mentioned} (оставлены); "
                          f"кандидатов на удаление — {len(cands)}, {cand_bytes / 1e9:.2f} ГБ, из них {logged} уже отмечены в s3_orphans.log")
        for k in cands[: o["limit"] or 20]:
            self.stdout.write(f"  {objs[k]['size'] / 1e6:7.1f} МБ  {objs[k]['at']:%Y-%m-%d}  {k}")
        if not o["apply_orphans"]:
            return
        # Журнал удалённого — рядом с s3_orphans.log, не в media (его раздаёт nginx).
        from django.conf import settings
        log_dir = os.path.join(settings.BASE_DIR, "private")
        os.makedirs(log_dir, exist_ok=True)
        freed = 0
        with open(os.path.join(log_dir, "s3_deleted.log"), "a", encoding="utf-8") as log:
            stamp = timezone.now().isoformat(timespec="seconds")
            for k in cands:
                s3.delete_object(Bucket=bucket, Key=k)
                freed += objs[k]["size"]
                log.write(f"{stamp}\t{k}\t{objs[k]['size']}\t{objs[k]['at']:%Y-%m-%d}\n")
        self.stdout.write(f"сироты: удалено {len(cands)} объектов, {freed / 1e9:.2f} ГБ; журнал private/s3_deleted.log")
