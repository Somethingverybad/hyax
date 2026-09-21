import uuid
from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone

# Профиль пользователя
class Profile(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.OneToOneField(User, on_delete=models.CASCADE)
    username = models.CharField(max_length=150, unique=True)
    avatar_url = models.TextField(blank=True, null=True)
    # Обложка профиля — широкий баннер за аватаром (см. ProfileImageUploadView).
    # Пусто — на экране профиля рисуется однотонная подложка.
    cover_url = models.TextField(blank=True, null=True)
    status = models.CharField(max_length=20, default="online")  # Статус онлайн/оффлайн
    call_status = models.CharField(max_length=20, default="idle")  # idle, calling, in_call
    bio = models.TextField(blank=True, null=True, max_length=500)  # Пользовательский статус/описание
    # Показывать текст сообщения в уведомлении. Выключено — в пуше только «Новое сообщение».
    push_preview = models.BooleanField(default=True)
    # Р.Ё.В: принимать ли вибрацию от собеседника (см. consumers.handle_rov).
    rov_enabled = models.BooleanField(default=True)
    # Показывать паки звуков и стикеров с пометкой 18+. По умолчанию выключено:
    # такие паки не попадают в пикер и не открываются по ссылке, пока человек
    # сам не включит настройку и не подтвердит возраст.
    allow_adult = models.BooleanField(default=False)
    # Когда человек принял правила и политику конфиденциальности. Пусто у тех,
    # кто регистрировался до появления правил, — клиент покажет им экран согласия.
    terms_accepted_at = models.DateTimeField(blank=True, null=True)
    # Выбранная тема оформления: dark | light | neo либо uuid темы из Theme.
    # Хранится на сервере, чтобы выбор переезжал между устройствами; на самом
    # устройстве лежит копия (см. клиент, src/lib/theme.ts).
    active_theme = models.CharField(max_length=64, blank=True, default="")
    # «Мой звук»: с ним приходят пуши о моих сообщениях у собеседников, если у
    # самого сообщения нет аудио-стикера. Из каталога NotificationSound —
    # его caf/канал уже есть на устройствах получателей (syncNotificationSounds).
    notify_sound = models.ForeignKey('NotificationSound', on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    created_at = models.DateTimeField(default=timezone.now)
    # Роль. Права смотрим по ней, а не по флагам Django: is_staff/is_superuser
    # живут на User и открывают админку, а роль — это про поведение самого
    # мессенджера (кто видит системный чат жалоб). Премиум пока заготовка и от
    # обычного пользователя ничем не отличается.
    ROLE_USER = "user"
    ROLE_PREMIUM = "premium"
    ROLE_SUPPORT = "support"
    ROLE_ADMIN = "admin"
    ROLES = [
        (ROLE_USER, "Пользователь"),
        (ROLE_PREMIUM, "Премиум"),
        (ROLE_SUPPORT, "Поддержка"),
        (ROLE_ADMIN, "Администратор"),
    ]
    role = models.CharField(max_length=16, choices=ROLES, default=ROLE_USER, db_index=True)

    @property
    def is_staff_role(self):
        """Видит системные чаты поддержки."""
        return self.role in (self.ROLE_SUPPORT, self.ROLE_ADMIN)

    # Боты — отдельный класс пользователей: не логинятся паролем, ходят в API
    # по bot_token, у каждого есть владелец-создатель.
    is_bot = models.BooleanField(default=False)
    bot_owner = models.ForeignKey('self', on_delete=models.CASCADE, blank=True, null=True, related_name='bots')
    bot_token = models.CharField(max_length=64, blank=True, default="", db_index=True)

    def __str__(self):
        return f"🤖 {self.username}" if self.is_bot else self.username

# Друзья
class Friendship(models.Model):
    STATUS_CHOICES = [
        ("pending", "Pending"),
        ("accepted", "Accepted"),
        ("rejected", "Rejected"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(Profile, related_name="friendships", on_delete=models.CASCADE)
    friend = models.ForeignKey(Profile, related_name="friends_with", on_delete=models.CASCADE)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="pending")
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        unique_together = ("user", "friend")

# Чаты
class Chat(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    participants = models.ManyToManyField(Profile, through='ChatParticipant', related_name="chats")
    # Название есть только у групп; в личной переписке заголовок — имя
    # собеседника, и хранить его незачем.
    name = models.CharField(max_length=100, blank=True, default="")
    is_group = models.BooleanField(default=False)
    # Тип чата: direct (личка) · group (группа) · channel (канал-вещание) ·
    # saved («Избранное» — личный чат без собеседника, один на пользователя).
    # is_group оставлен для обратной совместимости, kind — источник истины.
    kind = models.CharField(max_length=10, default="direct")
    # Аватар группы (URL загруженного файла) и создатель-админ: только он
    # переименовывает группу, меняет аватар и добавляет участников.
    avatar_url = models.TextField(blank=True, null=True)
    creator = models.ForeignKey(Profile, on_delete=models.SET_NULL, blank=True, null=True, related_name="created_chats")
    # Поля канала (для kind=channel):
    username = models.CharField(max_length=32, unique=True, null=True, blank=True)  # публичный @хэндл
    description = models.TextField(blank=True, default="")
    is_public = models.BooleanField(default=True)   # в MVP всегда True (в общем поиске)
    sign_posts = models.BooleanField(default=False)  # показывать автора поста
    subscribers_count = models.IntegerField(default=0)
    default_sound = models.ForeignKey('NotificationSound', on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    # Звук уведомлений канала: с ним подписчики получают пуши о новых постах,
    # если у самого поста нет аудио-стикера (см. _notify_new_message).
    notify_sound = models.ForeignKey('NotificationSound', on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    # Закреплённое сообщение — одно на чат, показывается полосой под шапкой.
    # SET_NULL: удалили сообщение — открепилось само.
    pinned_message = models.ForeignKey('Message', on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

# Участники чата
class ChatParticipant(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    chat = models.ForeignKey(Chat, on_delete=models.CASCADE)
    user = models.ForeignKey(Profile, on_delete=models.CASCADE)
    joined_at = models.DateTimeField(default=timezone.now)
    # Закрепление чата — у каждого своё: список сортируется по времени
    # последнего сообщения, а закреплённые всегда сверху, позже закреплённый
    # выше. Пусто — чат не закреплён.
    pinned_at = models.DateTimeField(blank=True, null=True)
    # Роль: owner · admin · subscriber (каналы) / member (группы, личка).
    # Постить в канал могут только owner/admin.
    role = models.CharField(max_length=12, default="member")
    muted = models.BooleanField(default=False)  # подписчик отключил пуши канала

    class Meta:
        unique_together = ("chat", "user")



# Также добавим поле в модель Message для быстрого доступа
class Message(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    chat = models.ForeignKey(Chat, on_delete=models.CASCADE, related_name="messages")
    sender = models.ForeignKey(Profile, on_delete=models.CASCADE, blank=True, null=True)
    content = models.TextField(blank=True, null=True)
    file_url = models.TextField(blank=True, null=True)
    file_name = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(default=timezone.now)
    file_size = models.BigIntegerField(blank=True, null=True)  # Добавляем это поле
    sticker = models.ForeignKey('Sticker', on_delete=models.SET_NULL, blank=True, null=True, related_name="messages")  # Ссылка на стикер
    # Размеры картинки/видео, снятые ffprobe при загрузке: клиент резервирует
    # место под медиа до загрузки, и лента не «схлопывается».
    file_width = models.IntegerField(blank=True, null=True)
    file_height = models.IntegerField(blank=True, null=True)
    # Альбом: несколько фото/видео, отправленных разом, — отдельные сообщения
    # с общим album_id; клиент склеивает соседние в одну сетку (как в Telegram).
    album_id = models.UUIDField(blank=True, null=True, db_index=True)
    voice_url = models.TextField(blank=True, null=True)  # URL голосового сообщения
    voice_duration = models.IntegerField(blank=True, null=True)  # Длительность в секундах
    # Расшифровка голосового (faster-whisper, см. chat/transcribe.py): текст и
    # состояние — '', 'pending', 'done', 'error'. По требованию, кнопкой в чате.
    voice_transcript = models.TextField(blank=True, null=True)
    transcript_status = models.CharField(max_length=10, blank=True, default='')
    # Видео-сообщение — наш ответ «кружкам»: короткое видео с фронтальной
    # камеры, которое в переписке показывается треугольником.
    video_url = models.TextField(blank=True, null=True)
    video_duration = models.IntegerField(blank=True, null=True)
    sound = models.ForeignKey('NotificationSound', on_delete=models.SET_NULL, blank=True, null=True, related_name="messages")  # Аудио-стикер: звук пуша у получателя
    # Реплай: на какое сообщение отвечаем. SET_NULL — если оригинал удалят,
    # ответ остаётся, просто теряет цитату.
    reply_to = models.ForeignKey('self', on_delete=models.SET_NULL, blank=True, null=True, related_name='replies')
    # Вложение отправлено как «Файл» (без обработки): показывать строкой со
    # скачиванием, а не инлайн-превью — даже если это картинка/видео.
    download_only = models.BooleanField(default=False)
    # Видео-заметка снята фронтальной камерой: воспроизводить зеркально,
    # чтобы совпадало с тем, что автор видел в превью (iOS зеркалит превью).
    video_mirror = models.BooleanField(default=False)
    # Пересылка: от кого пришло сообщение изначально. Заголовок хранится
    # строкой отдельно — у поста канала без подписи автора «от кого» — это
    # сам канал, а профиль там ни при чём.
    forwarded_from = models.ForeignKey(Profile, on_delete=models.SET_NULL, blank=True, null=True, related_name="+")
    forwarded_title = models.CharField(max_length=120, blank=True, default="")
    # Редактирование и удаление.
    is_edited = models.BooleanField(default=False)
    deleted_for_all = models.BooleanField(default=False)  # удалено у всех
    # Момент последнего изменения (текст, удаление у всех). По нему клиент
    # синхронизирует свой кэш: GET /messages/sync/?since=… отдаёт только то,
    # что менялось. auto_now срабатывает на save(); при save(update_fields=…)
    # поле нужно перечислять явно.
    updated_at = models.DateTimeField(auto_now=True, db_index=True)
    deleted_for = models.ManyToManyField(Profile, blank=True, related_name="hidden_messages")  # удалено «у себя»
    
    # Добавляем свойство для удобства
    @property
    def is_read_by_current_user(self):
        # Это свойство будет использоваться в сериализаторе
        # Реальная логика будет в сериализаторе
        return False

# models.py
class MessageReadStatus(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name="read_statuses")
    user = models.ForeignKey(Profile, on_delete=models.CASCADE)
    read_at = models.DateTimeField(default=timezone.now)
    
    class Meta:
        unique_together = ['message', 'user']  # Один статус на сообщение для каждого пользователя


# Добавьте в models.py
class PushToken(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(Profile, on_delete=models.CASCADE, related_name="push_tokens")
    token = models.TextField(unique=True)  # Уникальный токен устройства
    platform = models.CharField(max_length=10, choices=[('ios', 'iOS'), ('android', 'Android'), ('ios_voip', 'iOS VoIP (PushKit)')])
    device_id = models.CharField(max_length=255, blank=True, null=True)
    # Ключ шифрования пушей (32 байта, base64), сгенерирован устройством и
    # хранится у него в Keychain/Keystore. Пуш с текстом уходит через
    # Apple/Google зашифрованным этим ключом (AES-256-GCM), расшифровывает уже
    # само устройство — см. fcm.py. Пусто — старый клиент, пуш открытым текстом.
    secret = models.CharField(max_length=64, blank=True, default="")
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('user', 'device_id')  # Одно устройство на пользователя


class CallSession(models.Model):
    CALL_TYPE_CHOICES = [
        ("audio", "Audio"),
        ("video", "Video"),
    ]

    STATUS_CHOICES = [
        ("initiated", "Initiated"),
        ("ringing", "Ringing"),
        ("active", "Active"),
        ("rejected", "Rejected"),
        ("ended", "Ended"),
        ("missed", "Missed"),
        ("failed", "Failed"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    chat = models.ForeignKey(Chat, on_delete=models.CASCADE, related_name="call_sessions")
    initiator = models.ForeignKey(Profile, on_delete=models.CASCADE, related_name="initiated_call_sessions")
    call_type = models.CharField(max_length=10, choices=CALL_TYPE_CHOICES, default="audio")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="initiated")
    created_at = models.DateTimeField(default=timezone.now)
    started_at = models.DateTimeField(blank=True, null=True)
    ended_at = models.DateTimeField(blank=True, null=True)
    ended_by = models.ForeignKey(
        Profile,
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="ended_call_sessions",
    )


class CallParticipant(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    call = models.ForeignKey(CallSession, on_delete=models.CASCADE, related_name="participants")
    user = models.ForeignKey(Profile, on_delete=models.CASCADE, related_name="call_participations")
    joined_at = models.DateTimeField(blank=True, null=True)
    left_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        unique_together = ("call", "user")



# Стикерпаки
# Каталог звуков уведомлений («аудио-стикеры»). Файлы живут на сервере,
# клиенты докачивают их в рантайме (iOS — в Library/Sounds), поэтому новые
# звуки добавляются через админку без пересборки приложений.
class SoundPack(models.Model):
    """Пак аудио-стикеров: группирует звуки в пикере (как стикерпак)."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=64)
    order = models.IntegerField(default=0)
    created_at = models.DateTimeField(default=timezone.now)
    creator = models.ForeignKey(Profile, on_delete=models.SET_NULL, blank=True, null=True, related_name="created_sound_packs")  # владелец: правит/удаляет через студию
    # Публичный пак открывается по ссылке /sp/<id> любому; приватный — только
    # владельцу.
    is_public = models.BooleanField(default=True)
    # Стандартный пак: есть у всех без подписки. Ставится галочкой в админке;
    # таких паков может быть несколько. Раньше «стандартным» считался пак без
    # владельца — это не давало ни завести несколько наборов, ни снять
    # стандартность у старого, не удаляя его.
    is_default = models.BooleanField(default=False, db_index=True)
    # Пак 18+: виден только тем, кто включил «Показывать 18+» (Profile.allow_adult).
    # Ставит автор в студии или модератор в админке.
    is_adult = models.BooleanField(default=False, db_index=True)
    # Обложка пака (URL загруженного файла). Пусто — клиент рисует свою
    # картинку по теме оформления (см. src/assets/pack-cover-*).
    cover_url = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["order", "name"]

    def __str__(self):
        return self.name

    @property
    def is_base(self):
        return self.is_default


class NotificationSound(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    slug = models.SlugField(max_length=40, unique=True)  # имя файла: <slug>.caf
    name = models.CharField(max_length=64)
    pack = models.ForeignKey(SoundPack, on_delete=models.SET_NULL, blank=True, null=True, related_name="sounds")
    file = models.FileField(upload_to="sounds/")  # исходник (mp3/wav), играет в приложении
    caf_url = models.TextField(blank=True, default="")  # авто-конверсия для APNs
    is_active = models.BooleanField(default=True)
    order = models.IntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["order", "slug"]

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        self._ensure_caf()

    def _ensure_caf(self):
        """APNs принимает только caf/wav/aiff из бандла или Library/Sounds —
        конвертируем исходник ffmpeg-ом. -t 29: дольше 30 с iOS молча
        подменяет звук системным. Без ffmpeg каталог живёт, пуши откатываются
        на стандартный звук."""
        import logging
        import subprocess
        from pathlib import Path

        from django.conf import settings

        if not self.file:
            return
        src = Path(self.file.path)
        dst = src.parent / f"{self.slug}.caf"
        if dst.exists() and dst.stat().st_mtime >= src.stat().st_mtime:
            return
        try:
            subprocess.run(
                ["ffmpeg", "-y", "-i", str(src), "-t", "29",
                 "-ar", "44100", "-ac", "1", "-c:a", "pcm_s16le", str(dst)],
                check=True, capture_output=True, timeout=60,
            )
            caf_url = f"{settings.MEDIA_URL}sounds/{self.slug}.caf"
            if self.caf_url != caf_url:
                NotificationSound.objects.filter(pk=self.pk).update(caf_url=caf_url)
                self.caf_url = caf_url
        except Exception:
            logging.getLogger(__name__).exception(
                "Конвертация звука %s в caf не удалась", self.slug
            )


class StickerPack(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True, null=True)
    author = models.ForeignKey(Profile, on_delete=models.CASCADE, related_name="created_sticker_packs")
    is_public = models.BooleanField(default=True)  # Публичный или приватный стикерпак
    # Пак 18+ — см. SoundPack.is_adult.
    is_adult = models.BooleanField(default=False, db_index=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)
    
    def __str__(self):
        return self.name


# Стикеры
class Sticker(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    pack = models.ForeignKey(StickerPack, on_delete=models.CASCADE, related_name="stickers")
    file_url = models.TextField()  # URL файла стикера
    file_name = models.CharField(max_length=255)
    emoji = models.CharField(max_length=10, blank=True, null=True)  # Эмодзи-ассоциация
    order = models.IntegerField(default=0)  # Порядок в паке
    created_at = models.DateTimeField(default=timezone.now)
    
    class Meta:
        ordering = ['order', 'created_at']
    
    def __str__(self):
        return f"{self.pack.name} - {self.file_name}"


# Сохраненные стикерпаки пользователя
class UserStickerPack(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(Profile, on_delete=models.CASCADE, related_name="saved_sticker_packs")
    pack = models.ForeignKey(StickerPack, on_delete=models.CASCADE, related_name="saved_by_users")
    added_at = models.DateTimeField(default=timezone.now)
    
    class Meta:
        unique_together = ('user', 'pack')
        ordering = ['added_at']
    
    def __str__(self):
        return f"{self.user.username} - {self.pack.name}"


class CallSession(models.Model):
    CALL_TYPE_CHOICES = [
        ("audio", "Audio"),
        ("video", "Video"),
    ]

    STATUS_CHOICES = [
        ("initiated", "Initiated"),
        ("ringing", "Ringing"),
        ("active", "Active"),
        ("rejected", "Rejected"),
        ("ended", "Ended"),
        ("missed", "Missed"),
        ("failed", "Failed"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    chat = models.ForeignKey(Chat, on_delete=models.CASCADE, related_name="call_sessions")
    initiator = models.ForeignKey(Profile, on_delete=models.CASCADE, related_name="initiated_call_sessions")
    call_type = models.CharField(max_length=10, choices=CALL_TYPE_CHOICES, default="audio")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="initiated")
    created_at = models.DateTimeField(default=timezone.now)
    started_at = models.DateTimeField(blank=True, null=True)
    ended_at = models.DateTimeField(blank=True, null=True)
    ended_by = models.ForeignKey(
        Profile,
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="ended_call_sessions",
    )


class CallParticipant(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    call = models.ForeignKey(CallSession, on_delete=models.CASCADE, related_name="participants")
    user = models.ForeignKey(Profile, on_delete=models.CASCADE, related_name="call_participations")
    joined_at = models.DateTimeField(blank=True, null=True)
    left_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        unique_together = ("call", "user")


class PostReaction(models.Model):
    """Реакция на пост канала. Одна активная реакция на пользователя
    (unique post+user). kind обобщён: сейчас emoji, потом custom (реакции из
    Creative Space) — value хранит символ или id ассета."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    post = models.ForeignKey('Message', on_delete=models.CASCADE, related_name="reactions")
    user = models.ForeignKey('Profile', on_delete=models.CASCADE, related_name="post_reactions")
    kind = models.CharField(max_length=10, default="emoji")
    value = models.CharField(max_length=64)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        unique_together = ("post", "user")


class PostComment(models.Model):
    """Комментарий к посту канала — прямо на посте (без отдельной группы).
    parent — ответ на другой комментарий (одноуровневые ветки)."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    post = models.ForeignKey('Message', on_delete=models.CASCADE, related_name="comments")
    author = models.ForeignKey('Profile', on_delete=models.CASCADE, related_name="post_comments")
    parent = models.ForeignKey('self', on_delete=models.CASCADE, null=True, blank=True, related_name="replies")
    content = models.TextField()
    deleted = models.BooleanField(default=False)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["created_at"]


class PostView(models.Model):
    """Уникальный просмотр поста (unique post+user). Гость публичного канала
    тоже считается."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    post = models.ForeignKey('Message', on_delete=models.CASCADE, related_name="views")
    user = models.ForeignKey('Profile', on_delete=models.CASCADE, related_name="post_views")
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        unique_together = ("post", "user")


class SavedImage(models.Model):
    """«Сохранёнки»: картинки из переписки, которые пользователь сохранил себе.
    Видны в профиле (и другим тоже, как в референсе), удалять может только
    владелец. Храним ссылку на файл, а не на сообщение: удаление сообщения
    сохранёнку не трогает."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(Profile, on_delete=models.CASCADE, related_name="saved_images")
    file_url = models.TextField()
    file_name = models.TextField(blank=True, default="")
    source_message = models.ForeignKey(Message, on_delete=models.SET_NULL, blank=True, null=True, related_name="+")
    created_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [models.UniqueConstraint(fields=["owner", "file_url"], name="uniq_saved_image_per_owner")]


class MusicTrack(models.Model):
    """Музыка в Creative Space: общая библиотека, каждый загружает своё,
    удалить может только владелец. Длительность считает ffprobe при загрузке."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(Profile, on_delete=models.CASCADE, related_name="music_tracks")
    title = models.CharField(max_length=120)
    artist = models.CharField(max_length=120, blank=True, default="")
    file = models.FileField(upload_to="music/")
    duration = models.IntegerField(default=0)  # секунды
    created_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.artist} — {self.title}" if self.artist else self.title


class Block(models.Model):
    """Чёрный список: blocker больше не получает ничего от blocked.

    Требование App Store 1.2 для приложений с пользовательским контентом —
    возможность заблокировать того, кто злоупотребляет. Блокировка
    односторонняя и невидимая для заблокированного: он по-прежнему может
    писать, но до адресата это не доходит (см. фильтры в views).
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    blocker = models.ForeignKey(Profile, on_delete=models.CASCADE, related_name="blocks")
    blocked = models.ForeignKey(Profile, on_delete=models.CASCADE, related_name="blocked_by")
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        unique_together = ("blocker", "blocked")
        # Имя задано явно, чтобы совпадать с 0036: без него Django генерирует своё.
        indexes = [models.Index(fields=["blocker", "blocked"], name="chat_block_blocker_idx")]

    def __str__(self):
        return f"{self.blocker} ⛔ {self.blocked}"


class Report(models.Model):
    """Жалоба на контент или пользователя.

    Хранит СНИМОК того, на что жаловались: автор может удалить сообщение или
    переименовать пак сразу после жалобы, и без снимка модератору осталось бы
    пустое место. Снимок — обычный текст, чтобы не зависеть от того, жива ли
    исходная запись.
    """
    TARGETS = [
        ("user", "Пользователь"),
        ("message", "Сообщение"),
        ("chat", "Чат или канал"),
        ("sound_pack", "Пак звуков"),
        ("sticker_pack", "Пак стикеров"),
        ("theme", "Тема оформления"),
    ]
    REASONS = [
        ("sexual", "Сексуальный контент"),
        ("violence", "Насилие или угрозы"),
        ("abuse", "Оскорбления, травля"),
        ("spam", "Спам или мошенничество"),
        ("illegal", "Противозаконное"),
        ("other", "Другое"),
    ]
    STATUSES = [
        ("new", "Новая"),
        ("reviewed", "Рассмотрена"),
        ("actioned", "Приняты меры"),
        ("rejected", "Отклонена"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    reporter = models.ForeignKey(Profile, on_delete=models.SET_NULL, null=True, related_name="reports_sent")
    target_type = models.CharField(max_length=16, choices=TARGETS)
    target_id = models.CharField(max_length=64)
    # На кого жалуются, если это удалось определить: автор сообщения, владелец
    # пака. Нужно, чтобы модератор видел повторные жалобы на одного человека.
    target_profile = models.ForeignKey(Profile, on_delete=models.SET_NULL, null=True, blank=True, related_name="reports_received")
    reason = models.CharField(max_length=16, choices=REASONS)
    comment = models.TextField(blank=True, default="")
    snapshot = models.TextField(blank=True, default="")
    status = models.CharField(max_length=16, choices=STATUSES, default="new", db_index=True)
    created_at = models.DateTimeField(default=timezone.now, db_index=True)
    handled_at = models.DateTimeField(null=True, blank=True)
    moderator_note = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.get_target_type_display()} · {self.get_reason_display()} · {self.status}"


class BugReport(models.Model):
    """Сообщение о проблеме от пользователя: описание, скриншот и лог
    приложения за текущую сессию (см. sux-chat-app/src/lib/applog.ts).

    Лог — текст без переписки и токенов, это гарантирует клиент. Хранится как
    файл, а не в поле: типичный лог — сотни строк, в списке админки ему не
    место, а модератор открывает его по ссылке.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    reporter = models.ForeignKey(Profile, on_delete=models.SET_NULL, null=True, related_name="bug_reports")
    description = models.TextField(blank=True, default="")
    screenshot_url = models.TextField(blank=True, default="")
    log_url = models.TextField(blank=True, default="")
    # Откуда пришло: версия, сборка, платформа, устройство — то, что клиент
    # знает о себе. JSON, потому что набор полей у платформ разный.
    meta = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=16, choices=[("new", "Новый"), ("seen", "Просмотрен"), ("fixed", "Исправлен"), ("wontfix", "Не будем")], default="new", db_index=True)
    created_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.created_at:%d.%m %H:%M} · {self.reporter} · {self.status}"


class UserSoundPack(models.Model):
    """Подписка на пак звуков — как UserStickerPack у стикеров.

    Раньше /api/sounds/ отдавал все активные звуки всем: чужой пак попадал в
    пикер каждому сразу после загрузки. Теперь человек видит базовые паки, свои
    и те, что добавил сам по ссылке.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(Profile, on_delete=models.CASCADE, related_name="added_sound_packs")
    pack = models.ForeignKey(SoundPack, on_delete=models.CASCADE, related_name="added_by_users")
    added_at = models.DateTimeField(default=timezone.now)

    class Meta:
        unique_together = ("user", "pack")
        ordering = ["added_at"]


class Theme(models.Model):
    """Тема оформления, сделанная пользователем. data — объект по схеме
    chat/themes.py (цвета hex и параметры формы); произвольного CSS в теме нет.
    Делятся ссылкой /t/<id>, как паками."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=40)
    # SET_NULL: удалил аккаунт — тема остаётся у тех, кто её установил.
    author = models.ForeignKey(Profile, on_delete=models.SET_NULL, blank=True, null=True, related_name="themes")
    data = models.JSONField()
    # Приватная тема по ссылке не открывается; автору видна всегда.
    is_public = models.BooleanField(default=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self):
        return self.name


class UserTheme(models.Model):
    """Установленная тема — как UserStickerPack у стикеров."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(Profile, on_delete=models.CASCADE, related_name="installed_themes")
    theme = models.ForeignKey(Theme, on_delete=models.CASCADE, related_name="installed_by")
    added_at = models.DateTimeField(default=timezone.now)

    class Meta:
        unique_together = ("user", "theme")
        ordering = ["added_at"]
