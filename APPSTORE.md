# App Store — первая публикация (версия 1.1.33, сборка 194)

> 2026-10-20. Сборка 194 загружена в App Store Connect как **1.1.33** (внутри
> приложение 1.1.38 / 757 — это нормально, в магазин идёт номер из сборки).
> Все тексты ниже — без чужих брендов и сервисов, без «18+» и мата
> (отказы 4.1(a)/2.3.8 за это уже были, см. TESTFLIGHT_EXTERNAL.md).
> Пароли демо-аккаунтов — `secrets/apple_review.txt` (вне git).

## Порядок действий в App Store Connect

1. **App Information** (вкладка приложения, не версии):
   - Name → `WYX` (запись сейчас называется WhoYaX; в сборке CFBundleDisplayName = WYX — должно совпадать).
   - Subtitle → см. ниже.
   - Primary Category → **Social Networking**, Secondary → **Music**.
   - Content Rights → «Does not contain, show, or access third-party content» (всё содержимое — своё и пользовательское).
   - Age Rating → ответы ниже.
   - Privacy Policy URL → `https://wyx.su/privacy`.
2. **App Privacy** → заполнить по разделу «Конфиденциальность» ниже, опубликовать.
3. **Pricing and Availability** → Free; страны — все (или выбрать).
4. **iOS App → 1.1.33**:
   - Screenshots: iPhone 6.9" (обязательно, 1320×2868 или 1290×2796) и **iPad 13"** (обязательно: сборка поддерживает iPad, TARGETED_DEVICE_FAMILY = 1,2; 2064×2752 или 2048×2732). 3–10 штук каждого.
   - Promotional Text, Description, Keywords, Support URL, Marketing URL — ниже.
   - Build → выбрать 194 (1.1.33).
   - App Review Information → демо-аккаунт и заметки ниже.
   - Version Release → «Manually release» (выложить руками после одобрения).
   - Export Compliance → уже в Info.plist (`ITSAppUsesNonExemptEncryption = NO`), вопрос не задаётся; если спросят — «No, only HTTPS / exempt».
   - Advertising Identifier → No.
5. Add for Review → Submit.

Локализации карточки: **Russian (основная)**, **English**, при желании Korean
(интерфейс приложения есть на всех трёх). Ниже русский и английский.

---

## Тексты карточки — Russian

**Name** (≤30): `WYX`

**Subtitle** (≤30): `Чаты, каналы, музыка и звонки`

**Promotional Text** (≤170):
```
Эфир вперемешку, лайки и прослушивания у плейлистов, цитаты из части сообщения и вкладка «Недавние» в стикерах. Голосовые — до полутора минут.
```

**Description** (≤4000):
```
WYX — мессенджер, где переписка, музыка и общение по голосу живут в одном месте. Регистрация — только логин и пароль, без номера телефона.

ЧАТЫ И ГРУППЫ
• Ответы, упоминания через @, реакции, пересылка, закреплённые сообщения.
• Форматирование текста и блоки кода.
• Выделите часть сообщения и процитируйте только её — по нажатию на цитату откроется оригинал.
• Перевод сообщений на ваш язык одним нажатием, перевод можно скопировать.
• Видно, кто сейчас печатает, записывает голосовое или снимает видеосообщение.

СЕКРЕТНЫЕ ЧАТЫ
• Сообщения, фото и голосовые шифруются на вашем устройстве. Сервер хранит только шифротекст, ключи остаются у собеседников.
• Перенос секретных чатов на другое устройство — без передачи ключей через сервер.

ГОЛОСОВЫЕ И ВИДЕОСООБЩЕНИЯ
• Голосовые до полутора минут с расшифровкой в текст.
• Короткие видеосообщения в фирменной форме треугольника — переворачиваются прямо во время записи.
• Запись без рук: нажмите и сдвиньте вверх.

КАНАЛЫ И СТЕНА
• Каналы с постами-карточками, реакциями, комментариями и опросами.
• Стена — лента ваших друзей. Уведомления о новых постах можно включить или выключить целиком и для отдельных авторов.

МУЗЫКА
• Плейлисты из треков в чатах и своих файлов, плеер с очередью, повтором и управлением с экрана блокировки.
• Эфир: слушайте плейлист вместе с друзьями синхронно — одна и та же секунда у всех. Ведущий ставит паузу, пропускает треки и включает «вперемешку».
• У плейлистов — прослушивания и лайки, продолжение с того места, где вы остановились.

ЗВОНКИ
• Аудио- и видеозвонки между устройствами с уведомлением о входящем вызове.

СТИКЕРЫ И ЗВУКИ
• Свои стикерпаки и паки звуков для уведомлений, обмен по ссылке.
• Звуковые стикеры в любой чат, вкладка «Недавние» с часто используемыми.

ЕЩЁ
• Боты и мини-приложения внутри чатов.
• Рисование поверх фото, геопозиция в чат, файлы и альбомы.
• Тёмная и светлая тема, несколько оформлений интерфейса.
• Интерфейс на русском, английском и корейском.

БЕЗОПАСНОСТЬ И КОНТРОЛЬ
• Жалоба на сообщение, пользователя, стикерпак или пак звуков — разбирается в течение суток.
• Блокировка пользователя останавливает сообщения и уведомления от него.
• Фильтр контента в настройках конфиденциальности.
• Удаление аккаунта из приложения — вместе со всеми данными.

Правила: https://wyx.su/terms
Конфиденциальность: https://wyx.su/privacy
```

