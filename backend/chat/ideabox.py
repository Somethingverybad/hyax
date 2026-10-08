"""«Долгий ящик» — бот для идей и предложений.

У каждого свой чат с ботом (Chat.kind == "ideabox"); клиент показывает его
отдельной строкой наверху списка чатов, а в общий список не кладёт. Всё, что
человек туда пишет, пересылается в системный чат «Идеи» — к тем же людям, что
получают жалобы и баг-репорты (роли support и admin, см. moderation.py).
Пересылкой, а не пересказом: видно автора (тап — его профиль), фото и голосовые
доходят как есть.

Бот отвечает человеку, что идея принята, — не чаще раза в десять минут, чтобы
серия сообщений не превращалась в переписку с автоответчиком.

Текстовые идеи попадают в общий список (Idea) — без имени автора. За чужую
идею можно проголосовать один раз, лайком или дизлайком: голосующему +5 к
вайбометру, автору +10 за каждый лайк, дизлайк автору ничего не даёт и не
отнимает. Админ видит ещё «Реализовано» и «Убрать»; автору реализованной
идеи бот пишет в его ящик.

Основной вход — экран «Долгий ящик» в настройках (Профиль → Долгий ящик):
разделы и списки, API ниже. Чат с ботом остаётся для старых версий: в нём
можно предложить идею и голосовать в «Топ-10» кнопками. «Бездна» из чата
открывает экран, если клиент его знает (caps: ideas_screen), а старому бот
пишет, что нужно обновиться.
"""
import logging
import secrets
from datetime import timedelta

from django.contrib.auth.models import User
from django.db import transaction
from django.db.models import F
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Chat, ChatParticipant, Idea, IdeaVote, Message, Profile

logger = logging.getLogger(__name__)

KIND = "ideabox"
BOT_USERNAME = "Долгий ящик"
BOT_LOGIN = "ideabox_bot"
BOT_BIO = "Сюда — идеи и предложения для WhoYaX. Всё читает разработчик."
IDEAS_CHAT_NAME = "Идеи"
REPLY_EVERY = timedelta(minutes=10)

WELCOME = (
    "Привет! Это долгий ящик — временный бот на период тестирования WhoYaX.\n\n"
    "Сюда можно бросать идеи и предложения: что добавить, что поменять, что бесит. "
    "Текстом, голосом, картинкой — как удобно. Всё попадает прямо к разработчику.\n\n"
    "Текстовые идеи попадают в общий список — без имени автора. За чужие идеи можно "
    "голосовать: каждый голос — +5 к вашему вайбометру, а каждый лайк вашей идеи — +10 вам."
)
# Прежние приветствия — обновляем их на текущее (manage.py ideabox_seed).
OLD_WELCOMES = (
    "Привет! Это долгий ящик — временный бот на период тестирования WhoYaX.\n\n"
    "Сюда можно бросать идеи и предложения: что добавить, что поменять, что бесит. "
    "Текстом, голосом, картинкой — как удобно. Всё попадает прямо к разработчику. "
    "Ответ не обещаю, но каждую идею прочитаю.",
    "Привет! Это долгий ящик — сюда можно бросать идеи и предложения: что добавить, "
    "что поменять, что бесит. Текстом, голосом, картинкой — как удобно.\n\n"
    "Всё попадает прямо к разработчику. Ответ не обещаю, но каждую идею прочитаю.",
)
THANKS = "Положил в долгий ящик 📦 Спасибо! Если вспомнится ещё что-то — пиши сюда же."
SCREEN = "/profile/ideas"
TOP_SIZE = 10
MIN_IDEA_LEN = 3
VOTE_POINTS = 5        # голосующему, за любой голос
LIKE_POINTS = 10       # автору, за лайк
# Кнопки под приветствием и «спасибо»: вход в список идей.
MENU = [[{"text": "🏆 Топ-10", "data": "top"}, {"text": "🕳 Бездна", "data": "abyss"}]]
UPDATE_NOTE = ("Бездна — все идеи от новых к старым — теперь на отдельном экране: "
               "Профиль → Долгий ящик. В этой версии приложения его нет, обновите WhoYaX. "
               "А предлагать идеи и голосовать в «Топ-10» можно и здесь.")


