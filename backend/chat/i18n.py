"""Тексты, которые сервер сам формирует для конкретного человека: пуши,
письма, сообщения ботов в его личный чат. Ключ словаря — русская строка
(как в клиентском src/lib/i18n.*.ts), язык — Profile.language: ru / en / ko,
пусто — ru. Нет перевода — исходная строка.

Ответы API (ошибки, подписи, превью в сериализаторах) здесь не переводим:
они уходят по-русски, клиент переводит их своим словарём по точной строке.

Модуль без зависимостей от моделей и views — его можно импортировать
откуда угодно, в том числе из fcm.py и consumers.py.

    tr("Входящий звонок", "en")                    -> "Incoming call"
    tr("{name} звонит в группе", "ko", name="Аня")  -> "Аня 님이 그룹 통화를 걸었어요"
    L("Стикер")                                     -> перевод «на потом»: язык
                                                       получателя узнаёт notify_profiles
"""
import re

LANGS = ("ru", "en", "ko")
DEFAULT = "ru"

EN = {
    "Питомец": "Pet",
    "Ваш питомец": "Your pet",
    "{name} скучает — загляните погладить": "{name} is bored — come and give some pets",
    "{name} проголодался и царапает сообщения": "{name} is hungry and scratching your messages",
    "{name} обиделся: вас не было больше суток": "{name} is upset: you haven't been around for over a day",
    "{name} совсем загрустил — без вас ему плохо": "{name} is really sad — it misses you",
    "{name} приболел. Немного заботы — и он поправится": "{name} is feeling unwell. A little care and it'll get better",
    "{name} ждёт вас — загляните погладить": "{name} is waiting for you — come and give some pets",
    "{name} проголодалась и царапает сообщения": "{name} is hungry and scratching your messages",
    "{name} проголодался и подгрызает сообщения": "{name} is hungry and nibbling your messages",
    "{name} проголодалась и подгрызает сообщения": "{name} is hungry and nibbling your messages",
    "{name} обиделась: вас не было больше суток": "{name} is upset: you haven't been around for over a day",
    "{name} совсем загрустила — без вас ей плохо": "{name} is really sad — she misses you",
    "{name} приболела. Немного заботы — и она поправится": "{name} is feeling unwell. A little care and she'll get better",
    # Пуши
    "Новое сообщение": "New message",
    "📍 Геопозиция": "📍 Location",
    "Новое сообщение в секретном чате": "New message in a secret chat",
    "Стикер": "Sticker",
    "Мои граффити": "My graffiti",
    "Видео-сообщение": "Video message",
    "Голосовое сообщение": "Voice message",
    "Файл": "File",
    "сообщение": "message",
    "Группа": "Group",
    "Групповой звонок": "Group call",
    "{emoji} на «{text}»": "Reacted {emoji} to “{text}”",
    "Входящий звонок": "Incoming call",
    "Входящий видеозвонок": "Incoming video call",
    "{name} звонит в группе": "{name} is calling the group",
    "Ревёт 📳": "Sending you a Ryov 📳",
    "Вайбометр": "Vibe meter",
    "Вайбометр {delta}: {reason} — уже {n}": "Vibe meter {delta}: {reason} — now {n}",
    "{name} поднял(а) ваш вайб — уже {n}": "{name} raised your vibe — now {n}",
    "Кто-то поднял ваш вайб — уже {n}": "Someone raised your vibe — now {n}",
    "{name} поднял(а) ваш вайб за сохранёнку — уже {n}": "{name} raised your vibe for a saved photo — now {n}",
    "{name} лайкнул(а) вашу сохранёнку — вайб уже {n}": "{name} liked your saved photo — vibe is now {n}",
    "{name} лайкнул(а) ваш плейлист «{playlist}» — вайб уже {n}": "{name} liked your playlist “{playlist}” — vibe is now {n}",
    "{name} на Стене": "{name} on the Wall",
    "Новый пост": "New post",
    "Опрос": "Poll",
    # Системные чаты (заголовок пуша)
    "Долгий ящик": "Back Burner",
    "Идеи": "Ideas",
    "Жалобы": "Reports",
    "Баг-репорты": "Bug reports",
    # «Долгий ящик»: сообщения бота в личный чат человека
    "Привет! Это долгий ящик — временный бот на период тестирования WYX.\n\n"
    "Сюда можно бросать идеи и предложения: что добавить, что поменять, что бесит. "
    "Текстом, голосом, картинкой — как удобно. Всё попадает прямо к разработчику.\n\n"
    "Текстовые идеи попадают в общий список — без имени автора. За чужие идеи можно "
    "голосовать: каждый голос — +5 к вашему вайбометру, а каждый лайк вашей идеи — +10 вам.":
        "Hi! This is the Back Burner — a temporary bot for the WYX testing period.\n\n"
        "Drop your ideas and suggestions here: what to add, what to change, what annoys you. "
        "Text, voice, a picture — whatever works for you. It all goes straight to the developer.\n\n"
        "Text ideas go into a shared list — without the author's name. You can vote on other "
        "people's ideas: every vote is +5 to your vibe meter, and every like on your idea is +10 for you.",
    "Голосовое длиннее минуты я расшифровать не смогу, поэтому в общий список идей оно "
    "не попадёт — но разработчику ушло. Если хотите в список — напишите текстом или покороче голосом.":
        "I can't transcribe a voice message longer than a minute, so it won't make the shared idea list — "
        "but it did reach the developer. To get it on the list, write it as text or record a shorter one.",
    "Положил в долгий ящик 📦 Спасибо! Если вспомнится ещё что-то — пиши сюда же.":
        "Put it on the back burner 📦 Thanks! If anything else comes to mind, write here too.",
    "🏆 Топ-10": "🏆 Top 10",
    "🕳 Бездна": "🕳 Abyss",
    "Бездна — все идеи от новых к старым — теперь на отдельном экране: "
    "Профиль → Долгий ящик. В этой версии приложения его нет, обновите WYX. "
    "А предлагать идеи и голосовать в «Топ-10» можно и здесь.":
        "The Abyss — all ideas from newest to oldest — now has its own screen: "
        "Profile → Back Burner. This version of the app doesn't have it, please update WYX. "
        "You can still suggest ideas and vote in the “Top 10” right here.",
    "🎉 Вашу идею реализовали:\n«{text}»\n\nСпасибо!": "🎉 Your idea has been implemented:\n“{text}”\n\nThank you!",
    "🏆 Топ-10 идей": "🏆 Top 10 ideas",
    "Пока пусто. Напишите сюда идею — она станет первой.": "Nothing here yet. Write an idea here — it'll be the first.",
    "ваша идея": "your idea",
    "ваш голос {vote}": "your vote {vote}",
    "✅ Реализовано": "✅ Done",
    "🔄 Обновить": "🔄 Refresh",
    # Письма
    "Восстановление пароля WYX": "WYX password reset",
    "Вы запросили сброс пароля в WYX.": "You requested a password reset in WYX.",
    "Подтверждение почты WYX": "Confirm your email for WYX",
    "Вы привязываете эту почту к аккаунту WYX.": "You're linking this email to a WYX account.",
    "Код: {code}": "Code: {code}",
    "Он действует 15 минут. Если это не вы — просто не обращайте внимания на письмо.":
        "It's valid for 15 minutes. If this wasn't you, just ignore this email.",
    "Код действует 15 минут. Если это не вы — просто не обращайте внимания на письмо.":
        "The code is valid for 15 minutes. If this wasn't you, just ignore this email.",
    "Хочет начать с вами переписку": "Wants to start a chat with you",
    "Принял(а) ваш запрос на переписку": "Accepted your chat request",
}