**Keywords** (≤100, через запятую без пробелов):
```
мессенджер,чат,каналы,секретный чат,шифрование,звонки,стикеры,голосовые,музыка,плейлист,эфир
```

**What's New in This Version** (для первой версии можно коротко):
```
Первая версия в App Store: чаты, каналы, секретные чаты, голосовые и видеосообщения, музыка и эфир, звонки, стикеры и звуки.
```

**Support URL:** `https://wyx.su`
**Marketing URL:** `https://wyx.su`
**Copyright:** `© 2026 Andrey Cherenev`

---

## Тексты карточки — English

**Name:** `WYX`

**Subtitle:** `Chats, channels, music, calls`

**Promotional Text:**
```
Shuffle for live stations, likes and play counts on playlists, quote part of a message, and a Recent tab for stickers. Voice messages up to 90 seconds.
```

**Description:**
```
WYX is a messenger that puts chats, music and voice in one place. Sign up with a login and a password — no phone number.

CHATS AND GROUPS
• Replies, @mentions, reactions, forwarding and pinned messages.
• Text formatting and code blocks.
• Select part of a message and quote just that part — tap the quote to jump to the original.
• One-tap translation into your language; the translation can be copied.
• See who is typing, recording a voice message or shooting a video message.

SECRET CHATS
• Messages, photos and voice notes are encrypted on your device. The server stores only ciphertext; the keys stay with the participants.
• Move secret chats to another device without ever sending keys through the server.

VOICE AND VIDEO MESSAGES
• Voice messages up to 90 seconds with speech-to-text.
• Short video messages in a signature triangle shape — flip them while recording.
• Hands-free recording: press and slide up.

CHANNELS AND THE WALL
• Channels with card-style posts, reactions, comments and polls.
• The Wall is your friends' feed. Push notifications for new posts can be turned off entirely or per author.

MUSIC
• Playlists from tracks in chats and your own files; a player with a queue, repeat and lock-screen controls.
• Live stations: listen to a playlist together with friends, in sync to the second. The host pauses, skips and turns on shuffle.
• Play counts and likes on playlists; resume where you left off.

CALLS
• Audio and video calls between devices with incoming-call alerts.

STICKERS AND SOUNDS
• Your own sticker packs and notification sound packs, shared by link.
• Sound stickers in any chat and a Recent tab with the ones you use most.

AND MORE
• Bots and mini apps inside chats.
• Draw on photos, share a location, send files and albums.
• Dark and light themes and several interface styles.
• Interface in English, Russian and Korean.

SAFETY AND CONTROL
• Report a message, a user, a sticker pack or a sound pack — handled within 24 hours.
• Blocking a user stops their messages and notifications.
• Content filter in privacy settings.
• Delete your account from within the app, together with all your data.

Terms: https://wyx.su/terms
Privacy: https://wyx.su/privacy
```

**Keywords:**
```
messenger,chat,channels,secret chat,encryption,calls,stickers,voice,music,playlist,radio
```

**What's New:**
```
First App Store release: chats, channels, secret chats, voice and video messages, music and live stations, calls, stickers and sounds.
```

---

## Age Rating (анкета)

| Вопрос | Ответ |
|---|---|
| Violence (cartoon / realistic / prolonged) | None |
| Sexual Content or Nudity | None |
| Mature/Suggestive Themes | Infrequent/Mild |
| Profanity or Crude Humor | Infrequent/Mild |
| Horror/Fear Themes | None |
| Medical/Treatment Information | None |
| Alcohol, Tobacco, or Drug Use | None |
| Gambling / Contests | None |
| **Unrestricted Web Access** | No |
| **User-Generated Content** | Yes — с модерацией, жалобами и блокировкой (см. Review Notes) |
| **Messaging and chat** (если спрашивают) | Yes |
| Parental controls / Age assurance | No |

Ожидаемый результат — 17+ (в новой шкале 16+/18+). В полях для Apple не писать
«18+» — только «фильтр контента».

---

## App Privacy («Конфиденциальность приложения»)