def ideabox_bot() -> Profile:
    bot = Profile.objects.filter(username=BOT_USERNAME, is_bot=True).first()
    if bot:
        return bot
    user = User.objects.filter(username=BOT_LOGIN).first()
    if not user:
        user = User.objects.create(username=BOT_LOGIN, email=f"{BOT_LOGIN}@bot.local", is_active=False)
        user.set_unusable_password()
        user.save()
    return Profile.objects.create(user=user, username=BOT_USERNAME, is_bot=True, bio=BOT_BIO,
                                  bot_token=secrets.token_urlsafe(32))


def user_chat(profile: Profile) -> Chat:
    """Чат человека с ботом; создаётся при первом обращении, с приветствием."""
    chat = Chat.objects.filter(kind=KIND, participants=profile).first()
    if chat:
        return chat
    bot = ideabox_bot()
    with transaction.atomic():
        chat = Chat.objects.create(kind=KIND, is_group=False, name=BOT_USERNAME)
        ChatParticipant.objects.create(chat=chat, user=profile)
        ChatParticipant.objects.create(chat=chat, user=bot)
        Message.objects.create(chat=chat, sender=bot, content=WELCOME, buttons=MENU)
    return chat


def deliver_idea(message: Message, author: Profile, thank: bool = True) -> Idea | None:
    """Пересылаем идею в «Идеи» и при необходимости благодарим автора.
    Сбой доставки не мешает самой отправке: сообщение у человека уже есть."""
    from .moderation import sync_staff_membership, system_chat, system_bot
    from .views import _forward_copy, _notify_new_message
    try:
        ideas = sync_staff_membership(system_chat(IDEAS_CHAT_NAME))
        bot = system_bot()
        fwd = _forward_copy(message, ideas, bot)
        Chat.objects.filter(id=ideas.id).update(updated_at=timezone.now())
        _notify_new_message(fwd, bot, None)
    except Exception:
        logger.exception("Идея %s сохранена, но не доставлена в «Идеи»", message.id)
    idea = None
    try:
        text = (message.content or "").strip()
        if len(text) >= MIN_IDEA_LEN:
            idea = Idea.objects.create(author=author, message=message, text=text[:4000])
    except Exception:
        logger.exception("Идея %s не попала в список", message.id)
    if not thank:
        return idea
    try:
        box_bot = ideabox_bot()
        last_reply = (Message.objects.filter(chat=message.chat, sender=box_bot, content=THANKS)
                      .order_by("-created_at").values_list("created_at", flat=True).first())
        if not last_reply or timezone.now() - last_reply > REPLY_EVERY:
            reply = Message.objects.create(chat=message.chat, sender=box_bot, content=THANKS, buttons=MENU)
            Chat.objects.filter(id=message.chat_id).update(updated_at=timezone.now())
            _notify_new_message(reply, box_bot, None)
    except Exception:
        logger.exception("Не ответил на идею %s", message.id)
    return idea


