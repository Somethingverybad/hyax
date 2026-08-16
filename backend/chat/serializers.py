from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from .models import *

class ProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = Profile
        fields = ['id', 'username', 'avatar_url', 'status', 'call_status', 'bio', 'created_at']
        # username редактируем: это отображаемое имя (никнейм), логин остаётся
        # в User.username и не меняется. Уникальность проверяет DRF по unique
        # на поле модели.
        read_only_fields = ['id', 'created_at']

    def validate_username(self, value):
        value = (value or "").strip()
        if len(value) < 2:
            raise serializers.ValidationError("Никнейм короче 2 символов")
        if len(value) > 50:
            raise serializers.ValidationError("Никнейм длиннее 50 символов")
        return value

class FriendshipSerializer(serializers.ModelSerializer):
    class Meta:
        model = Friendship
        fields = ['id', 'user', 'friend', 'status', 'created_at']

class ChatSerializer(serializers.ModelSerializer):
    # Участники отдаются вместе со списком чатов. Раньше клиент запрашивал их
    # отдельно на каждый чат: на экран из десяти чатов уходило одиннадцать
    # запросов, и до их ответа вместо имени показывался идентификатор.
    participants = ProfileSerializer(many=True, read_only=True)

    class Meta:
        model = Chat
        fields = ['id', 'created_at', 'updated_at', 'participants']

class ChatParticipantSerializer(serializers.ModelSerializer):
    class Meta:
        model = ChatParticipant
        fields = ['id', 'chat', 'user', 'joined_at']

# Добавляем новый сериализатор для статусов прочтения
class MessageReadStatusSerializer(serializers.ModelSerializer):
    user = ProfileSerializer(read_only=True)
    
    class Meta:
        model = MessageReadStatus
        fields = ['id', 'user', 'read_at']

# Обновляем MessageSerializer
class StickerPackSerializer(serializers.ModelSerializer):
    author = ProfileSerializer(read_only=True)
    stickers_count = serializers.SerializerMethodField()
    is_saved = serializers.SerializerMethodField()
    
    class Meta:
        model = StickerPack
        fields = ['id', 'name', 'description', 'author', 'is_public', 'created_at', 'updated_at', 'stickers_count', 'is_saved']
        read_only_fields = ['author', 'created_at', 'updated_at']
    
    def get_stickers_count(self, obj):
        return obj.stickers.count()
    
    def get_is_saved(self, obj):
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            try:
                profile = request.user.profile
                return UserStickerPack.objects.filter(user=profile, pack=obj).exists()
            except Profile.DoesNotExist:
                return False
        return False


class StickerSerializer(serializers.ModelSerializer):
    pack_name = serializers.CharField(source='pack.name', read_only=True)
    
    class Meta:
        model = Sticker
        fields = ['id', 'pack', 'pack_name', 'file_url', 'file_name', 'emoji', 'order', 'created_at']
        read_only_fields = ['created_at']


class UserStickerPackSerializer(serializers.ModelSerializer):
    pack = StickerPackSerializer(read_only=True)
    
    class Meta:
        model = UserStickerPack
        fields = ['id', 'pack', 'added_at']
        read_only_fields = ['added_at']


class MessageSerializer(serializers.ModelSerializer):
    sender = ProfileSerializer(read_only=True)
    is_read = serializers.SerializerMethodField()
    read_by = serializers.SerializerMethodField()
    sticker = StickerSerializer(read_only=True)
    
    class Meta:
        model = Message
        fields = ['id', 'chat', 'sender', 'content', 'file_url', 'file_name', 'created_at', 'is_read', 'read_by', 'sticker', 'voice_url', 'voice_duration']
        read_only_fields = ['sender', 'created_at', 'file_size']
    
    def to_representation(self, instance):
        """Переопределяем для правильной сериализации UUID в строки"""
        data = super().to_representation(instance)
        # Преобразуем UUID в строки для JSON сериализации
        # DRF обычно делает это автоматически, но на всякий случай явно преобразуем
        if 'chat' in data and data['chat']:
            data['chat'] = str(data['chat'])
        if 'id' in data and data['id']:
            data['id'] = str(data['id'])
        return data
    
    def get_is_read(self, obj):
        """Проверяет, прочитано ли сообщение текущим пользователем"""
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            try:
                profile = request.user.profile
                return obj.read_statuses.filter(user=profile).exists()
            except Profile.DoesNotExist:
                return False
        return False
    
    def get_read_by(self, obj):
        """Возвращает список пользователей, прочитавших сообщение"""
        read_statuses = obj.read_statuses.select_related('user').all()[:10]  # Ограничиваем для производительности
        return MessageReadStatusSerializer(read_statuses, many=True).data


# Кастомный сериализатор для JWT токенов
# Теперь используется только username для аутентификации
import logging
logger = logging.getLogger(__name__)

class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    def validate(self, attrs):
        username = attrs.get('username')
        logger.info(f"[JWT] Попытка аутентификации с username: {username}")
        
        try:
            # Вызываем родительский validate, который использует username для аутентификации
            data = super().validate(attrs)
            logger.info(f"[JWT] Аутентификация успешна для username: {username}")
            return data
        except Exception as e:
            logger.error(f"[JWT] Ошибка аутентификации для username {username}: {str(e)}")
            raise