**Do you collect data from this app?** → Yes. **Tracking** → No (данные не
используются для рекламы и не передаются брокерам).

| Тип данных | Собираем | Связано с пользователем | Цель | Примечание |
|---|---|---|---|---|
| Contact Info → **Email Address** | Да, если пользователь сам добавил | Да | App Functionality | восстановление доступа; необязательно |
| User Content → **Photos or Videos** | Да | Да | App Functionality | вложения в сообщениях и постах |
| User Content → **Audio Data** | Да | Да | App Functionality | голосовые, треки, звуковые стикеры |
| User Content → **Other User Content** | Да | Да | App Functionality | тексты сообщений, посты, стикеры |
| User Content → **Customer Support** | Да | Да | App Functionality | баг-репорты из приложения (описание, скриншот, лог без текстов сообщений) |
| Identifiers → **User ID** | Да | Да | App Functionality | логин / внутренний id |
| Identifiers → **Device ID** | Да | Да | App Functionality | идентификатор установки для секретных чатов и пушей |
| Location → **Precise Location** | Да, только когда пользователь сам отправляет геопозицию в чат | Да | App Functionality | в фоне не собирается |
| Diagnostics → **Other Diagnostic Data** | Да | Да | App Functionality | лог сессии в баг-репорте, по инициативе пользователя |
| Usage Data, Browsing History, Search History, Purchases, Financial, Health, Contacts, Sensitive Info | **Нет** | — | — | аналитики и рекламы нет |

Данные секретных чатов сервер видит только в зашифрованном виде — это можно
упомянуть в описании, но в анкете они всё равно считаются «User Content».

---

## App Review Information

**Sign-in required:** Yes
**User name:** `apple_review`
**Password:** из `secrets/apple_review.txt`
**Contact:** Andrey Cherenev, Ancher001@yandex.ru, телефон — вписать.

**Notes** (английский, читает ревьюер):
```
WYX is a messenger with user-generated content. The UI is available in English,
Russian and Korean (follows the device language; can be changed in Profile).

Demo: the account above already has conversations with "apple_review_peer"
(password in the same place) — sign in with it on a second device to test calls,
live stations, reporting and blocking. Both accounts have a playlist; open
Music → start a live station from a playlist, join it from the other account.

Guideline 1.2 measures:
1. Terms (EULA): registration requires accepting the Terms of Use and Privacy
   Policy (https://wyx.su/terms, https://wyx.su/privacy). The Terms state zero
   tolerance for objectionable content and abusive users.
2. Reporting: long-press a message → Report; user card → Report; sticker and
   sound packs can be reported too. Reports go to a moderators' chat and the
   admin panel; we act within 24 hours by removing content and ejecting users.
3. Blocking: user card → Block. Messages and push notifications from a blocked
   user stop immediately. Block list: Profile → Privacy.
4. Filtering: sticker and sound packs flagged as mature are hidden by default
   and appear only after the user enables the content filter in Profile → Privacy
   and confirms their age.
5. Account deletion (5.1.1(v)): Profile → Privacy → Delete account, confirmed
   with the password. Deletes the profile, messages, chats, channels and packs.

There is no people directory or search: a chat starts only via a shared profile
link, so strangers cannot be contacted at random.

Music: tracks are uploaded by users for their own playlists and shared only
with people they chat with (or by an explicit link); a "live station" plays a
playlist in sync for its listeners — nothing is streamed from third parties.

Encryption: HTTPS; secret chats use device-side AES-GCM with keys derived via
ECDH P-256 (Apple CryptoKit); push payloads are decrypted in the notification
service extension. No proprietary cryptography; ITSAppUsesNonExemptEncryption
is NO.

Background modes: voip — incoming calls (PushKit/CallKit); audio — calls and the
music player; remote-notification — message sync.
```

---

## Скриншоты

Нужны два набора: **iPhone 6.9"** и **iPad 13"** (iPad обязателен, пока сборка
поддерживает iPad). Снимаются в симуляторе (iPhone 17 Pro Max, iPad Pro 13")
с тестовых аккаунтов `zz_*` на локальном стенде или с `apple_review*` на бою.
Без чужих брендов, имён живых людей и спорного контента на экране.

Порядок (3–10 штук):
1. Список чатов с островком и непрочитанными.
2. Чат: реакции, ответ, цитата, стикер, голосовое с расшифровкой.
3. Секретный чат (замок в шапке) и экран «Как работает шифрование».
4. Видеосообщение-треугольник при записи.
5. Канал с постом-карточкой, опросом и комментариями.
6. Музыка: плейлист и эфир с кнопками ведущего («Дальше», «Пауза», «Вперемешку»).
7. Звонок.
8. Стикеры: вкладка «Недавние» и свой пак.

Подписи на скриншотах — опционально; если делать, те же формулировки, что в
описании.