class IdeaboxView(APIView):
    """GET /api/ideabox/ — чат человека с «Долгим ящиком» (создаётся при первом заходе)."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        me = getattr(request.user, "profile", None)
        if not me or me.is_bot:
            return Response({"error": "Нет профиля"}, status=403)
        from .serializers import ChatSerializer
        chat = user_chat(me)
        return Response(ChatSerializer(chat, context={"request": request}).data)


# ---------- список идей: голоса, отбор, админ ----------

def _is_admin(profile):
    from .serializers import is_admin_profile
    return is_admin_profile(profile)


def vote(idea_id, voter, value):
    """Голос за идею. Возвращает (идея, ошибка) — ошибка текстом для человека."""
    value = 1 if int(value) > 0 else -1
    idea = Idea.objects.filter(id=idea_id).exclude(status="hidden").first()
    if not idea:
        return None, "Идея не найдена"
    if voter.is_bot:
        return idea, "Боты не голосуют"
    if idea.author_id == voter.id:
        return idea, "За свою идею голосовать нельзя"
    with transaction.atomic():
        _, created = IdeaVote.objects.get_or_create(idea=idea, voter=voter, defaults={"value": value})
        if not created:
            return idea, "Вы уже голосовали за эту идею"
        field = "likes" if value > 0 else "dislikes"
        Idea.objects.filter(id=idea.id).update(**{field: F(field) + 1})
        Profile.objects.filter(id=voter.id).update(vibe=F("vibe") + VOTE_POINTS)
        if value > 0 and idea.author_id:
            Profile.objects.filter(id=idea.author_id).update(vibe=F("vibe") + LIKE_POINTS)
    idea.refresh_from_db()
    return idea, None


def set_done(idea_id, done=None):
    """Отметить «Реализовано» (или снять). Автору — сообщение в его ящик."""
    idea = Idea.objects.filter(id=idea_id).exclude(status="hidden").first()
    if not idea:
        return None
    done = idea.status != "done" if done is None else done
    idea.status = "done" if done else ""
    idea.done_at = timezone.now() if done else None
    idea.save(update_fields=["status", "done_at"])
    if done and idea.author_id and idea.author and not idea.author.is_bot:
        try:
            from .views import _notify_new_message
            chat = user_chat(idea.author)
            bot = ideabox_bot()
            m = Message.objects.create(chat=chat, sender=bot, content=f"🎉 Вашу идею реализовали:\n«{_clip(idea.text, 300)}»\n\nСпасибо!")
            Chat.objects.filter(id=chat.id).update(updated_at=timezone.now())
            _notify_new_message(m, bot, None)
        except Exception:
            logger.exception("Не сообщил автору о реализованной идее %s", idea.id)
    return idea


def hide(idea_id):
    return Idea.objects.filter(id=idea_id).update(status="hidden")


def top_qs():
    return (Idea.objects.filter(status="")
            .annotate(score=F("likes") - F("dislikes"))
            .order_by("-score", "-likes", "-created_at"))


def new_qs():
    return Idea.objects.exclude(status="hidden").order_by("-created_at")


def done_qs():
    return Idea.objects.filter(status="done").order_by("-done_at")


def _clip(t, n=160):
    t = " ".join((t or "").split())
    return t if len(t) <= n else t[: n - 1] + "…"


def _u16(s):
    return len(s.encode("utf-16-le")) // 2


def render(viewer):
    """«Топ-10» сообщением в чате бота: (текст, оформление, кнопки)."""
    admin = _is_admin(viewer)
    ideas = list(top_qs()[:TOP_SIZE])
    title = "🏆 Топ-10 идей"
    mine = dict(IdeaVote.objects.filter(voter=viewer, idea__in=ideas).values_list("idea_id", "value"))
    lines = [title, ""]
    rows = []
    if not ideas:
        lines.append("Пока пусто. Напишите сюда идею — она станет первой.")
    for i, idea in enumerate(ideas, start=1):
        marks = [f"👍 {idea.likes} · 👎 {idea.dislikes}"]
        if idea.author_id == viewer.id:
            marks.append("ваша идея")
        elif idea.id in mine:
            marks.append("ваш голос " + ("👍" if mine[idea.id] > 0 else "👎"))
        lines.append(f"{i}. {_clip(idea.text)}")
        lines.append("    " + " · ".join(marks))
        row = [
            {"text": f"{i} · 👍 {idea.likes}", "data": f"v:{idea.id}:+"},
            {"text": f"👎 {idea.dislikes}", "data": f"v:{idea.id}:-"},
        ]
        if admin:
            row.append({"text": "✅ Реализовано", "data": f"d:{idea.id}"})
            row.append({"text": "🗑", "data": f"h:{idea.id}"})
        rows.append(row)
    rows.append([{"text": "🔄 Обновить", "data": "t"}, {"text": "🕳 Бездна", "data": "abyss"}])
    text = "\n".join(lines).rstrip()
    return text, [{"type": "bold", "offset": 0, "length": _u16(title)}], rows


def _bot_say(chat_id, text, buttons=None):
    from .views import _notify_new_message
    bot = ideabox_bot()
    m = Message.objects.create(chat_id=chat_id, sender=bot, content=text, buttons=buttons or [])
    Chat.objects.filter(id=chat_id).update(updated_at=timezone.now())
    _notify_new_message(m, bot, None)
    return m


def handle_press(msg, profile, data, request=None, caps=()):
    """Кнопка под сообщением «Долгого ящика». Возвращает ответ для клиента:
    {message?, toast?, open?}. «Топ-10» правится на месте — то же сообщение."""
    from .serializers import MessageSerializer
    out = {"ok": True}
    if data == "abyss":
        if "ideas_screen" in caps:
            out["open"] = SCREEN + "?tab=new"
        else:
            _bot_say(msg.chat_id, UPDATE_NOTE)
        return out
    if data == "top":
        # С приветствия и «спасибо» — новым сообщением, чтобы меню осталось.
        text, ents, rows = render(profile)
        from .views import _notify_new_message
        bot = ideabox_bot()
        m = Message.objects.create(chat=msg.chat, sender=bot, content=text, entities=ents, buttons=rows)
        Chat.objects.filter(id=msg.chat_id).update(updated_at=timezone.now())
        _notify_new_message(m, bot, None)
        return out
    parts = data.split(":")
    if parts[0] == "v" and len(parts) == 3:
        _, err = vote(parts[1], profile, 1 if parts[2] == "+" else -1)
        out["toast"] = err or f"+{VOTE_POINTS} к вайбометру"
        out["toast_kind"] = "error" if err else "success"
    elif parts[0] in ("d", "h") and len(parts) == 2:
        if not _is_admin(profile):
            return {"error": "Только для админа"}
        if parts[0] == "d":
            set_done(parts[1], True)
            out["toast"] = "Отмечено: реализовано"
        else:
            hide(parts[1])
            out["toast"] = "Идея убрана из списка"
        out["toast_kind"] = "success"
    elif data != "t":
        return {"error": "Такой кнопки нет"}
    text, ents, rows = render(profile)
    msg.content, msg.entities, msg.buttons = text, ents, rows
    msg.save(update_fields=["content", "entities", "buttons", "updated_at"])
    out["message"] = MessageSerializer(msg, context={"request": request}).data
    return out


def idea_payload(idea, viewer, my_votes):
    return {
        "id": str(idea.id),
        "text": idea.text,
        "likes": idea.likes,
        "dislikes": idea.dislikes,
        "status": idea.status,
        "created_at": idea.created_at.isoformat(),
        "done_at": idea.done_at.isoformat() if idea.done_at else None,
        "mine": idea.author_id == viewer.id,
        "my_vote": my_votes.get(idea.id, 0),
    }


def _me(request):
    me = getattr(request.user, "profile", None)
    return me if me and not me.is_bot else None


class VibeView(APIView):
    """GET /api/vibe/<profile>/ — вайбометр и можно ли поднять; POST — поднять (+1, раз)."""
    permission_classes = [IsAuthenticated]

    def _state(self, me, target):
        from .models import VibeVote
        voted = VibeVote.objects.filter(voter=me, target=target).exists()
        return {"vibe": target.vibe, "voted": voted,
                "can_vote": not voted and target.id != me.id and not target.is_bot}

    def get(self, request, profile_id):
        me = _me(request)
        target = Profile.objects.filter(id=profile_id).first()
        if not me or not target:
            return Response({"error": "Профиль не найден"}, status=404)
        return Response(self._state(me, target))

    def post(self, request, profile_id):
        from django.db import IntegrityError
        from .models import VibeVote
        me = _me(request)
        target = Profile.objects.filter(id=profile_id).first()
        if not me or not target:
            return Response({"error": "Профиль не найден"}, status=404)
        if target.id == me.id:
            return Response({"error": "Свой вайб не поднять"}, status=400)
        if target.is_bot:
            return Response({"error": "У ботов вайбометра нет"}, status=400)
        try:
            with transaction.atomic():
                VibeVote.objects.create(voter=me, target=target)
                Profile.objects.filter(id=target.id).update(vibe=F("vibe") + 1)
        except IntegrityError:
            return Response({**self._state(me, target), "error": "Вы уже поднимали вайб"}, status=409)
        target.refresh_from_db(fields=["vibe"])
        return Response(self._state(me, target))


def vibe_levels_payload():
    from .models import VibeConfig, VibeLevel
    return {
        "bar_length": VibeConfig.get().bar_length,
        "levels": [{"min_vibe": l.min_vibe, "name": l.name, "color": l.color, "glow": l.glow}
                   for l in VibeLevel.objects.all()],
    }


class VibeLevelsView(APIView):
    """GET /api/vibe-levels/ — уровни вайбометра и длина шкалы.
    PUT (админ) {bar_length, levels: [{min_vibe, name, color, glow}]} — заменить целиком."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(vibe_levels_payload())

    def put(self, request):
        import re
        from .models import VibeConfig, VibeLevel
        me = _me(request)
        if not me or not _is_admin(me):
            return Response({"error": "Только для админа"}, status=403)
        try:
            bar = int(request.data.get("bar_length") or 10)
        except (TypeError, ValueError):
            return Response({"error": "Длина шкалы — число"}, status=400)
        if not 1 <= bar <= 1_000_000:
            return Response({"error": "Длина шкалы — от 1 до 1 000 000"}, status=400)
        raw = request.data.get("levels") or []
        if not isinstance(raw, list) or len(raw) > 100:
            return Response({"error": "Не больше 100 уровней"}, status=400)
        levels, seen = [], set()
        for item in raw:
            try:
                v = int(item.get("min_vibe"))
            except (TypeError, ValueError, AttributeError):
                return Response({"error": "У уровня нужен порог — число"}, status=400)
            name = " ".join(str(item.get("name") or "").split())[:40]
            color = str(item.get("color") or "").strip().lower()
            if not name:
                return Response({"error": f"У уровня с {v} нет названия"}, status=400)
            if not re.fullmatch(r"#[0-9a-f]{6}", color):
                return Response({"error": f"Цвет уровня «{name}» — в виде #rrggbb"}, status=400)
            if v < 1 or v in seen:
                return Response({"error": f"Порог {v}: должен быть больше нуля и не повторяться"}, status=400)
            seen.add(v)
            levels.append(VibeLevel(min_vibe=v, name=name, color=color, glow=bool(item.get("glow"))))
        with transaction.atomic():
            cfg = VibeConfig.get()
            cfg.bar_length = bar
            cfg.save(update_fields=["bar_length"])
            VibeLevel.objects.all().delete()
            VibeLevel.objects.bulk_create(levels)
        return Response(vibe_levels_payload())


