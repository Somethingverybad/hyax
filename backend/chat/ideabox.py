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

Админ отвечает реплаем на идею в «Идеях» — бот приносит ответ автору в его
ящик, ответом на его же сообщение (relay_staff_reply). Ответ автора на это —
продолжение разговора: в «Идеи» он приходит реплаем на ответ админа, в общий
список идей не попадает, «спасибо» бот на него не пишет. Реплаи поддержки и
сообщения без реплая на идею остаются внутренними.

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

from .i18n import L, lang_of, tr, variants
from .models import Chat, ChatParticipant, Idea, IdeaVote, Message, Profile

logger = logging.getLogger(__name__)

KIND = "ideabox"
BOT_USERNAME = "Долгий ящик"
BOT_LOGIN = "ideabox_bot"
BOT_BIO = "Сюда — идеи и предложения для WYX. Всё читает разработчик."
IDEAS_CHAT_NAME = "Идеи"
REPLY_EVERY = timedelta(minutes=10)

WELCOME = (
    "Привет! Это долгий ящик — временный бот на период тестирования WYX.\n\n"
    "Сюда можно бросать идеи и предложения: что добавить, что поменять, что бесит. "
    "Текстом, голосом, картинкой — как удобно. Всё попадает прямо к разработчику.\n\n"
    "Текстовые идеи попадают в общий список — без имени автора. За чужие идеи можно "
    "голосовать: каждый голос — +5 к вашему вайбометру, а каждый лайк вашей идеи — +10 вам."
)
# Прежние приветствия — обновляем их на текущее (manage.py ideabox_seed).
OLD_WELCOMES = (
    "Привет! Это долгий ящик — временный бот на период тестирования WYX.\n\n"
    "Сюда можно бросать идеи и предложения: что добавить, что поменять, что бесит. "
    "Текстом, голосом, картинкой — как удобно. Всё попадает прямо к разработчику. "
    "Ответ не обещаю, но каждую идею прочитаю.",
    "Привет! Это долгий ящик — сюда можно бросать идеи и предложения: что добавить, "
    "что поменять, что бесит. Текстом, голосом, картинкой — как удобно.\n\n"
    "Всё попадает прямо к разработчику. Ответ не обещаю, но каждую идею прочитаю.",
)
THANKS = "Положил в долгий ящик 📦 Спасибо! Если вспомнится ещё что-то — пиши сюда же."
# Голосовая идея длиннее минуты: расшифровать не сможем (chat/transcribe.py),
# в общий список она не попадёт — но разработчику ушла.
VOICE_TOO_LONG = ("Голосовое длиннее минуты я расшифровать не смогу, поэтому в общий список идей оно "
                  "не попадёт — но разработчику ушло. Если хотите в список — напишите текстом или покороче голосом.")
SCREEN = "/profile/ideas"
TOP_SIZE = 10
MIN_IDEA_LEN = 3
VOTE_POINTS = 5        # голосующему, за любой голос
LIKE_POINTS = 10       # автору, за лайк
# Кнопки под приветствием и «спасибо»: вход в список идей.
MENU = [[{"text": "🏆 Топ-10", "data": "top"}, {"text": "🕳 Бездна", "data": "abyss"}]]
UPDATE_NOTE = ("Бездна — все идеи от новых к старым — теперь на отдельном экране: "
               "Профиль → Долгий ящик. В этой версии приложения его нет, обновите WYX. "
               "А предлагать идеи и голосовать в «Топ-10» можно и здесь.")


def menu(lang="ru"):
    """MENU на языке человека: подписи кнопок, data — те же."""
    return [[{**b, "text": tr(b["text"], lang)} for b in row] for row in MENU]


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
    lang = lang_of(profile)
    with transaction.atomic():
        # Имя чата в базе — русское (клиент переводит его сам), приветствие —
        # сразу на языке человека.
        chat = Chat.objects.create(kind=KIND, is_group=False, name=BOT_USERNAME)
        ChatParticipant.objects.create(chat=chat, user=profile)
        ChatParticipant.objects.create(chat=chat, user=bot)
        Message.objects.create(chat=chat, sender=bot, content=tr(WELCOME, lang), buttons=menu(lang))
    return chat


