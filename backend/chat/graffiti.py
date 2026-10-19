"""Граффити — рисунок от руки, который человек отправляет стикером или
кладёт в пост картинкой (клиент: components/chat/Graffiti.tsx).

POST /api/graffiti/ (multipart file) — сохранить рисунок: PNG с прозрачностью
до 1 МБ и 1024 px по стороне. Первое граффити заводит закрытый пак «Мои
граффити» (StickerPack.is_graffiti, один на человека) и сохраняет его себе —
рисунки лежат в панели стикеров, их можно отправлять снова. Новые — первыми.
Ответ — стикер, его id уходит в сообщение (sticker_id) как у любого стикера.
"""
import os
import struct
import uuid

from django.conf import settings
from django.db import transaction
from rest_framework import permissions
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

MAX_BYTES = 1024 * 1024
MAX_SIDE = 1024
MAX_IN_PACK = 300
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def png_size(head):
    """(ширина, высота) из заголовка PNG или None, если это не PNG."""
    if len(head) < 24 or not head.startswith(PNG_SIGNATURE) or head[12:16] != b"IHDR":
        return None
    return struct.unpack(">II", head[16:24])


def graffiti_pack(me):
    """Пак «Мои граффити» этого человека — заводится при первом рисунке."""
    from .i18n import tr
    from .models import StickerPack, UserStickerPack
    pack = StickerPack.objects.filter(author=me, is_graffiti=True).first()
    if not pack:
        pack = StickerPack.objects.create(name=tr("Мои граффити", me.language), author=me, is_public=False,
                                          kind="sticker", is_graffiti=True)
    UserStickerPack.objects.get_or_create(user=me, pack=pack)
    return pack


class GraffitiView(APIView):
    parser_classes = [MultiPartParser, FormParser]
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        from django.db.models import Min
        from .models import Sticker
        from .serializers import StickerSerializer
        me = getattr(request.user, "profile", None)
        if not me:
            return Response({"error": "Profile not found"}, status=400)
        f = request.FILES.get("file")
        if not f:
            return Response({"error": "Нет рисунка"}, status=400)
        if f.size > MAX_BYTES:
            return Response({"error": "Рисунок слишком большой"}, status=400)
        data = f.read()
        size = png_size(data[:24])
        if not size:
            return Response({"error": "Граффити — картинка PNG"}, status=400)
        if not (0 < size[0] <= MAX_SIDE and 0 < size[1] <= MAX_SIDE):
            return Response({"error": "Рисунок слишком большой"}, status=400)
        with transaction.atomic():
            pack = graffiti_pack(me)
            if pack.stickers.count() >= MAX_IN_PACK:
                return Response({"error": f"В «Моих граффити» уже {MAX_IN_PACK} рисунков — удалите лишние"}, status=400)
            name = f"{uuid.uuid4()}.png"
            folder = os.path.join(settings.MEDIA_ROOT, "stickers", "graffiti")
            os.makedirs(folder, exist_ok=True)
            with open(os.path.join(folder, name), "wb") as out:
                out.write(data)
            first = pack.stickers.aggregate(m=Min("order"))["m"]
            sticker = Sticker.objects.create(pack=pack, file_url=f"/media/stickers/graffiti/{name}", file_name="graffiti.png",
                                             emoji="🎨", order=(first - 1) if first is not None else 0)
        return Response(StickerSerializer(sticker).data, status=201)