class IdeasListView(APIView):
    """GET /api/ideas/?sort=top|new|done|mine&page=1&size=20 — списки идей.
    POST {text} — предложить идею с экрана: ложится в чат человека с ботом
    (история одна) и уходит к разработчику, без «спасибо» в чате."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        me = _me(request)
        if not me:
            return Response({"error": "Нет профиля"}, status=403)
        sort = request.query_params.get("sort") or "top"
        if sort == "mine":
            qs = Idea.objects.filter(author=me).exclude(status="hidden").order_by("-created_at")
        else:
            qs = {"top": top_qs, "new": new_qs, "done": done_qs}.get(sort, top_qs)()
        try:
            size = min(50, max(1, int(request.query_params.get("size") or 20)))
            page = max(1, int(request.query_params.get("page") or 1))
        except ValueError:
            size, page = 20, 1
        total = qs.count()
        pages = max(1, (total + size - 1) // size)
        page = min(page, pages)
        ideas = list(qs[(page - 1) * size: page * size])
        mine = dict(IdeaVote.objects.filter(voter=me, idea__in=ideas).values_list("idea_id", "value"))
        me.refresh_from_db(fields=["vibe"])
        return Response({
            "sort": sort, "page": page, "pages": pages, "count": total,
            "is_admin": _is_admin(me), "my_vibe": me.vibe,
            "points": {"vote": VOTE_POINTS, "like": LIKE_POINTS},
            "items": [idea_payload(i, me, mine) for i in ideas],
        })

    def post(self, request):
        me = _me(request)
        if not me:
            return Response({"error": "Нет профиля"}, status=403)
        text = (request.data.get("text") or "").strip()
        if len(text) < MIN_IDEA_LEN:
            return Response({"error": "Опишите идею хотя бы парой слов"}, status=400)
        if len(text) > 4000:
            return Response({"error": "Слишком длинно — до 4000 символов"}, status=400)
        chat = user_chat(me)
        msg = Message.objects.create(chat=chat, sender=me, content=text)
        Chat.objects.filter(id=chat.id).update(updated_at=timezone.now())
        idea = deliver_idea(msg, me, thank=False)
        if not idea:
            return Response({"error": "Не удалось сохранить идею"}, status=500)
        return Response({"idea": idea_payload(idea, me, {})}, status=201)


class IdeaActionView(APIView):
    """POST /api/ideas/<id>/<vote|done|hide|report>/ — голос ({value: 1|-1}),
    жалоба (в чат «Жалобы», как на сообщения) или действие админа."""
    permission_classes = [IsAuthenticated]

    def post(self, request, idea_id, act):
        me = _me(request)
        if not me:
            return Response({"error": "Нет профиля"}, status=403)
        if act == "report":
            idea = Idea.objects.filter(id=idea_id).exclude(status="hidden").select_related("author").first()
            if not idea:
                return Response({"error": "Идея не найдена"}, status=404)
            if idea.author_id == me.id:
                return Response({"error": "Это ваша идея"}, status=400)
            try:
                from .moderation import sync_staff_membership, system_bot
                from .views import _notify_new_message
                chat = sync_staff_membership()
                bot = system_bot()
                reason = " ".join(str(request.data.get("reason") or "").split())[:300]
                text = "\n".join(filter(None, [
                    f"🚩 Жалоба на идею в «Долгом ящике» от {me.username}",
                    f"Причина: {reason}" if reason else None,
                    f"Автор: {idea.author.username if idea.author else 'удалён'}",
                    "",
                    f"«{_clip(idea.text, 1000)}»",
                    "",
                    f"Убрать — кнопка 🗑 в Профиль → Долгий ящик. id: {idea.id}",
                ]))
                m = Message.objects.create(chat=chat, sender=bot, content=text)
                Chat.objects.filter(id=chat.id).update(updated_at=timezone.now())
                _notify_new_message(m, bot, None)
            except Exception:
                logger.exception("Жалоба на идею %s не доставлена", idea_id)
                return Response({"error": "Не удалось отправить жалобу"}, status=500)
            return Response({"ok": True})
        if act == "vote":
            idea, err = vote(idea_id, me, request.data.get("value") or 1)
            if not idea:
                return Response({"error": err}, status=404)
            if err:
                return Response({"error": err}, status=409)
        elif act in ("done", "hide"):
            if not _is_admin(me):
                return Response({"error": "Только для админа"}, status=403)
            if act == "hide":
                hide(idea_id)
                return Response({"ok": True})
            idea = set_done(idea_id)
            if not idea:
                return Response({"error": "Идея не найдена"}, status=404)
        else:
            return Response({"error": "Нет такого действия"}, status=404)
        mine = dict(IdeaVote.objects.filter(voter=me, idea=idea).values_list("idea_id", "value"))
        me.refresh_from_db(fields=["vibe"])
        return Response({"idea": idea_payload(idea, me, mine), "my_vibe": me.vibe})
