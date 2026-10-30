"""Питомцы: шкала состояния, уход раз в сутки, вайб за уход, напоминания хозяину.

Рисунки и поведение — в паке клиента (sux-chat-app/public/pets/<вид>/, формат —
design/pets/README.md). Здесь только правила, которым клиент не указ:

- Шкала одна, 0…100. Хранится значением level на момент level_at и убывает на
  DAY_DECAY в сутки — считаем на лету (current_level), фоновых задач нет.
- Уход — «покормить» или «погладить» (и первый тап по питомцу за сутки).
  Каждый человек — одно действие в сутки на питомца, за него +1 к вайбу.
  Хозяин поднимает шкалу на OWNER_GAIN (каждый день — держит в норме),
  гость — на GUEST_GAIN (друзья делают питомца счастливым).
- Настроение (mood) — из шкалы и того, когда кормили и гладили.
- Питомец живёт в одном чате хозяина (chat) — туда его зовут из меню чата,
  там его видят все участники, в списке чатов у этого чата лапка. chat пуст —
  питомец дома, только в профиле.
- В группе питомцев не больше Chat.pet_limit (по умолчанию 3, 0 — выключены).
  Мест нет — не позвать (вытеснять первых нельзя: так выгоняли бы назло).
  Владелец группы меняет лимит и отправляет домой любого питомца; уменьшил
  лимит — лишние, пришедшие последними, уходят домой сами.
- Хозяин сутки не ухаживал — пуш, как у Duolingo: раз в сутки, текст по
  состоянию, не больше REMIND_MAX подряд. Сутки отсчитываются от его ухода,
  поэтому напоминание приходит примерно в то время, когда он обычно заходит.
"""
from __future__ import annotations

import logging
import re
from datetime import timedelta

from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.db import models, transaction
from django.utils import timezone
from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.views import APIView

from .i18n import L
from .models import Chat, ChatParticipant, Pet, PetCare, Profile

logger = logging.getLogger(__name__)

SPECIES = ("cat", "rabbit", "frog", "kitty", "bunny", "dog")
SEXES = ("m", "f")
ACC_MAX = 8
DAY_DECAY = 25.0
OWNER_GAIN = 30.0
GUEST_GAIN = 15.0
CARE_COOLDOWN = timedelta(hours=24)
REMIND_AFTER = timedelta(hours=24)
REMIND_MAX = 7
PET_CARE_VIBE = 1
ACTIONS = ("feed", "pet")
# Объелся: трижды покормили за 12 часов (гости тоже кормят) — 4 часа валяется кверху пузом.
OVERFED_FEEDS = 3
OVERFED_WINDOW = timedelta(hours=12)
OVERFED_FOR = timedelta(hours=4)
NAME_MAX = 40
# Окрасы описаны в паке клиента; сервер только хранит имя (неизвестное клиент рисует как есть).
COLOR_RE = re.compile(r"^[a-z0-9_-]{0,24}$")
PET_CHAT_KINDS = ("direct", "group", "secret")  # не в каналах и не на стене
PET_LIMIT_MAX = 10  # потолок лимита группы
NOTIFY_MEMBERS_MAX = 300


def current_level(pet: Pet, now=None) -> float:
    now = now or timezone.now()
    hours = max(0.0, (now - pet.level_at).total_seconds() / 3600)
    return max(0.0, min(100.0, pet.level - hours * DAY_DECAY / 24))


def _since(at, now):
    return (now - at) if at else timedelta(days=365)


def mood(pet: Pet, now=None, level=None) -> str:
    """happy · content · bored · hungry · lonely · sad · sick · overfed."""
    now = now or timezone.now()
    lv = current_level(pet, now) if level is None else level
    if lv >= 45 and pet.last_fed_at and _since(pet.last_fed_at, now) < OVERFED_FOR:
        feeds = PetCare.objects.filter(pet=pet, action="feed", created_at__gte=pet.last_fed_at - OVERFED_WINDOW).count()
        if feeds >= OVERFED_FEEDS:
            return "overfed"
    if lv >= 85:
        return "happy"
    if lv >= 65:
        return "content"
    if lv >= 45:
        return "bored"
    if lv >= 1:
        # Чего не хватает дольше — то и показывает: голод царапается, обида — спиной.
        if lv >= 25:
            fed, petted = _since(pet.last_fed_at, now), _since(pet.last_petted_at, now)
            if fed > timedelta(hours=48) and fed >= petted:
                return "hungry"
            if petted > timedelta(hours=48):
                return "lonely"
        return "sad"
    return "sick"


