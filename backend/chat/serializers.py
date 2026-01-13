from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from .models import *

class ProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = Profile
        fields = ['id', 'username', 'avatar_url', 'status', 'created_at']

class FriendshipSerializer(serializers.ModelSerializer):
    class Meta:
        model = Friendship
        fields = ['id', 'user', 'friend', 'status', 'created_at']

class ChatSerializer(serializers.ModelSerializer):
    class Meta:
        model = Chat
        fields = ['id', 'created_at', 'updated_at']

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
class MessageSerializer(serializers.ModelSerializer):
    sender = ProfileSerializer(read_only=True)
    is_read = serializers.SerializerMethodField()
    read_by = serializers.SerializerMethodField()
    
    class Meta:
        model = Message
        fields = ['id', 'chat', 'sender', 'content', 'file_url', 'file_name', 'created_at', 'is_read', 'read_by']
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
# В Django User создается с username=email (см. register_user в views.py)
# Поэтому для логина нужно использовать email как username
import logging
logger = logging.getLogger(__name__)

class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    def validate(self, attrs):
        logger.info(f"[JWT] Получены данные для аутентификации: {list(attrs.keys())}")
        
        # Если пришло поле 'email', используем его как 'username'
        # так как в Django User.username = email
        if 'email' in attrs and 'username' not in attrs:
            attrs['username'] = attrs.pop('email')
            logger.info(f"[JWT] Преобразовано email -> username")
        
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