def _answer_of(message: Message) -> Message | None:
    """Человек ответил реплаем на ответ админа — тот ответ (его оригинал в «Идеях»)."""
    r = message.reply_to
    if r and r.chat_id == message.chat_id and r.origin_message_id:
        return r.origin_message
    return None


def deliver_idea(message: Message, author: Profile, thank: bool = True) -> Idea | None:
    """Пересылаем идею в «Идеи» и при необходимости благодарим автора.
    Сбой доставки не мешает самой отправке: сообщение у человека уже есть."""
    from .moderation import sync_staff_membership, system_chat, system_bot
    from .views import _forward_copy, _notify_new_message
    answer = _answer_of(message)
    try:
        ideas = sync_staff_membership(system_chat(IDEAS_CHAT_NAME))
        bot = system_bot()
        fwd = _forward_copy(message, ideas, bot)
        # Связь с оригиналом — по ней реплай админа дойдёт автору; ответ на
        # ответ админа ложится в «Идеях» реплаем на него.
        fwd.origin_message = message
        fwd.reply_to = answer if answer and answer.chat_id == ideas.id else None
        fwd.save(update_fields=["origin_message", "reply_to", "updated_at"])
        Chat.objects.filter(id=ideas.id).update(updated_at=timezone.now())
        _notify_new_message(fwd, bot, None)
    except Exception:
        logger.exception("Идея %s сохранена, но не доставлена в «Идеи»", message.id)
    # Продолжение разговора с админом — не новая идея: в список не кладём
    # и «спасибо» не пишем.
    if answer:
        return None
    idea = None
    voice_too_long = False
    try:
        text = (message.content or "").strip()
        if len(text) >= MIN_IDEA_LEN:
            idea = Idea.objects.create(author=author, message=message, text=text[:4000])
        elif not text and message.voice_url:
            # Голосовая идея: в список сразу, текст приедет из расшифровки
            # (transcribe_message → idea_transcribed). Длинное — не расшифруем.
            from .transcribe import too_long, transcribe_async
            if too_long(message):
                voice_too_long = True
            else:
                idea = Idea.objects.create(author=author, message=message, text="")
                me = str(author.id)
                if me not in (message.transcript_for or []):
                    message.transcript_for = [*(message.transcript_for or []), me]
                message.transcript_status = "pending"
                message.save(update_fields=["transcript_for", "transcript_status", "updated_at"])
                transcribe_async(message.id)
    except Exception:
        logger.exception("Идея %s не попала в список", message.id)
    if not thank:
        return idea
    if voice_too_long:
        try:
            _bot_say(message.chat_id, tr(VOICE_TOO_LONG, lang_of(author)), menu(lang_of(author)))
        except Exception:
            logger.exception("Не ответил на длинную голосовую идею %s", message.id)
        return None
    try:
        box_bot = ideabox_bot()
        lang = lang_of(author)
        # «Спасибо» мог уйти на любом языке — человек мог сменить язык.
        last_reply = (Message.objects.filter(chat=message.chat, sender=box_bot, content__in=variants(THANKS))
                      .order_by("-created_at").values_list("created_at", flat=True).first())
        if not last_reply or timezone.now() - last_reply > REPLY_EVERY:
            reply = Message.objects.create(chat=message.chat, sender=box_bot, content=tr(THANKS, lang),
                                           buttons=menu(lang))
            Chat.objects.filter(id=message.chat_id).update(updated_at=timezone.now())
            _notify_new_message(reply, box_bot, None)
    except Exception:
        logger.exception("Не ответил на идею %s", message.id)
    return idea


