import json
import uuid
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.contrib.auth.models import AnonymousUser
from rest_framework.authtoken.models import Token
from rest_framework_simplejwt.tokens import UntypedToken
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from jwt import decode as jwt_decode
from django.conf import settings
from .models import Message, Chat, Profile, ChatParticipant
from .serializers import MessageSerializer
from django.contrib.auth import get_user_model

User = get_user_model()


class ChatConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.chat_id = self.scope['url_route']['kwargs']['chat_id']
        self.chat_group_name = f'chat_{self.chat_id}'
        self.user = self.scope.get('user', AnonymousUser())

        # Проверка аутентификации через JWT токен
        if isinstance(self.user, AnonymousUser):
            # Попытка аутентификации через JWT токен в query параметрах
            query_string = self.scope.get('query_string', b'').decode()
            token_key = None
            
            # Пытаемся получить токен из query параметров
            if 'token=' in query_string:
                token_key = query_string.split('token=')[-1].split('&')[0]
            elif 'access_token=' in query_string:
                token_key = query_string.split('access_token=')[-1].split('&')[0]
            
            if token_key:
                try:
                    # Валидация JWT токена
                    UntypedToken(token_key)
                    # Декодируем токен без проверки подписи (UntypedToken уже проверил)
                    decoded_data = jwt_decode(token_key, options={"verify_signature": False})
                    user_id = decoded_data.get('user_id')
                    if user_id:
                        self.user = await database_sync_to_async(User.objects.get)(id=user_id)
                except (Token.DoesNotExist, InvalidToken, TokenError, User.DoesNotExist):
                    await self.close()
                    return

        # Проверка аутентификации асинхронно
        is_authenticated = await self.check_user_authenticated(self.user)
        if not is_authenticated:
            await self.close()
            return

        # Проверка доступа к чату
        has_access = await self.check_chat_access(self.chat_id, self.user)
        if not has_access:
            await self.close()
            return

        # Присоединение к группе
        await self.channel_layer.group_add(
            self.chat_group_name,
            self.channel_name
        )

        await self.accept()

    async def disconnect(self, close_code):
        # Отключение от группы
        await self.channel_layer.group_discard(
            self.chat_group_name,
            self.channel_name
        )

    async def receive(self, text_data):
        try:
            text_data_json = json.loads(text_data)
            message_type = text_data_json.get('type')

            if message_type == 'ping':
                # Отправка pong для поддержания соединения
                await self.send(text_data=json.dumps({
                    'type': 'pong'
                }))
        except json.JSONDecodeError:
            pass

    # Получение сообщения из группы
    async def chat_message(self, event):
        # Преобразуем UUID в строки перед сериализацией
        def convert_uuid_to_str(obj):
            """Рекурсивно преобразует UUID в строки"""
            if isinstance(obj, uuid.UUID):
                return str(obj)
            elif isinstance(obj, dict):
                return {k: convert_uuid_to_str(v) for k, v in obj.items()}
            elif isinstance(obj, list):
                return [convert_uuid_to_str(item) for item in obj]
            elif isinstance(obj, tuple):
                return tuple(convert_uuid_to_str(item) for item in obj)
            else:
                return obj
        
        try:
            message = convert_uuid_to_str(event.get('message', {}))
            await self.send(text_data=json.dumps({
                'type': 'new_message',
                'message': message
            }))
        except Exception as e:
            print(f"Error sending chat message: {e}")
            # Если ошибка при отправке, просто пропускаем

    @database_sync_to_async
    def check_user_authenticated(self, user):
        """Проверка аутентификации пользователя"""
        return user.is_authenticated
    
    @database_sync_to_async
    def check_chat_access(self, chat_id, user):
        """Проверка доступа пользователя к чату"""
        try:
            profile = user.profile
            chat = Chat.objects.get(id=chat_id)
            return ChatParticipant.objects.filter(chat=chat, user=profile).exists()
        except (Profile.DoesNotExist, Chat.DoesNotExist):
            return False


class UserConsumer(AsyncWebsocketConsumer):
    """Consumer для отправки уведомлений конкретному пользователю"""
    async def connect(self):
        self.user_id = self.scope['url_route']['kwargs']['user_id']
        self.user_group_name = f'user_{self.user_id}'
        self.user = self.scope.get('user', AnonymousUser())

        # Проверка аутентификации через JWT токен
        if isinstance(self.user, AnonymousUser):
            query_string = self.scope.get('query_string', b'').decode()
            token_key = None
            
            if 'token=' in query_string:
                token_key = query_string.split('token=')[-1].split('&')[0]
            elif 'access_token=' in query_string:
                token_key = query_string.split('access_token=')[-1].split('&')[0]
            
            if token_key:
                try:
                    UntypedToken(token_key)
                    # Декодируем токен без проверки подписи (UntypedToken уже проверил)
                    decoded_data = jwt_decode(token_key, options={"verify_signature": False})
                    user_id = decoded_data.get('user_id')
                    if user_id:
                        self.user = await database_sync_to_async(User.objects.get)(id=user_id)
                except (Token.DoesNotExist, InvalidToken, TokenError, User.DoesNotExist):
                    await self.close()
                    return

        # Проверка аутентификации асинхронно
        is_authenticated = await self.check_user_authenticated(self.user)
        if not is_authenticated:
            await self.close()
            return

        # Проверка, что user_id из токена совпадает с user_id из URL
        # Получаем profile асинхронно
        profile = await self.get_user_profile(self.user)
        if not profile:
            await self.close()
            return
        
        # Проверяем соответствие user_id (профиля) и user_id из URL
        profile_id_str = await self.get_profile_id_string(profile)
        if profile_id_str != self.user_id:
            await self.close()
            return

        # Присоединение к группе
        await self.channel_layer.group_add(
            self.user_group_name,
            self.channel_name
        )

        await self.accept()

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(
            self.user_group_name,
            self.channel_name
        )

    async def receive(self, text_data):
        try:
            text_data_json = json.loads(text_data)
            message_type = text_data_json.get('type')

            if message_type == 'ping':
                await self.send(text_data=json.dumps({
                    'type': 'pong'
                }))
        except json.JSONDecodeError:
            pass

    # Получение уведомления из группы
    async def notification(self, event):
        # Преобразуем UUID в строки перед сериализацией
        def convert_uuid_to_str(obj):
            """Рекурсивно преобразует UUID в строки"""
            if isinstance(obj, uuid.UUID):
                return str(obj)
            elif isinstance(obj, dict):
                return {k: convert_uuid_to_str(v) for k, v in obj.items()}
            elif isinstance(obj, list):
                return [convert_uuid_to_str(item) for item in obj]
            elif isinstance(obj, tuple):
                return tuple(convert_uuid_to_str(item) for item in obj)
            else:
                return obj
        
        try:
            data = convert_uuid_to_str(event.get('data', {}))
            await self.send(text_data=json.dumps({
                'type': 'notification',
                'data': data
            }))
        except Exception as e:
            print(f"Error sending notification: {e}")
            # Если ошибка при отправке, просто пропускаем

    @database_sync_to_async
    def check_user_authenticated(self, user):
        """Проверка аутентификации пользователя"""
        return user.is_authenticated
    
    @database_sync_to_async
    def get_user_profile(self, user):
        """Получение профиля пользователя"""
        try:
            return user.profile
        except Profile.DoesNotExist:
            return None
    
    @database_sync_to_async
    def get_profile_id_string(self, profile):
        """Получение ID профиля в виде строки"""
        return str(profile.id)