def _who(p: Profile) -> dict:
    return {"id": str(p.id), "username": p.username, "avatar_url": p.avatar_url}


def next_care_at(pet: Pet, viewer: Profile | None, now=None):
    """Когда viewer снова сможет ухаживать (None — уже можно)."""
    if not viewer:
        return None
    now = now or timezone.now()
    last = PetCare.objects.filter(pet=pet, carer=viewer, created_at__gt=now - CARE_COOLDOWN).order_by("-created_at").first()
    return (last.created_at + CARE_COOLDOWN) if last else None


def pet_json(pet: Pet, viewer: Profile | None = None, now=None, brief=False) -> dict:
    now = now or timezone.now()
    lv = current_level(pet, now)
    out = {
        "id": str(pet.id),
        "owner_id": str(pet.owner_id),
        "species": pet.species,
        "name": pet.name,
        "level": round(lv),
        "mood": mood(pet, now, lv),
        "show_in_chats": pet.show_in_chats,
        "chat_id": str(pet.chat_id) if pet.chat_id else None,
        "color": pet.color,
        "sex": pet.sex,
        "accessories": pet.accessories,
    }
    if brief:
        return out
    if viewer is not None and viewer.id == pet.owner_id:
        out["chat"] = {"id": str(pet.chat_id), "title": _chat_title(pet.chat, viewer)} if pet.chat_id else None
    nxt = next_care_at(pet, viewer, now)
    today = (PetCare.objects.filter(pet=pet, created_at__gt=now - CARE_COOLDOWN)
             .select_related("carer").order_by("-created_at")[:12])
    out.update({
        "last_fed_at": pet.last_fed_at.isoformat() if pet.last_fed_at else None,
        "last_petted_at": pet.last_petted_at.isoformat() if pet.last_petted_at else None,
        "can_care": viewer is not None and not viewer.is_bot and nxt is None,
        "next_care_at": nxt.isoformat() if nxt else None,
        "today": [{"who": _who(c.carer), "action": c.action, "at": c.created_at.isoformat()} for c in today],
        "cares_total": PetCare.objects.filter(pet=pet).count(),
    })
    return out


def _chat_title(chat: Chat, viewer: Profile) -> str:
    """Как чат называется у хозяина: группа — по имени, личный — по собеседнику."""
    if chat.name:
        return chat.name
    other = chat.participants.exclude(id=viewer.id).only("username").first()
    return other.username if other else ""


class NotInChat(Exception):
    pass


class ChatFull(Exception):
    """Мест для питомцев в группе нет (code=pets_full) или они выключены (pets_off)."""
    def __init__(self, code, pets=(), limit=0):
        self.code, self.pets, self.limit = code, list(pets), limit


def is_group_owner(chat: Chat, me: Profile) -> bool:
    """Владелец группы — её создатель (как в настройках группы, ChatViewSet.configure)."""
    return chat.kind == "group" and (chat.creator_id == me.id or not chat.creator_id and
                                     ChatParticipant.objects.filter(chat=chat, user=me).exists())


def move(pet: Pet, me: Profile, chat_id) -> Pet:
    """Позвать питомца в чат хозяина (chat_id) или отправить домой (None)."""
    if pet.owner_id != me.id:
        raise NotInChat()
    chat = None
    if chat_id:
        try:
            chat = Chat.objects.filter(id=chat_id, kind__in=PET_CHAT_KINDS).first()
        except (ValueError, ValidationError):
            raise NotInChat()
        if not chat or not ChatParticipant.objects.filter(chat=chat, user=me).exists():
            raise NotInChat()
        if chat.kind == "group" and pet.chat_id != chat.id:
            if chat.pet_limit <= 0:
                raise ChatFull("pets_off")
            here = list(Pet.objects.filter(chat=chat).select_related("owner").order_by("chat_at"))
            if len(here) >= chat.pet_limit:
                raise ChatFull("pets_full", [{"name": p.name, "species": p.species, "owner": _who(p.owner)} for p in here], chat.pet_limit)
    if chat and pet.chat_id == chat.id:
        return pet  # уже здесь: время прихода не сбрасываем (по нему уходят лишние)
    old = pet.chat_id
    pet.chat = chat
    pet.chat_at = timezone.now() if chat else None
    if chat:
        pet.show_in_chats = True
    pet.save(update_fields=["chat", "chat_at", "show_in_chats"])
    if old != pet.chat_id:
        _tell_members(pet, [c for c in (old, pet.chat_id) if c], old)
    return pet


