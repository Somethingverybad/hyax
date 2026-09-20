# External TestFlight — что вставить в App Store Connect

Сборка: WhoYaX 1.1.11 (132). Поля ниже — раздел TestFlight → Test Information
и Beta App Review Information. Английский текст читает ревьюер Apple.

## Перед отправкой

Сделано 2026-09-20: бэкенд, веб и nginx выложены, iOS 130 загружена, аккаунты
`apple_review` и `apple_review_peer` заведены с перепиской. Пароли лежат в
`secrets/apple_review.txt` (вне git) — вписать их в поля ниже.

Осталось в App Store Connect:

1. Дождаться обработки сборки 132.
2. TestFlight → создать внешнюю группу, добавить сборку 132.
3. Заполнить Test Information и Beta App Review Information текстами ниже.
4. Возрастной рейтинг 17+ (User Generated Content — Yes, Mature/Suggestive
   Themes — Infrequent/Mild, Profanity or Crude Humor — Infrequent/Mild).
   Название приложения в карточке — WhoYaX.
5. Отправить на Beta App Review.

## Test Information

**Beta App Description**

```
WhoYaX is a messenger: direct and group chats, channels, voice and video
messages, calls, sticker packs and sound packs (custom notification sounds).
Sign-up needs only a login and a password.
```

**What to Test**

```
- Sign up (login + password, accept the Terms), sign in on a second device.
- Send text, photos, video, voice messages, stickers and sound stickers.
- Audio and video calls between two accounts.
- Push notifications with custom sounds.
- Report a message or a user, block a user (Profile card → Block).
- Profile → Privacy: 18+ toggle, Terms, Privacy Policy, Delete account.
```

Поля Test Information помечены «Russian» (основной язык приложения) — их читают
тестировщики, вставлять русский вариант. Review Notes ниже остаются на английском.
Про поиск в Spotlight по прежнему названию в этих полях не писать: их видит
ревьюер Apple. Тестировщикам сказать лично.

**Beta App Description (RU)**

```
WhoYaX — мессенджер: личные и групповые чаты, каналы, голосовые и видеосообщения, звонки, стикерпаки и паки звуков для уведомлений. Для регистрации нужны только логин и пароль.
```

**What to Test (RU)**

```
- Регистрация (логин + пароль, принять правила), вход на втором устройстве.
- Сообщения: текст, фото, видео, голосовые, стикеры и звуковые стикеры.
- Аудио- и видеозвонки между двумя аккаунтами.
- Пуш-уведомления со своими звуками.
- Жалоба на сообщение или пользователя, блокировка (карточка пользователя → «Заблокировать»).
- Профиль → Конфиденциальность: «Показывать 18+», правила, политика, удаление аккаунта.
```

**Feedback Email:** Ancher001@yandex.ru
**Privacy Policy URL:** https://huyax.e-tree.su/privacy
**Marketing URL (необязательно):** https://huyax.e-tree.su/apk/

## Beta App Review Information

**Sign-in required:** Yes
**User name:** `apple_review`
**Password:** `<вписать>`

**Review Notes**

```
WhoYaX is a messenger with user-generated content. Guideline 1.2 measures:

1. Terms (EULA): registration requires accepting the Terms of Use and Privacy
   Policy; the Terms state zero tolerance for objectionable content and abusive
   users. Existing users see a blocking consent screen on first launch.
   Terms: https://huyax.e-tree.su/terms  Privacy: https://huyax.e-tree.su/privacy
2. Reporting: long-press a message → "Пожаловаться" (Report); user card →
   "Пожаловаться". Sticker and sound packs can be reported too. Reports go to a
   moderators' system chat and the admin panel; we act within 24 hours by
   removing the content and ejecting the offending user.
3. Blocking: user card → "Заблокировать". Messages and push notifications from
   a blocked user stop immediately. Block list: Profile → Конфиденциальность.
4. Filtering: sticker and sound packs marked 18+ are hidden by default. They
   appear only after the user enables "Показывать 18+" in Profile →
   Конфиденциальность and confirms being 18 or older.
5. Account deletion (5.1.1(v)): Profile → Конфиденциальность → "Удалить
   аккаунт", confirmed with the password. Deletes the profile, messages,
   chats, channels and packs immediately.

There is no people directory or search: users start a chat only via a shared
profile link, so strangers cannot be contacted at random.

Demo: the account above already has a conversation with "apple_review_peer"
(password: <вписать>) — sign in with it on a second device to test calls,
reporting and blocking.

Encryption: HTTPS only, plus AES-GCM from Apple CryptoKit to decrypt push
payloads in the notification service extension. No proprietary cryptography;
ITSAppUsesNonExemptEncryption is NO.

Background modes: voip — incoming calls via PushKit/CallKit; audio — calls and
the in-chat music player; remote-notification — message sync.

The UI is in Russian. Contact: Ancher001@yandex.ru
```

## Обязательства, которые теперь записаны в правилах и политике

- Жалобы разбираются в течение 24 часов (чат «Жалобы» и админка → Reports).
- После удаления аккаунта вложения в S3 стираются в течение 30 дней. У роли
  приложения нет права на удаление объектов, поэтому ключи пишутся в
  `backend/private/s3_orphans.log` на сервере — чистить вручную или выдать
  роли право `DeleteObject` и дописать удаление.
- Контакт для обращений — Ancher001@yandex.ru (константа в
  `sux-chat-app/src/lib/brand.ts`).
