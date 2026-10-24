"""Сериализатор сообщений слоя каналов (Redis): JSON, который умеет UUID,
даты и Decimal.

Слой в памяти процесса передавал объекты как есть, и в событиях для сокетов
остались UUID (id профилей и чатов) и datetime. channels_redis упаковывает
события msgpack/JSON и на UUID падает «can not serialize 'UUID' object» —
24.10.2026 так отваливалась отправка сообщений (500 на POST /api/messages/).
Здесь всё нестандартное приводится к строке так же, как это делает DRF.
"""
import datetime
import decimal
import json
import uuid

from channels_redis.serializers import JSONSerializer, registry


def _default(o):
    if isinstance(o, uuid.UUID):
        return str(o)
    if isinstance(o, (datetime.datetime, datetime.date, datetime.time)):
        return o.isoformat()
    if isinstance(o, decimal.Decimal):
        return float(o)
    if isinstance(o, (set, frozenset, tuple)):
        return list(o)
    if isinstance(o, bytes):
        return o.decode("utf-8", "replace")
    raise TypeError(f"не сериализуется в событие сокета: {type(o).__name__}")


class HyaxJSONSerializer(JSONSerializer):
    def as_bytes(self, message, *args, **kwargs):
        return json.dumps(message, default=_default, ensure_ascii=False).encode("utf-8")


registry.register_serializer("hyax-json", HyaxJSONSerializer)