KO = {
    "Питомец": "반려동물",
    "Ваш питомец": "내 반려동물",
    "{name} скучает — загляните погладить": "{name}이(가) 심심해해요 — 쓰다듬어 주러 오세요",
    "{name} проголодался и царапает сообщения": "{name}이(가) 배고파서 메시지를 긁고 있어요",
    "{name} обиделся: вас не было больше суток": "{name}이(가) 삐졌어요: 하루 넘게 안 오셨어요",
    "{name} совсем загрустил — без вас ему плохо": "{name}이(가) 많이 슬퍼해요 — 당신이 보고 싶대요",
    "{name} приболел. Немного заботы — и он поправится": "{name}이(가) 아파요. 조금만 돌봐주면 나을 거예요",
    "{name} ждёт вас — загляните погладить": "{name}이(가) 기다리고 있어요 — 쓰다듬어 주러 오세요",
    "{name} проголодалась и царапает сообщения": "{name}이(가) 배고파서 메시지를 긁고 있어요",
    "{name} проголодался и подгрызает сообщения": "{name}이(가) 배고파서 메시지를 갉아먹고 있어요",
    "{name} проголодалась и подгрызает сообщения": "{name}이(가) 배고파서 메시지를 갉아먹고 있어요",
    "{name} обиделась: вас не было больше суток": "{name}이(가) 삐졌어요: 하루 넘게 안 오셨어요",
    "{name} совсем загрустила — без вас ей плохо": "{name}이(가) 많이 슬퍼해요 — 당신이 보고 싶대요",
    "{name} приболела. Немного заботы — и она поправится": "{name}이(가) 아파요. 조금만 돌봐주면 나을 거예요",
    # Пуши
    "Новое сообщение": "새 메시지",
    "📍 Геопозиция": "📍 위치",
    "Новое сообщение в секретном чате": "비밀 채팅의 새 메시지",
    "Стикер": "스티커",
    "Мои граффити": "내 그래피티",
    "Видео-сообщение": "동영상 메시지",
    "Голосовое сообщение": "음성 메시지",
    "Файл": "파일",
    "сообщение": "메시지",
    "Группа": "그룹",
    "Групповой звонок": "그룹 통화",
    "{emoji} на «{text}»": "‘{text}’에 {emoji} 반응을 남겼어요",
    "Входящий звонок": "전화가 왔어요",
    "Входящий видеозвонок": "영상 통화가 왔어요",
    "{name} звонит в группе": "{name} 님이 그룹 통화를 걸었어요",
    "Ревёт 📳": "료프를 보내고 있어요 📳",
    "Вайбометр": "바이브 미터",
    "Вайбометр {delta}: {reason} — уже {n}": "바이브 미터 {delta}: {reason} — 현재 {n}",
    "{name} поднял(а) ваш вайб — уже {n}": "{name} 님이 내 바이브를 올렸어요. 지금 {n}",
    "Кто-то поднял ваш вайб — уже {n}": "누군가 내 바이브를 올렸어요. 지금 {n}",
    "{name} поднял(а) ваш вайб за сохранёнку — уже {n}": "{name} 님이 내 저장 사진에 바이브를 올렸어요. 지금 {n}",
    "{name} лайкнул(а) вашу сохранёнку — вайб уже {n}": "{name} 님이 내 저장 사진을 좋아해요. 바이브 {n}",
    "{name} лайкнул(а) ваш плейлист «{playlist}» — вайб уже {n}": "{name} 님이 내 플레이리스트 「{playlist}」를 좋아해요. 바이브 {n}",
    "{name} на Стене": "{name} 님이 담벼락에 글을 썼어요",
    "Новый пост": "새 글",
    "Опрос": "투표",
    # Системные чаты (заголовок пуша)
    "Долгий ящик": "아이디어 서랍",
    "Идеи": "아이디어",
    "Жалобы": "신고",
    "Баг-репорты": "버그 신고",
    # «Долгий ящик»: сообщения бота в личный чат человека
    "Привет! Это долгий ящик — временный бот на период тестирования WYX.\n\n"
    "Сюда можно бросать идеи и предложения: что добавить, что поменять, что бесит. "
    "Текстом, голосом, картинкой — как удобно. Всё попадает прямо к разработчику.\n\n"
    "Текстовые идеи попадают в общий список — без имени автора. За чужие идеи можно "
    "голосовать: каждый голос — +5 к вашему вайбометру, а каждый лайк вашей идеи — +10 вам.":
        "안녕하세요! 여기는 아이디어 서랍이에요. WYX 테스트 기간 동안 운영하는 임시 봇이에요.\n\n"
        "아이디어와 제안을 자유롭게 남겨 주세요. 무엇을 더하고, 무엇을 바꾸고, 무엇이 거슬리는지요. "
        "텍스트, 음성, 사진 등 편한 방식이면 돼요. 모두 개발자에게 바로 전달돼요.\n\n"
        "텍스트 아이디어는 작성자 이름 없이 공용 목록에 올라가요. 다른 사람의 아이디어에 투표할 수 있어요. "
        "투표할 때마다 내 바이브 미터 +5, 내 아이디어가 좋아요를 받을 때마다 +10이에요.",
    "Голосовое длиннее минуты я расшифровать не смогу, поэтому в общий список идей оно "
    "не попадёт — но разработчику ушло. Если хотите в список — напишите текстом или покороче голосом.":
        "1분이 넘는 음성은 받아쓰기할 수 없어서 공용 아이디어 목록에는 올라가지 않아요. 개발자에게는 전달됐어요. "
        "목록에 올리고 싶다면 텍스트로 쓰거나 더 짧게 녹음해 주세요.",
    "Положил в долгий ящик 📦 Спасибо! Если вспомнится ещё что-то — пиши сюда же.":
        "아이디어 서랍에 넣었어요 📦 고마워요! 더 생각나면 여기에 또 보내 주세요.",
    "🏆 Топ-10": "🏆 인기 10",
    "🕳 Бездна": "🕳 심연",
    "Бездна — все идеи от новых к старым — теперь на отдельном экране: "
    "Профиль → Долгий ящик. В этой версии приложения его нет, обновите WYX. "
    "А предлагать идеи и голосовать в «Топ-10» можно и здесь.":
        "심연(최신순 전체 아이디어)은 이제 별도 화면에 있어요: 프로필 → 아이디어 서랍. "
        "이 버전의 앱에는 없으니 WYX를 업데이트해 주세요. "
        "아이디어 제안과 ‘인기 10’ 투표는 여기서도 할 수 있어요.",
    "🎉 Вашу идею реализовали:\n«{text}»\n\nСпасибо!": "🎉 보내 주신 아이디어가 반영됐어요:\n‘{text}’\n\n고마워요!",
    "🏆 Топ-10 идей": "🏆 인기 아이디어 10",
    "Пока пусто. Напишите сюда идею — она станет первой.": "아직 비어 있어요. 여기에 아이디어를 쓰면 첫 번째가 돼요.",
    "ваша идея": "내 아이디어",
    "ваш голос {vote}": "내 투표 {vote}",
    "✅ Реализовано": "✅ 완료됨",
    "🔄 Обновить": "🔄 새로고침",
    # Письма
    "Восстановление пароля WYX": "WYX 비밀번호 재설정",
    "Вы запросили сброс пароля в WYX.": "WYX 비밀번호 재설정을 요청하셨어요.",
    "Подтверждение почты WYX": "WYX 이메일 인증",
    "Вы привязываете эту почту к аккаунту WYX.": "이 이메일을 WYX 계정에 연결하고 있어요.",
    "Код: {code}": "코드: {code}",
    "Он действует 15 минут. Если это не вы — просто не обращайте внимания на письмо.":
        "15분 동안 유효해요. 본인이 요청하지 않았다면 이 메일은 무시하세요.",
    "Код действует 15 минут. Если это не вы — просто не обращайте внимания на письмо.":
        "코드는 15분 동안 유효해요. 본인이 요청하지 않았다면 이 메일은 무시하세요.",
    "Хочет начать с вами переписку": "대화를 시작하고 싶어 해요",
    "Принял(а) ваш запрос на переписку": "대화 요청을 수락했어요",
}

