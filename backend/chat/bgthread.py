"""Фоновые потоки с возвратом соединения с базой.

С пулом соединений (psycopg 3, DATABASES OPTIONS pool) соединение, взятое
потоком, возвращается в пул только через connection.close(). Django делает это
сам в конце HTTP-запроса и в database_sync_to_async консьюмеров, а обычный
threading.Thread умирал с соединением на руках: пул считал его занятым
навсегда, и через пару часов воркер отвечал 500 (PoolTimeout, 24.10.2026).
Все фоновые потоки — только через spawn().
"""
import logging
import threading

logger = logging.getLogger(__name__)


def spawn(target, *args, name=None, **kwargs) -> threading.Thread:
    """Запустить target(*args, **kwargs) в daemon-потоке; по завершении (и при
    ошибке) закрыть соединения потока с базой — вернуть их в пул."""
    def run():
        try:
            target(*args, **kwargs)
        except Exception:
            logger.exception("фоновый поток %s упал", name or getattr(target, "__name__", "?"))
        finally:
            from django.db import connections
            connections.close_all()
    t = threading.Thread(target=run, name=name or getattr(target, "__name__", "bg"), daemon=True)
    t.start()
    return t
