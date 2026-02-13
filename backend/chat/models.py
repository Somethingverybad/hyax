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
    status = models.CharField(max_length=20, default="online")  # Статус онлайн/оффлайн
    bio = models.TextField(blank=True, null=True, max_length=500)  # Пользовательский статус/описание
    created_at = models.DateTimeField(default=timezone.now)

    def __str__(self):
        return self.username

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
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

# Участники чата
class ChatParticipant(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    chat = models.ForeignKey(Chat, on_delete=models.CASCADE)
    user = models.ForeignKey(Profile, on_delete=models.CASCADE)
    joined_at = models.DateTimeField(default=timezone.now)

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
    voice_url = models.TextField(blank=True, null=True)  # URL голосового сообщения
    voice_duration = models.IntegerField(blank=True, null=True)  # Длительность в секундах
    
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
    platform = models.CharField(max_length=10, choices=[('ios', 'iOS'), ('android', 'Android')])
    device_id = models.CharField(max_length=255, blank=True, null=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('user', 'device_id')  # Одно устройство на пользователя


# Стикерпаки
class StickerPack(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True, null=True)
    author = models.ForeignKey(Profile, on_delete=models.CASCADE, related_name="created_sticker_packs")
    is_public = models.BooleanField(default=True)  # Публичный или приватный стикерпак
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