def send_home(pet: Pet, by: Profile | None, reason: str) -> Pet:
    """Отправить питомца домой не хозяином: владелец группы (reason=admin) или
    уменьшенный лимит (reason=limit). Хозяину — заметка, кто и откуда."""
    chat = pet.chat
    if not chat:
        return pet
    pet.chat = None
    pet.chat_at = None
    pet.save(update_fields=["chat", "chat_at"])
    _tell_members(pet, [chat.id], chat.id)
    try:
        from asgiref.sync import async_to_sync
        from channels.layers import get_channel_layer
        layer = get_channel_layer()
        if layer:
            async_to_sync(layer.group_send)(f"user_{pet.owner_id}", {"type": "notification", "data": {
                "type": "pet", "action": "home", "reason": reason, "pet": pet_json(pet, brief=True),
                "by": _who(by) if by else None, "chat": {"id": str(chat.id), "name": chat.name},
            }})
    except Exception:
        logger.exception("pet: сокет не ответил")
    return pet


def trim_to_limit(chat: Chat, by: Profile | None) -> int:
    """Лимит группы уменьшили — лишние питомцы (пришедшие последними) уходят домой."""
    here = list(Pet.objects.filter(chat=chat).order_by("chat_at"))
    extra = here[max(0, chat.pet_limit):]
    for p in extra:
        send_home(p, by, "limit")
    return len(extra)


def _tell_members(pet: Pet, chat_ids, from_chat_id) -> None:
    """Участникам старого и нового чата: питомец ушёл / пришёл — лапка в списке и кот в ленте."""
    try:
        from asgiref.sync import async_to_sync
        from channels.layers import get_channel_layer
        layer = get_channel_layer()
        if not layer:
            return
        ids = set(ChatParticipant.objects.filter(chat_id__in=chat_ids).values_list("user_id", flat=True)[:NOTIFY_MEMBERS_MAX])
        ids.add(pet.owner_id)
        data = {"type": "pet_moved", "pet": pet_json(pet, brief=True),
                "from_chat_id": str(from_chat_id) if from_chat_id else None}
        for uid in ids:
            async_to_sync(layer.group_send)(f"user_{uid}", {"type": "notification", "data": data})
    except Exception:
        logger.exception("pet: сокет не ответил")


class CareTooSoon(Exception):
    def __init__(self, next_at):
        self.next_at = next_at


def care(pet: Pet, me: Profile, action: str) -> Pet:
    """Покормить или погладить: раз в сутки от человека, +1 к его вайбу."""
    if action not in ACTIONS:
        raise ValueError(action)
    now = timezone.now()
    with transaction.atomic():
        pet = Pet.objects.select_for_update().get(id=pet.id)
        last = PetCare.objects.filter(pet=pet, carer=me, created_at__gt=now - CARE_COOLDOWN).order_by("-created_at").first()
        if last:
            raise CareTooSoon(last.created_at + CARE_COOLDOWN)
        own = pet.owner_id == me.id
        pet.level = min(100.0, current_level(pet, now) + (OWNER_GAIN if own else GUEST_GAIN))
        pet.level_at = now
        if action == "feed":
            pet.last_fed_at = now
        else:
            pet.last_petted_at = now
        if own:
            pet.owner_cared_at = now
            pet.reminders = 0
        pet.save()
        PetCare.objects.create(pet=pet, carer=me, action=action, created_at=now)
        if not me.is_bot:
            Profile.objects.filter(id=me.id).update(vibe=models.F("vibe") + PET_CARE_VIBE)
    _tell_owner(pet, me, action)
    return pet


def _tell_owner(pet: Pet, me: Profile, action: str) -> None:
    """Хозяину в сокет: шкала поменялась (и кто это сделал) — карточка и чаты обновятся."""
    try:
        from asgiref.sync import async_to_sync
        from channels.layers import get_channel_layer
        layer = get_channel_layer()
        if layer:
            async_to_sync(layer.group_send)(f"user_{pet.owner_id}", {
                "type": "notification",
                "data": {"type": "pet", "pet": pet_json(pet, brief=True), "by": _who(me), "action": action},
            })
    except Exception:
        logger.exception("pet: сокет не ответил")


# ---------- напоминания ----------
# (мальчик, девочка); «настроение:вид» — если у вида своё (кролик не царапает, а подгрызает).
REMIND_TEXT = {
    "bored": (L("{name} скучает — загляните погладить"),) * 2,
    "hungry": (L("{name} проголодался и царапает сообщения"), L("{name} проголодалась и царапает сообщения")),
    "hungry:rabbit": (L("{name} проголодался и подгрызает сообщения"), L("{name} проголодалась и подгрызает сообщения")),
    "lonely": (L("{name} обиделся: вас не было больше суток"), L("{name} обиделась: вас не было больше суток")),
    "sad": (L("{name} совсем загрустил — без вас ему плохо"), L("{name} совсем загрустила — без вас ей плохо")),
    "sick": (L("{name} приболел. Немного заботы — и он поправится"), L("{name} приболела. Немного заботы — и она поправится")),
}


