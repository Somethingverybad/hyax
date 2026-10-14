#!/usr/bin/env python3
"""Сборка en/ и ko/ версий лендинга из index.html (русский — источник).
Словарь ниже — по текстовым узлам; что не переведено, остаётся по-русски.
Запуск: python3 build-i18n.py (деплой делает это сам, см. ~/hyax-deploy-wyx.sh)."""
import os, re, io

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = io.open(os.path.join(HERE, "index.html"), encoding="utf-8").read()

T = {
"en": {
 "WYX — мессенджер": "WYX — messenger",
 "WYX — мессенджер: чаты и группы, каналы, секретные чаты, голосовые и видеосообщения, стикеры и звуки, музыка и звонки. iPhone, Android, macOS, Windows, Linux.": "WYX — messenger: chats and groups, channels, secret chats, voice and video messages, stickers and sounds, music and calls. iPhone, Android, macOS, Windows, Linux.",
 "Скачать": "Download", "Шифрование": "Encryption", "Правила": "Rules", "Конфиденциальность": "Privacy",
 "Личные и групповые чаты, каналы, секретные чаты с шифрованием на устройстве, голосовые и видеосообщения, свои стикеры и звуки, музыка и звонки.": "Direct and group chats, channels, secret chats encrypted on your device, voice and video messages, your own stickers and sounds, music and calls.",
 "Как мы храним данные": "How we store data", "Что внутри": "What's inside",
 "Чаты и группы": "Chats and groups",
 "Ответы, упоминания через @, реакции, пересылка, закреплённые сообщения, форматирование текста и блоки кода.": "Replies, @mentions, reactions, forwarding, pinned messages, text formatting and code blocks.",
 "Каналы": "Channels",
 "Посты карточками, реакции, комментарии, просмотры. Подписка в одно касание, уведомления по желанию.": "Posts as cards, reactions, comments, views. One-tap subscribe, notifications if you want them.",
 "Секретные чаты": "Secret chats",
 "Сообщения, фото и голосовые шифруются на устройстве. Сервер хранит только шифротекст, ключи — у собеседников.": "Messages, photos and voice notes are encrypted on the device. The server keeps only ciphertext; the keys stay with the two of you.",
 "Голосовые и видео-треугольники": "Voice and video triangles",
 "Короткие видеосообщения в фирменной форме — можно перевернуть прямо во время записи. Голосовые с расшифровкой.": "Short video messages in our signature shape — flip them while recording. Voice notes with transcription.",
 "Стикеры и звуки": "Stickers and sounds",
 "Свои стикерпаки и паки звуков для уведомлений. Делитесь ими по ссылке, звуковые стикеры — в любой чат.": "Your own sticker packs and notification sound packs. Share them by link; sound stickers go in any chat.",
 "Музыка и звонки": "Music and calls",
 "Плейлисты из треков в чатах, плеер с очередью и управлением с экрана блокировки. Аудиозвонки между устройствами.": "Playlists from tracks in chats, a player with a queue and lock-screen controls. Audio calls between devices.",
 "Как работают секретные чаты": "How secret chats work",
 "Сообщения шифруются на вашем телефоне и расшифровываются только на телефоне собеседника. Ключ при этом по сети не передаётся вообще — каждая сторона вычисляет его сама. Как такое возможно, проще всего показать на краске.": "Messages are encrypted on your phone and decrypted only on your contact's phone. The key never travels over the network at all — each side computes it on its own. The easiest way to show how that's possible is with paint.",
 "На краске": "With paint",
 "Алиса и Боб берут одну и ту же": "Alice and Bob take the same", "общую краску": "shared paint", ", скажем жёлтую. Её знают все, в том числе подслушивающий.": ", say yellow. Everyone knows it, including the eavesdropper.",
 "Каждый добавляет к ней свой": "Each adds their own", "секретный цвет": "secret colour", ": Алиса — красный, Боб — синий. Секрет никуда не уходит.": ": Alice red, Bob blue. The secret never leaves them.",
 "Смесями они": "They", "обмениваются": "swap the mixtures", ". Подслушивающий видит оранжевую и зелёную банки.": ". The eavesdropper sees an orange can and a green one.",
 "Каждый подмешивает в чужую смесь свой секрет ещё раз. У обоих получается": "Each mixes their own secret into the other's mixture once more. Both end up with", "один и тот же": "the very same", "коричневый — это и есть ключ.": "brown — and that is the key.",
 "Смешать краску легко, а разложить обратно на цвета нельзя. Поэтому у подслушивающего есть жёлтая, оранжевая и зелёная, но коричневую он не получит: для неё нужен чей-то секрет.": "Mixing paint is easy; un-mixing it back into colours is impossible. So the eavesdropper has yellow, orange and green, but never gets brown: that needs someone's secret.",
 "На числах": "With numbers",
 "Вместо краски — возведение в степень с остатком от деления. Общие числа:": "Instead of paint: raising to a power with a remainder. Shared numbers:", "и": "and",
 "Секрет Алисы": "Alice's secret", ". Она шлёт": ". She sends", "Секрет Боба": "Bob's secret", ". Он шлёт": ". He sends",
 "Алиса считает": "Alice computes", "Боб считает": "Bob computes", "Общий ключ": "The shared key", "есть у обоих, а по сети ходили только": "is known to both, while only",
 ". Подобрать секрет по ним при 23 можно за минуту, но в WYX числа длиной 256 бит (эллиптическая кривая P-256), и перебор занял бы дольше, чем существует Вселенная.": " travelled over the network. With 23 you could brute-force the secret in a minute, but WYX uses 256-bit numbers (the P-256 elliptic curve), and brute force would take longer than the Universe has existed.",
 "Что видит сервер": "What the server sees",
 "Из общего ключа на обоих устройствах выводится ключ шифрования (HKDF), и каждое сообщение закрывается AES-256-GCM. На сервер уходит только шифротекст: набор байтов без ключа. Сервер хранит и доставляет его, но прочитать не может — ключа у него никогда не было.": "On both devices an encryption key is derived from the shared key (HKDF), and every message is sealed with AES-256-GCM. Only ciphertext reaches the server: bytes without a key. The server stores and delivers it but cannot read it — it never had the key.",
 "Сообщения секретного чата не попадают в облачный кеш и в резервные копии. Если устройство потеряно, переписка потеряна вместе с ним — это цена того, что её нет больше нигде.": "Secret chat messages never go into the cloud cache or backups. Lose the device and the conversation is gone with it — that's the price of it existing nowhere else.",
 "Шифрование защищает канал, а не само устройство. Если на телефоне стоит программа, читающая экран или клавиатуру, она увидит текст до шифрования. Берегите телефон и не ставьте что попало.": "Encryption protects the channel, not the device itself. If your phone has software reading the screen or keyboard, it sees the text before encryption. Guard your phone and don't install just anything.",
 "Через TestFlight: установите TestFlight, затем откройте приглашение.": "Via TestFlight: install TestFlight, then open the invitation.", "Приглашение": "Invitation",
 "Установочный файл; при установке разрешите источник.": "Install file; allow the source when installing.",
 "Один образ для Intel и Apple Silicon, заверен у Apple.": "One image for Intel and Apple Silicon, notarized by Apple.",
 "Один установщик для x64 и ARM.": "One installer for x64 and ARM.", "Установщик": "Installer",
 "x86_64. Для Debian и Ubuntu — deb, для остальных — AppImage.": "x86_64. deb for Debian and Ubuntu, AppImage for the rest.",
 "Политика конфиденциальности": "Privacy policy",
},
"ko": {
 "WYX — мессенджер": "WYX — 메신저",
 "WYX — мессенджер: чаты и группы, каналы, секретные чаты, голосовые и видеосообщения, стикеры и звуки, музыка и звонки. iPhone, Android, macOS, Windows, Linux.": "WYX — 메신저: 채팅과 그룹, 채널, 비밀 채팅, 음성·동영상 메시지, 스티커와 소리, 음악과 통화. iPhone, Android, macOS, Windows, Linux.",
 "Скачать": "다운로드", "Шифрование": "암호화", "Правила": "이용 규칙", "Конфиденциальность": "개인정보",
 "Личные и групповые чаты, каналы, секретные чаты с шифрованием на устройстве, голосовые и видеосообщения, свои стикеры и звуки, музыка и звонки.": "개인·그룹 채팅, 채널, 기기에서 암호화되는 비밀 채팅, 음성·동영상 메시지, 나만의 스티커와 소리, 음악과 통화.",
 "Как мы храним данные": "데이터를 보관하는 방식", "Что внутри": "무엇이 있나요",
 "Чаты и группы": "채팅과 그룹",
 "Ответы, упоминания через @, реакции, пересылка, закреплённые сообщения, форматирование текста и блоки кода.": "답장, @멘션, 반응, 전달, 고정 메시지, 텍스트 서식과 코드 블록.",
 "Каналы": "채널",
 "Посты карточками, реакции, комментарии, просмотры. Подписка в одно касание, уведомления по желанию.": "카드형 글, 반응, 댓글, 조회수. 한 번의 탭으로 구독, 알림은 원할 때만.",
 "Секретные чаты": "비밀 채팅",
 "Сообщения, фото и голосовые шифруются на устройстве. Сервер хранит только шифротекст, ключи — у собеседников.": "메시지, 사진, 음성이 기기에서 암호화돼요. 서버는 암호문만 보관하고 키는 두 사람에게만 있어요.",
 "Голосовые и видео-треугольники": "음성과 삼각형 동영상",
 "Короткие видеосообщения в фирменной форме — можно перевернуть прямо во время записи. Голосовые с расшифровкой.": "WYX만의 모양을 가진 짧은 동영상 메시지. 녹화 중에 뒤집을 수도 있어요. 음성 메시지는 받아쓰기 지원.",
 "Стикеры и звуки": "스티커와 소리",
 "Свои стикерпаки и паки звуков для уведомлений. Делитесь ими по ссылке, звуковые стикеры — в любой чат.": "나만의 스티커 팩과 알림 소리 팩. 링크로 공유하고, 소리 스티커는 어느 채팅에나.",
 "Музыка и звонки": "음악과 통화",
 "Плейлисты из треков в чатах, плеер с очередью и управлением с экрана блокировки. Аудиозвонки между устройствами.": "채팅 속 음악으로 만드는 재생목록, 대기열과 잠금화면 제어가 있는 플레이어. 기기 간 음성 통화.",
 "Как работают секретные чаты": "비밀 채팅은 어떻게 동작하나요",
 "Сообщения шифруются на вашем телефоне и расшифровываются только на телефоне собеседника. Ключ при этом по сети не передаётся вообще — каждая сторона вычисляет его сама. Как такое возможно, проще всего показать на краске.": "메시지는 내 폰에서 암호화되고 상대방 폰에서만 복호화돼요. 키는 네트워크로 전혀 전송되지 않고, 양쪽이 각자 계산합니다. 어떻게 가능한지는 물감으로 보여 드리는 게 가장 쉬워요.",
 "На краске": "물감으로",
 "Алиса и Боб берут одну и ту же": "앨리스와 밥이 같은", "общую краску": "공용 물감", ", скажем жёлтую. Её знают все, в том числе подслушивающий.": "을 가져와요. 노란색이라고 하죠. 엿듣는 사람까지 모두가 아는 색이에요.",
 "Каждый добавляет к ней свой": "각자 거기에 자기만의", "секретный цвет": "비밀 색", ": Алиса — красный, Боб — синий. Секрет никуда не уходит.": "을 섞어요. 앨리스는 빨강, 밥은 파랑. 비밀은 어디로도 나가지 않아요.",
 "Смесями они": "섞은 물감을 서로", "обмениваются": "교환해요", ". Подслушивающий видит оранжевую и зелёную банки.": ". 엿듣는 사람은 주황색 통과 초록색 통을 봅니다.",
 "Каждый подмешивает в чужую смесь свой секрет ещё раз. У обоих получается": "각자 상대의 혼합물에 자기 비밀 색을 한 번 더 섞어요. 둘 다", "один и тот же": "완전히 같은", "коричневый — это и есть ключ.": "갈색을 얻습니다. 이것이 바로 키예요.",
 "Смешать краску легко, а разложить обратно на цвета нельзя. Поэтому у подслушивающего есть жёлтая, оранжевая и зелёная, но коричневую он не получит: для неё нужен чей-то секрет.": "물감을 섞기는 쉽지만 다시 원래 색으로 나누는 건 불가능해요. 그래서 엿듣는 사람에게는 노랑, 주황, 초록은 있어도 갈색은 절대 없어요. 누군가의 비밀이 필요하니까요.",
 "На числах": "숫자로",
 "Вместо краски — возведение в степень с остатком от деления. Общие числа:": "물감 대신 거듭제곱의 나머지를 써요. 공용 숫자:", "и": "와",
 "Секрет Алисы": "앨리스의 비밀", ". Она шлёт": ". 앨리스가 보내는 값", "Секрет Боба": "밥의 비밀", ". Он шлёт": ". 밥이 보내는 값",
 "Алиса считает": "앨리스의 계산", "Боб считает": "밥의 계산", "Общий ключ": "공용 키", "есть у обоих, а по сети ходили только": "는 둘 다 갖고 있고, 네트워크로 오간 것은",
 ". Подобрать секрет по ним при 23 можно за минуту, но в WYX числа длиной 256 бит (эллиптическая кривая P-256), и перебор занял бы дольше, чем существует Вселенная.": "뿐이에요. 23이라면 1분이면 비밀을 알아내겠지만, WYX는 256비트 숫자(P-256 타원곡선)를 써서 전수 조사에는 우주의 나이보다 긴 시간이 걸립니다.",
 "Что видит сервер": "서버가 보는 것",
 "Из общего ключа на обоих устройствах выводится ключ шифрования (HKDF), и каждое сообщение закрывается AES-256-GCM. На сервер уходит только шифротекст: набор байтов без ключа. Сервер хранит и доставляет его, но прочитать не может — ключа у него никогда не было.": "양쪽 기기에서 공용 키로부터 암호화 키(HKDF)를 만들고, 모든 메시지를 AES-256-GCM으로 잠가요. 서버에는 암호문, 즉 키 없는 바이트 뭉치만 갑니다. 서버는 보관하고 전달할 뿐 읽을 수 없어요. 키를 가진 적이 없으니까요.",
 "Сообщения секретного чата не попадают в облачный кеш и в резервные копии. Если устройство потеряно, переписка потеряна вместе с ним — это цена того, что её нет больше нигде.": "비밀 채팅 메시지는 클라우드 캐시나 백업에 들어가지 않아요. 기기를 잃으면 대화도 함께 사라져요. 다른 어디에도 없다는 것의 대가예요.",
 "Шифрование защищает канал, а не само устройство. Если на телефоне стоит программа, читающая экран или клавиатуру, она увидит текст до шифрования. Берегите телефон и не ставьте что попало.": "암호화는 통로를 지키지, 기기 자체를 지키진 않아요. 화면이나 키보드를 읽는 앱이 폰에 있다면 암호화 전의 텍스트를 보게 됩니다. 폰을 잘 지키고 아무거나 설치하지 마세요.",
 "Через TestFlight: установите TestFlight, затем откройте приглашение.": "TestFlight로: TestFlight를 설치한 뒤 초대를 여세요.", "Приглашение": "초대",
 "Установочный файл; при установке разрешите источник.": "설치 파일. 설치할 때 출처를 허용하세요.",
 "Один образ для Intel и Apple Silicon, заверен у Apple.": "Intel과 Apple Silicon 공용 이미지, Apple 공증 완료.",
 "Один установщик для x64 и ARM.": "x64와 ARM 공용 설치 파일.", "Установщик": "설치 파일",
 "x86_64. Для Debian и Ubuntu — deb, для остальных — AppImage.": "x86_64. Debian과 Ubuntu는 deb, 나머지는 AppImage.",
 "Политика конфиденциальности": "개인정보 처리방침",
},
}

