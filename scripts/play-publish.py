#!/usr/bin/env python3
"""Выкладка AAB в Google Play через Android Publisher API.

    ~/.hyax-venv/bin/python scripts/play-publish.py [--aab /tmp/hyax-dist/wyx-1.1.38-774.aab]
        [--track alpha|internal|beta|production] [--notes notes.txt] [--notes-en notes-en.txt]
        [--status completed|draft] [--dry-run]

Без --aab берётся самый свежий /tmp/hyax-dist/wyx-*.aab. Заметки к выпуску —
файлом (ru-RU) и, если есть, английским (en-US), до 500 знаков каждая.

Нужно (один раз, см. GOOGLE_PLAY.md → «Автовыкладка»): сервисный аккаунт
Google Cloud, добавленный в Play Console с правом выпускать в треки, его
JSON-ключ в ~/.hyax-play-sa.json (права 600, вне git) и пакеты
google-api-python-client + google-auth в ~/.hyax-venv.

Порядок у API жёсткий: edit → загрузка bundle → трек → commit. Если консоль
требует отправлять изменения на проверку вручную, commit повторяется с
changesNotSentForReview=true — тогда выпуск лежит в консоли как черновик
отправки, и «Отправить на проверку» нажимается руками.
"""
from __future__ import annotations

import argparse
import glob
import os
import sys

PACKAGE = "com.hyax.messenger"
SA_PATH = os.path.expanduser("~/.hyax-play-sa.json")
SCOPES = ["https://www.googleapis.com/auth/androidpublisher"]
NOTES_MAX = 500


def newest_aab() -> str | None:
    files = glob.glob("/tmp/hyax-dist/wyx-*-*.aab")
    return max(files, key=os.path.getmtime) if files else None


def read_notes(path: str | None) -> str | None:
    if not path:
        return None
    text = open(path, encoding="utf-8").read().strip()
    if len(text) > NOTES_MAX:
        sys.exit(f"Заметки {path}: {len(text)} знаков, Play принимает до {NOTES_MAX}")
    return text


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--aab", default=newest_aab())
    ap.add_argument("--track", default="alpha", choices=["internal", "alpha", "beta", "production"])
    ap.add_argument("--notes", help="файл с заметками на русском (ru-RU)")
    ap.add_argument("--notes-en", help="файл с заметками на английском (en-US)")
    ap.add_argument("--status", default="completed", choices=["completed", "draft"],
                    help="completed — сразу выкатить в трек; draft — только загрузить, выпуск собрать руками")
    ap.add_argument("--sa", default=SA_PATH, help="JSON-ключ сервисного аккаунта")
    ap.add_argument("--dry-run", action="store_true", help="всё проверить, в Play ничего не слать")
    a = ap.parse_args()

    if not a.aab or not os.path.isfile(a.aab):
        sys.exit("Нет AAB: соберите ~/hyax-build-aab.sh или укажите --aab")
    if not os.path.isfile(a.sa):
        if not a.dry_run:
            sys.exit(f"Нет ключа сервисного аккаунта {a.sa} — см. GOOGLE_PLAY.md → «Автовыкладка»")
        print(f"! нет ключа {a.sa} — без него выложить не получится", file=sys.stderr)
    elif oct(os.stat(a.sa).st_mode & 0o777) != "0o600":
        print(f"! права на {a.sa} шире 600 — chmod 600 {a.sa}", file=sys.stderr)

    notes = [(lang, t) for lang, t in (("ru-RU", read_notes(a.notes)), ("en-US", read_notes(a.notes_en))) if t]
    size = os.path.getsize(a.aab) / 1e6
    print(f"==> {os.path.basename(a.aab)} ({size:.1f} МБ) → трек {a.track}, статус {a.status}"
          + (f", заметки: {', '.join(l for l, _ in notes)}" if notes else ", без заметок"))
    if a.dry_run:
        print("dry-run: в Play ничего не отправлено")
        return

    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build
        from googleapiclient.errors import HttpError
        from googleapiclient.http import MediaFileUpload
    except ImportError:
        sys.exit("Нужны пакеты: ~/.hyax-venv/bin/pip install google-api-python-client google-auth")

    creds = service_account.Credentials.from_service_account_file(a.sa, scopes=SCOPES)
    svc = build("androidpublisher", "v3", credentials=creds, cache_discovery=False)
    edits = svc.edits()

    edit_id = edits.insert(packageName=PACKAGE, body={}).execute()["id"]
    try:
        print("==> загрузка bundle…")
        media = MediaFileUpload(a.aab, mimetype="application/octet-stream", resumable=True, chunksize=8 * 1024 * 1024)
        req = edits.bundles().upload(packageName=PACKAGE, editId=edit_id, media_body=media)
        res = None
        while res is None:
            status, res = req.next_chunk()
            if status:
                print(f"   {status.progress() * 100:5.1f}%", end="\r", flush=True)
        code = res["versionCode"]
        print(f"\n   versionCode {code}, sha256 {res.get('sha256', '')[:12]}…")

        release = {"versionCodes": [str(code)], "status": a.status}
        if notes:
            release["releaseNotes"] = [{"language": lang, "text": t} for lang, t in notes]
        edits.tracks().update(packageName=PACKAGE, editId=edit_id, track=a.track,
                              body={"track": a.track, "releases": [release]}).execute()
        print(f"==> трек {a.track} обновлён, commit…")
        try:
            edits.commit(packageName=PACKAGE, editId=edit_id).execute()
            print(f"✓ {code} выложен в {a.track}")
        except HttpError as e:
            if "changesNotSentForReview" in str(e) or "sent for review" in str(e).lower():
                edits.commit(packageName=PACKAGE, editId=edit_id, changesNotSentForReview=True).execute()
                print(f"✓ {code} загружен в {a.track}; консоль требует отправить изменения на проверку руками "
                      "(Play Console → Обзор публикации → Отправить)")
            else:
                raise
    except Exception:
        try:
            edits.delete(packageName=PACKAGE, editId=edit_id).execute()
        except Exception:
            pass
        raise


if __name__ == "__main__":
    main()