def remind_text(pet: Pet, m: str):
    pair = REMIND_TEXT.get(f"{m}:{pet.species}") or REMIND_TEXT.get(m)
    return pair[1 if pet.sex == "f" else 0] if pair else L("{name} ждёт вас — загляните погладить")


def due_reminders(now=None):
    now = now or timezone.now()
    edge = now - REMIND_AFTER
    return (Pet.objects.select_related("owner")
            .filter(owner__notify_pet=True, owner__is_bot=False, reminders__lt=REMIND_MAX)
            .filter(models.Q(owner_cared_at__lt=edge) | models.Q(owner_cared_at__isnull=True, created_at__lt=edge))
            .filter(models.Q(reminded_at__isnull=True) | models.Q(reminded_at__lt=now - timedelta(hours=23))))


def send_reminders() -> int:
    """Раз в час (chat/metrics.py): пуш хозяевам, кто сутки не ухаживал."""
    from .fcm import notify_profiles
    now = timezone.now()
    sent = 0
    for pet in due_reminders(now)[:500]:
        m = mood(pet, now)
        text = remind_text(pet, m)
        name = pet.name or L("Ваш питомец")
        try:
            notify_profiles(Profile.objects.filter(id=pet.owner_id), title=L("Питомец"),
                            body=L(text.s, name=name), extra={"kind": "pet", "pet_id": str(pet.id)})
        except Exception:
            logger.exception("pet: напоминание не ушло")
            continue
        Pet.objects.filter(id=pet.id).update(reminded_at=now, reminders=models.F("reminders") + 1)
        sent += 1
    if sent:
        logger.info("pet reminders: %s", sent)
    return sent


def maybe_send_reminders() -> None:
    """Из минутного цикла метрик: один воркер раз в час."""
    hour = timezone.now().strftime("%Y%m%d%H")
    if not cache.add(f"pets:remind:{hour}", 1, 7200):
        return
    try:
        send_reminders()
    except Exception:
        logger.exception("pet: напоминания упали")


# ---------- API ----------
def _me(request):
    return getattr(request.user, "profile", None)


class PetOfView(APIView):
    """GET /api/pets/of/<profile_id>/ — питомец человека (для карточки профиля)."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, profile_id):
        pet = Pet.objects.filter(owner_id=profile_id).first()
        return Response({"pet": pet_json(pet, _me(request)) if pet else None})


class PetsView(APIView):
    """GET /api/pets/?chat=<id> — питомцы, которые сейчас в этом чате (смотрящий — участник).

    Сборка 952 спрашивала ?owners= и показывала питомца во всех чатах хозяина;
    теперь он в одном чате, поэтому старому запросу — пусто.
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        me = _me(request)
        chat_id = request.query_params.get("chat")
        pets = Pet.objects.none()
        if me and chat_id:
            try:
                if ChatParticipant.objects.filter(chat_id=chat_id, user=me).exists():
                    pets = Pet.objects.filter(chat_id=chat_id)
            except (ValueError, ValidationError):
                pass
        now = timezone.now()
        return Response({"pets": [pet_json(p, now=now, brief=True) for p in pets]})


class PetsHereView(APIView):
    """GET /api/pets/here/ — питомцы во всех моих чатах: лапка в списке чатов."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        me = _me(request)
        if not me:
            return Response({"pets": []})
        chats = ChatParticipant.objects.filter(user=me).values("chat_id")
        now = timezone.now()
        pets = Pet.objects.filter(chat_id__in=chats)[:200]
        return Response({"pets": [pet_json(p, now=now, brief=True) for p in pets]})


class PetCareView(APIView):
    """POST /api/pets/<id>/care/ {action: feed|pet} — раз в сутки от человека."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        me = _me(request)
        if not me or me.is_bot:
            return Response({"error": "Нет профиля"}, status=403)
        pet = Pet.objects.filter(id=pk).first()
        if not pet:
            return Response({"error": "Питомец не найден"}, status=404)
        action = request.data.get("action")
        if action not in ACTIONS:
            return Response({"error": "Неизвестное действие"}, status=400)
        try:
            pet = care(pet, me, action)
        except CareTooSoon as e:
            return Response({"error": "Сегодня вы уже ухаживали", "next_care_at": e.next_at.isoformat(),
                             "pet": pet_json(pet, me)}, status=429)
        me.refresh_from_db(fields=["vibe"])
        return Response({"pet": pet_json(pet, me), "vibe": me.vibe, "vibe_gain": PET_CARE_VIBE})