VER = {"en": "Current version", "ko": "현재 버전"}

SWITCH = '<span class="lang"><a href="/" data-lang="ru"{ru}>RU</a><a href="/en/" data-lang="en"{en}>EN</a><a href="/ko/" data-lang="ko"{ko}>KO</a></span>'
ALT = '<link rel="alternate" hreflang="ru" href="https://wyx.su/">\n<link rel="alternate" hreflang="en" href="https://wyx.su/en/">\n<link rel="alternate" hreflang="ko" href="https://wyx.su/ko/">\n<link rel="alternate" hreflang="x-default" href="https://wyx.su/">\n'
# Автовыбор: первый визит на корень без явного выбора — уводим на язык браузера.
REDIRECT = '''<script>
(function(){try{var c=localStorage.getItem("wyx-lang");if(c){if(c!=="ru"&&location.pathname==="/")location.replace("/"+c+"/");return;}
var n=(navigator.language||"").slice(0,2).toLowerCase();if((n==="en"||n==="ko")&&location.pathname==="/")location.replace("/"+n+"/");}catch(e){}})();
document.addEventListener("click",function(e){var a=e.target.closest&&e.target.closest("[data-lang]");if(a){try{localStorage.setItem("wyx-lang",a.getAttribute("data-lang"));}catch(_){}}});
</script>
'''

