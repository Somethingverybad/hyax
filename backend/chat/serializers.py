from rest_framework import serializers
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