class MyPetView(APIView):
    """PATCH /api/pets/mine/ {name?, show_in_chats?, chat_id?, color?} — кличка, окрас; позвать в чат (chat_id) или домой (null)."""
    permission_classes = [permissions.IsAuthenticated]

    def patch(self, request):
        me = _me(request)
        pet = Pet.objects.filter(owner=me).first() if me else None
        if not pet:
            return Response({"error": "Питомца нет"}, status=404)
        if "name" in request.data:
            name = " ".join(str(request.data.get("name") or "").split())[:NAME_MAX]
            if not name:
                return Response({"error": "Кличка не может быть пустой"}, status=400)
            pet.name = name
        if "show_in_chats" in request.data:
            pet.show_in_chats = bool(request.data.get("show_in_chats"))
        if "sex" in request.data:
            sex = request.data.get("sex")
            if sex not in SEXES:
                return Response({"error": "Пол — m или f"}, status=400)
            if sex != pet.sex:
                pet.sex = sex
                pet.accessories = None  # у другого пола свои украшения — по умолчанию
        if "accessories" in request.data:
            acc = request.data.get("accessories")
            if acc is not None and (not isinstance(acc, list) or len(acc) > ACC_MAX
                                    or not all(isinstance(a, str) and COLOR_RE.match(a) and a for a in acc)):
                return Response({"error": "Нет таких украшений"}, status=400)
            pet.accessories = list(dict.fromkeys(acc)) if acc is not None else None
        if "species" in request.data:
            # Сменить вид — пока только админу (проверка новых зверей до магазина).
            from .serializers import is_admin_profile
            species = request.data.get("species")
            if not is_admin_profile(me):
                return Response({"error": "Сменить вид пока нельзя"}, status=403)
            if species not in SPECIES:
                return Response({"error": "Нет такого вида"}, status=400)
            if species != pet.species:
                pet.species = species
                pet.accessories = None
        recolored = False
        if "color" in request.data:
            color = str(request.data.get("color") or "")
            if not COLOR_RE.match(color):
                return Response({"error": "Нет такого окраса"}, status=400)
            recolored = color != pet.color
            pet.color = color
        looks = {"color", "sex", "accessories", "species"} & set(request.data)
        pet.save(update_fields=["name", "show_in_chats", "color", "sex", "accessories", "species"])
        if (recolored or looks - {"color"}) and pet.chat_id:
            # Кот сейчас в чате — собеседники видят новый окрас сразу.
            _tell_members(pet, [pet.chat_id], pet.chat_id)
        if "chat_id" in request.data:
            try:
                pet = move(pet, me, request.data.get("chat_id") or None)
            except NotInChat:
                return Response({"error": "Сюда питомца не позвать"}, status=400)
            except ChatFull as e:
                msg = "В этой группе питомцы выключены" if e.code == "pets_off" else "Мест для питомцев нет"
                return Response({"error": msg, "code": e.code, "limit": e.limit, "pets": e.pets}, status=409)
        return Response({"pet": pet_json(pet, me)})


class PetHomeView(APIView):
    """POST /api/pets/<id>/home/ — домой: хозяин или владелец группы, где питомец сейчас."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        me = _me(request)
        pet = Pet.objects.filter(id=pk).select_related("chat").first()
        if not me or not pet:
            return Response({"error": "Питомец не найден"}, status=404)
        if pet.owner_id == me.id:
            return Response({"pet": pet_json(move(pet, me, None), me)})
        if not pet.chat or not is_group_owner(pet.chat, me):
            return Response({"error": "Отправить домой может хозяин или владелец группы"}, status=403)
        return Response({"pet": pet_json(send_home(pet, me, "admin"), me)})


class PetGrantView(APIView):
    """POST /api/pets/grant/ {profile_id, species} — админ дарит питомца (пока без «завести самому»)."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        from .serializers import is_admin_profile
        me = _me(request)
        if not me or not is_admin_profile(me):
            return Response({"error": "Только для админов"}, status=403)
        target = Profile.objects.filter(id=request.data.get("profile_id")).first()
        species = request.data.get("species") or "cat"
        if not target or target.is_bot or species not in SPECIES:
            return Response({"error": "Нельзя"}, status=400)
        pet, _ = Pet.objects.get_or_create(owner=target, defaults={"species": species})
        return Response({"pet": pet_json(pet, me)})