def idea_transcribed(msg: Message):
    """Расшифровка голосовой идеи готова (chat/transcribe.py): текст — в список,
    а копии в «Идеях» — та же расшифровка, чтобы разработчик не гонял whisper второй раз."""
    if getattr(msg.chat, "kind", "") != KIND:
        return
    text = (msg.voice_transcript or "").strip()
    if msg.transcript_status == "done" and text and text != "(тишина)":
        Idea.objects.filter(message=msg).update(text=text[:4000])
    fwd = Message.objects.filter(origin_message=msg, voice_url=msg.voice_url).first()
    if fwd:
        fwd.voice_transcript = msg.voice_transcript
        fwd.transcript_status = msg.transcript_status
        fwd.transcript_lang = msg.transcript_lang
        fwd.save(update_fields=["voice_transcript", "transcript_status", "transcript_lang", "updated_at"])


def _staff_note(chat, text):
    """Служебная заметка в «Идеях» от системного бота (видят только админы)."""
    from .moderation import system_bot
    from .views import _notify_new_message
    bot = system_bot()
    m = Message.objects.create(chat=chat, sender=bot, content=text)
    Chat.objects.filter(id=chat.id).update(updated_at=timezone.now())
    _notify_new_message(m, bot, None)


def relay_staff_reply(reply: Message) -> Message | None:
    """Реплай админа на идею в «Идеях» — автору в его ящик, от бота, ответом
    на его сообщение. Реплай на что-то другое или не от админа — внутреннее обсуждение."""
    src = reply.reply_to
    chat = reply.chat
    if not src or src.chat_id != chat.id or chat.kind != "system" or chat.name != IDEAS_CHAT_NAME:
        return None
    if not src.forwarded_from_id:
        return None
    # Отвечать авторам может только админ; реплаи поддержки — внутренние.
    if not _is_admin(reply.sender):
        return None
    orig = src.origin_message
    if not orig or orig.chat.kind != KIND:
        _staff_note(chat, "Ответ не дошёл: не нашёл исходное сообщение автора — его удалили, или оно пришло до того, как ответы появились.")
        return None
    from .views import _forward_copy, _notify_new_message
    bot = ideabox_bot()
    m = _forward_copy(reply, orig.chat, bot)
    m.forwarded_from, m.forwarded_title, m.forwarded_chat = None, "", None
    m.reply_to, m.origin_message = orig, reply
    m.save(update_fields=["forwarded_from", "forwarded_title", "forwarded_chat", "reply_to", "origin_message", "updated_at"])
    Chat.objects.filter(id=orig.chat_id).update(updated_at=timezone.now())
    _notify_new_message(m, bot, None)
    return m


def relay_edit(msg: Message):
    """Правка идеи или ответа админа — и в копии на другой стороне."""
    for c in Message.objects.filter(origin_message=msg):
        c.content, c.entities, c.is_edited, c.translations = msg.content, msg.entities, True, {}
        c.save(update_fields=["content", "entities", "is_edited", "translations", "updated_at"])
    if msg.chat.kind == KIND:
        text = (msg.content or "").strip()
        if len(text) >= MIN_IDEA_LEN:
            Idea.objects.filter(message=msg).update(text=text[:4000])


def relay_delete(msg: Message):
    """Ответ админа удалили у всех — исчезает и у автора идеи. Свою идею
    автор удаляет только у себя: в «Идеях» копия остаётся."""
    for c in Message.objects.filter(origin_message=msg, chat__kind=KIND):
        c.deleted_for_all = True
        c.save(update_fields=["deleted_for_all", "updated_at"])


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
            m = Message.objects.create(chat=chat, sender=bot, content=tr(
                "🎉 Вашу идею реализовали:\n«{text}»\n\nСпасибо!", lang_of(idea.author), text=_clip(idea.text, 300)))
            Chat.objects.filter(id=chat.id).update(updated_at=timezone.now())
            _notify_new_message(m, bot, None)
        except Exception:
            logger.exception("Не сообщил автору о реализованной идее %s", idea.id)
    return idea


def hide(idea_id):
    return Idea.objects.filter(id=idea_id).update(status="hidden")


def top_qs():
    return (Idea.objects.filter(status="").select_related("message")
            .annotate(score=F("likes") - F("dislikes"))
            .order_by("-score", "-likes", "-created_at"))


def new_qs():
    return Idea.objects.exclude(status="hidden").select_related("message").order_by("-created_at")


def done_qs():
    return Idea.objects.filter(status="done").select_related("message").order_by("-done_at")