_DICTS = {"en": EN, "ko": KO}
_VAR = re.compile(r"\{(\w+)\}")


def norm(code) -> str:
    """Код языка из профиля или заголовка → ru | en | ko (пусто и прочее — ru)."""
    code = str(code or "").strip().lower()[:2]
    return code if code in LANGS else DEFAULT


def lang_of(profile) -> str:
    """Язык человека: Profile.language, по умолчанию ru."""
    return norm(getattr(profile, "language", "") if profile is not None else "")


def tr(s, lang, **vars):
    """Перевод русской строки на lang; плейсхолдеры {name} подставляются
    одним проходом (подставленный текст повторно не разбирается)."""
    if s is None:
        return s
    lang = norm(lang)
    out = s if lang == DEFAULT else _DICTS[lang].get(s, s)
    if vars:
        vals = {k: render(v, lang) for k, v in vars.items()}
        out = _VAR.sub(lambda m: str(vals[m.group(1)]) if m.group(1) in vals else m.group(0), out)
    return out


class L:
    """Перевод «на потом»: строка и подстановки, язык — в момент отправки.
    Значения подстановок тоже могут быть L — переведутся на тот же язык."""
    __slots__ = ("s", "vars")

    def __init__(self, s, **vars):
        self.s = s
        self.vars = vars

    def __call__(self, lang):
        return tr(self.s, lang, **self.vars)

    def __str__(self):
        return self(DEFAULT)

    def __repr__(self):
        return f"L({self.s!r})"


def render(x, lang):
    """Строка как есть, L или функция lang -> str — в текст на языке lang."""
    if x is None or isinstance(x, str):
        return x
    if callable(x):
        return x(norm(lang))
    return str(x)


def clip(x, n):
    """Обрезать до n символов уже переведённый текст (x — строка, L или функция)."""
    if x is None or isinstance(x, str):
        return x[:n] if x else x
    return lambda lang: (render(x, lang) or "")[:n]


def variants(s):
    """Все языковые варианты строки — например, чтобы найти в базе сообщение
    бота, отправленное кому-то на его языке."""
    return [tr(s, lang) for lang in LANGS]


def by_lang(rows):
    """[(id, language), …] → {lang: [id, …]} — разбить получателей по языкам."""
    out = {}
    for pid, code in rows:
        out.setdefault(norm(code), []).append(pid)
    return out