def strip(html):
    """Убрать уже вставленные переключатель, hreflang и скрипт автовыбора —
    сборка повторяема: index.html (источник) после первого прогона их содержит."""
    html = re.sub(r'<span class="lang">.*?</span></span>|<span class="lang">(?:<a [^>]*>[A-Z]{2}</a>)+</span>\n?\s*', '', html, flags=re.S)
    html = html.replace(ALT, '').replace(REDIRECT, '')
    return html

def switch(cur):
    return SWITCH.format(**{l: (' aria-current="page"' if l == cur else '') for l in ("ru", "en", "ko")})

def translate(html, lang):
    d = T[lang]
    def rep(m):
        inner = m.group(1); key = inner.strip()
        if key in d:
            lead = inner[:len(inner) - len(inner.lstrip())]; trail = inner[len(inner.rstrip()):]
            return ">" + lead + d[key] + trail + "<"
        return m.group(0)
    out = re.sub(r">([^<>]+)<", rep, html)
    out = out.replace('<html lang="ru">', f'<html lang="{lang}">')
    for k, v in d.items():
        out = out.replace(f'content="{k}"', f'content="{v}"').replace(f"<title>{k}</title>", f"<title>{v}</title>")
    # Строка версии собирается скриптом страницы — подпись в нём тоже переводим.
    out = out.replace('"Текущая версия "', '"' + VER[lang] + ' "')
    return out

def with_nav(html, lang):
    html = html.replace("</nav>", switch(lang) + "\n    </nav>", 1)
    html = html.replace("</head>", ALT + REDIRECT + "</head>", 1)
    return html

BASE = strip(SRC)
io.open(os.path.join(HERE, "index.html"), "w", encoding="utf-8").write(with_nav(BASE, "ru"))
for lang in ("en", "ko"):
    os.makedirs(os.path.join(HERE, lang), exist_ok=True)
    io.open(os.path.join(HERE, lang, "index.html"), "w", encoding="utf-8").write(with_nav(translate(BASE, lang), lang))
    print(lang, "ok")