def _clip(t, n=160):
    t = " ".join((t or "").split())
    return t if len(t) <= n else t[: n - 1] + "…"


def _u16(s):
    return len(s.encode("utf-16-le")) // 2


def render(viewer):
    """«Топ-10» сообщением в чате бота: (текст, оформление, кнопки) — на языке
    того, кто смотрит (чат у каждого свой)."""
    admin = _is_admin(viewer)
    lang = lang_of(viewer)
    ideas = list(top_qs()[:TOP_SIZE])
    title = tr("🏆 Топ-10 идей", lang)
    mine = dict(IdeaVote.objects.filter(voter=viewer, idea__in=ideas).values_list("idea_id", "value"))
    lines = [title, ""]
    rows = []
    if not ideas:
        lines.append(tr("Пока пусто. Напишите сюда идею — она станет первой.", lang))
    for i, idea in enumerate(ideas, start=1):
        marks = [f"👍 {idea.likes} · 👎 {idea.dislikes}"]
        if idea.author_id == viewer.id:
            marks.append(tr("ваша идея", lang))
        elif idea.id in mine:
            marks.append(tr("ваш голос {vote}", lang, vote="👍" if mine[idea.id] > 0 else "👎"))
        lines.append(f"{i}. {_clip(idea.text)}")
        lines.append("    " + " · ".join(marks))
        row = [
            {"text": f"{i} · 👍 {idea.likes}", "data": f"v:{idea.id}:+"},
            {"text": f"👎 {idea.dislikes}", "data": f"v:{idea.id}:-"},
        ]
        if admin:
            row.append({"text": tr("✅ Реализовано", lang), "data": f"d:{idea.id}"})
            row.append({"text": "🗑", "data": f"h:{idea.id}"})
        rows.append(row)
    rows.append([{"text": tr("🔄 Обновить", lang), "data": "t"}, {"text": tr("🕳 Бездна", lang), "data": "abyss"}])
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
            _bot_say(msg.chat_id, tr(UPDATE_NOTE, lang_of(profile)))
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
    m = idea.message if idea.message_id else None
    voice = {"url": m.voice_url, "duration": m.voice_duration or 0} if m and m.voice_url else None
    return {
        "id": str(idea.id),
        "text": idea.text,
        # Голосовая идея: само голосовое и, пока текста нет, состояние расшифровки
        # (pending / error / done-«тишина»).
        "voice": voice,
        "transcript": (m.transcript_status or "") if voice and not idea.text else "",
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


def _notify_vibe(target, voter, anonymous, saved=False, push=True, playlist=None):
    """Сказать человеку, что его вайб подняли: в персональный сокет (веб и
    десктоп) и пушем. Анонимно — без имени; в пуше kind=vibe, по тапу
    клиент открывает свой профиль."""
    who = None if anonymous else {"id": str(voter.id), "username": voter.username, "avatar_url": voter.avatar_url}
    try:
        from channels.layers import get_channel_layer
        from asgiref.sync import async_to_sync
        layer = get_channel_layer()
        if layer:
            async_to_sync(layer.group_send)(f"user_{target.id}", {
                "type": "notification",
                "data": {"type": "vibe", "vibe": target.vibe, "from": who},
            })
    except Exception:
        logger.exception("vibe: сокет не ответил")
    if not push:
        return
    try:
        from .fcm import notify_profiles
        # На языке того, чей вайб подняли (notify_profiles знает его язык).
        body = (L("Кто-то поднял ваш вайб — уже {n}", n=target.vibe) if anonymous
                else L("{name} лайкнул(а) вашу сохранёнку — вайб уже {n}", name=voter.username, n=target.vibe) if saved
                else L("{name} лайкнул(а) ваш плейлист «{playlist}» — вайб уже {n}", name=voter.username, playlist=playlist, n=target.vibe) if playlist
                else L("{name} поднял(а) ваш вайб — уже {n}", name=voter.username, n=target.vibe))
        notify_profiles(Profile.objects.filter(id=target.id), title=L("Вайбометр"), body=body,
                        extra={"kind": "vibe", "profile_id": str(target.id)})
    except Exception:
        logger.exception("vibe: пуш не поставлен")


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
        anonymous = str(request.data.get("anonymous") or "").lower() in ("1", "true", "yes")
        try:
            with transaction.atomic():
                VibeVote.objects.create(voter=me, target=target, anonymous=anonymous)
                Profile.objects.filter(id=target.id).update(vibe=F("vibe") + 1)
        except IntegrityError:
            return Response({**self._state(me, target), "error": "Вы уже поднимали вайб"}, status=409)
        target.refresh_from_db(fields=["vibe"])
        _notify_vibe(target, me, anonymous)
        return Response(self._state(me, target))


class VibeHistoryView(APIView):
    """GET /api/vibe/history/ — кто и за что поднимал мой вайб и что его снимало.
    Только свой вайбометр. Без имени: анонимные голоса в профиле и лайки идей
    (список идей анонимный — голосующих автору не раскрываем), жалобы."""
    permission_classes = [IsAuthenticated]
    LIMIT = 200

    def get(self, request):
        from .models import VibeVote, SavedImageVibe, PlaylistLike, Report, PLAYLIST_LIKE_VIBE, VIBE_REPORT_PENALTY, VIBE_SILENT
        me = _me(request)
        if not me or me.is_bot:
            return Response({"error": "Нет профиля"}, status=403)
        n = self.LIMIT
        who = lambda p: {"id": str(p.id), "username": p.username, "avatar_url": p.avatar_url} if p else None
        rows = []
        for v in VibeVote.objects.filter(target=me).select_related("voter").order_by("-created_at")[:n]:
            rows.append((v.created_at, {"kind": "profile", "points": 1, "who": None if v.anonymous else who(v.voter)}))
        for v in SavedImageVibe.objects.filter(image__owner=me).select_related("voter", "image").order_by("-created_at")[:n]:
            rows.append((v.created_at, {"kind": "saved", "points": 1, "who": who(v.voter), "image": v.image.file_url}))
        for v in PlaylistLike.objects.filter(playlist__owner=me).select_related("profile", "playlist").order_by("-created_at")[:n]:
            rows.append((v.created_at, {"kind": "playlist_like", "points": PLAYLIST_LIKE_VIBE, "who": who(v.profile), "playlist": v.playlist.name}))
        for v in IdeaVote.objects.filter(idea__author=me, value__gt=0).select_related("idea").order_by("-created_at")[:n]:
            rows.append((v.created_at, {"kind": "idea_like", "points": LIKE_POINTS, "idea": _clip(v.idea.text, 120)}))
        for v in IdeaVote.objects.filter(voter=me).select_related("idea").order_by("-created_at")[:n]:
            rows.append((v.created_at, {"kind": "idea_vote", "points": VOTE_POINTS, "idea": _clip(v.idea.text, 120)}))
        for r in Report.objects.filter(target_profile=me).order_by("-created_at")[:n]:
            rows.append((r.created_at, {"kind": "report", "points": -VIBE_REPORT_PENALTY}))
        rows.sort(key=lambda x: x[0], reverse=True)
        # Звук входящих выключен — на вайбометре VIBE_SILENT, настоящий вайб считаем.
        silent = me.vibe_saved is not None
        vibe = (me.vibe_saved + (me.vibe - VIBE_SILENT)) if silent else me.vibe
        return Response({"vibe": vibe, "silent": silent,
                         "items": [{**item, "at": at.isoformat()} for at, item in rows[:n]]})


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
            # Текст ошибки статичный (клиент переводит его), порог — отдельным полем.
            if not name:
                return Response({"error": "У уровня нет названия", "min_vibe": v}, status=400)
            if not re.fullmatch(r"#[0-9a-f]{6}", color):
                return Response({"error": "Цвет уровня — в виде #rrggbb", "min_vibe": v}, status=400)
            if v < 1 or v in seen:
                return Response({"error": "Порог должен быть больше нуля и не повторяться", "min_vibe": v}, status=400)
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
            qs = Idea.objects.filter(author=me).exclude(status="hidden").select_related("message").order_by("-created_at")
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
