import uuid
import json
import time
from django.db import models
from django.http import StreamingHttpResponse
from django.views.decorators.http import condition
from django.views.decorators.cache import never_cache

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from django.contrib.auth.models import User
from django.contrib.auth import authenticate, login
from .models import *
from .serializers import *
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync
from rest_framework_simplejwt.tokens import UntypedToken
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from jwt import decode as jwt_decode


# В views.py
class ProfileViewSet(viewsets.ModelViewSet):
    queryset = Profile.objects.all()
    serializer_class = ProfileSerializer
    permission_classes = [permissions.AllowAny]  # временно

    def get_queryset(self):
        queryset = Profile.objects.all()
        search_query = self.request.query_params.get('search', None)
        
        if search_query:
            queryset = queryset.filter(username__icontains=search_query)
        
        return queryset

class FriendshipViewSet(viewsets.ModelViewSet):
    queryset = Friendship.objects.all()
    serializer_class = FriendshipSerializer

class ChatViewSet(viewsets.ModelViewSet):
    serializer_class = ChatSerializer
    queryset = Chat.objects.all()
    permission_classes = [permissions.IsAuthenticated]  # ← ИЗМЕНИТЬ НА ЭТО

    def get_queryset(self):
        """Возвращаем только чаты текущего пользователя"""
        try:
            profile = self.request.user.profile
            return Chat.objects.filter(participants=profile)
        except Profile.DoesNotExist:
            return Chat.objects.none()

    @action(detail=True, methods=['post'])
    def leave(self, request, pk=None):
        """Выйти из чата"""
        chat = self.get_object()
        try:
            profile = request.user.profile
            # Удаляем пользователя из участников чата
            chat.participants.remove(profile)
            return Response({'detail': 'Successfully left the chat'})
        except Profile.DoesNotExist:
            return Response(
                {'detail': 'Profile not found'}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        
    @action(detail=True, methods=['get'])
    def participants(self, request, pk=None):
        """Получить участников конкретного чата"""
        chat = self.get_object()
        participants = chat.participants.all()
        serializer = ProfileSerializer(participants, many=True)
        return Response(serializer.data)

    def create(self, request):
        # Добавьте проверку аутентификации в начале метода
        if not request.user.is_authenticated:
            return Response(
                {'detail': 'Authentication required'}, 
                status=status.HTTP_401_UNAUTHORIZED
            )
            
        print("=== CHAT CREATE REQUEST ===")
        print("Request data:", request.data)
        
        participant_ids = request.data.get('participants', [])
        print("Raw participant_ids:", participant_ids, type(participant_ids))
        
        # Обрабатываем разные форматы participants
        if isinstance(participant_ids, str):
            # Если это строка с одним UUID (для директ-чата)
            try:
                # Пробуем распарсить как JSON массив
                import json
                participant_ids = json.loads(participant_ids)
                print("Parsed as JSON array:", participant_ids)
            except json.JSONDecodeError:
                # Если не JSON, то это может быть одиночный UUID
                try:
                    uuid.UUID(participant_ids)
                    # Это валидный UUID - создаем массив с текущим пользователем и этим UUID
                    participant_ids = [participant_ids]
                    print("Treated as single UUID:", participant_ids)
                except ValueError:
                    print("Invalid UUID format")
                    return Response(
                        {'detail': 'Invalid participant format'},
                        status=status.HTTP_400_BAD_REQUEST
                    )
        
        # Если это не список, преобразуем в список
        if not isinstance(participant_ids, list):
            participant_ids = [participant_ids]
            print("Converted to list:", participant_ids)
        
        print("Final participant_ids:", participant_ids)
        
        # Преобразуем ID в UUID объекты
        try:
            participant_uuids = [uuid.UUID(str(pid).strip()) for pid in participant_ids]
            print("Converted UUIDs:", participant_uuids)
        except (ValueError, TypeError) as e:
            print("UUID conversion error:", str(e))
            return Response(
                {'detail': f'Invalid UUID format: {str(e)}'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Для директ-чатов нужно добавить текущего пользователя
        if len(participant_uuids) == 1:
            try:
                # Получаем текущего пользователя из сессии
                current_user_profile = Profile.objects.get(user=request.user)
                participant_uuids.append(current_user_profile.id)
                print("Added current user to participants:", participant_uuids)
            except Profile.DoesNotExist:
                return Response(
                    {'detail': 'Current user profile not found'},
                    status=status.HTTP_400_BAD_REQUEST
                )
        
        # Проверяем, что все участники существуют
        existing_profiles = Profile.objects.filter(id__in=participant_uuids)
        found_ids = [str(profile.id) for profile in existing_profiles]
        print("Found profiles:", found_ids)
        print("Expected profiles:", [str(pid) for pid in participant_uuids])
        
        if len(existing_profiles) != len(participant_uuids):
            missing_ids = set(str(pid) for pid in participant_uuids) - set(found_ids)
            print("Missing profiles:", missing_ids)
            return Response(
                {'detail': f'One or more participants not found: {missing_ids}'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Ищем существующие чаты с точно такими же участниками
        existing_chats = Chat.objects.annotate(
            participant_count=models.Count('participants'),
            matching_participants=models.Count(
                'participants',
                filter=models.Q(participants__id__in=participant_uuids)
            )
        ).filter(
            participant_count=len(participant_uuids),
            matching_participants=len(participant_uuids)
        ).distinct()
        
        print("Existing chats found:", existing_chats.count())
        
        if existing_chats.exists():
            existing_chat = existing_chats.first()
            print("Chat already exists with ID:", existing_chat.id)
            return Response(
                {
                    'detail': 'Chat already exists', 
                    'chat_id': str(existing_chat.id)
                },
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Создаем новый чат
        chat = Chat.objects.create()
        chat.participants.set(existing_profiles)
        print("New chat created with ID:", chat.id)
        
        serializer = self.get_serializer(chat)
        print("Serialized data:", serializer.data)
        print("=== CHAT CREATE COMPLETE ===")
        
        return Response(serializer.data, status=status.HTTP_201_CREATED)
        
class ChatParticipantViewSet(viewsets.ModelViewSet):
    queryset = ChatParticipant.objects.all()
    serializer_class = ChatParticipantSerializer

# views.py
from rest_framework.decorators import action
from rest_framework.response import Response
from django.db.models import Q
from django.utils import timezone
from .models import MessageReadStatus

class MessageViewSet(viewsets.ModelViewSet):
    serializer_class = MessageSerializer
    queryset = Message.objects.all()
    
    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['request'] = self.request
        return context
    
    def get_queryset(self):
        queryset = Message.objects.select_related('sender').prefetch_related('read_statuses__user')
        chat_id = self.request.query_params.get('chat')
        if chat_id:
            queryset = queryset.filter(chat_id=chat_id)
        return queryset.order_by('created_at')

    def perform_create(self, serializer):
        print("USER:", self.request.user)
        print("IS AUTHENTICATED:", self.request.user.is_authenticated)

        if not self.request.user.is_authenticated:
            raise PermissionError("User not authenticated")

        try:
            profile = self.request.user.profile
        except Profile.DoesNotExist:
            raise ValidationError("Profile not found for this user")

        serializer.save(sender=profile)

    def list(self, request, *args, **kwargs):
        print("=== MESSAGE LIST REQUEST ===")
        print("Query params:", request.query_params)
        response = super().list(request, *args, **kwargs)
        print("Response data:", response.data)
        return response

    # Добавляем кастомные эндпоинты для работы с метками прочтения
    @action(detail=True, methods=['post'])
    def mark_as_read(self, request, pk=None):
        """Отметить сообщение как прочитанное"""
        message = self.get_object()
        
        if not request.user.is_authenticated:
            return Response({"error": "User not authenticated"}, status=401)
        
        try:
            profile = request.user.profile
        except Profile.DoesNotExist:
            return Response({"error": "Profile not found"}, status=400)
        
        # Создаем или обновляем статус прочтения
        read_status, created = MessageReadStatus.objects.get_or_create(
            message=message,
            user=profile,
            defaults={'read_at': timezone.now()}
        )
        
        if not created:
            read_status.read_at = timezone.now()
            read_status.save()
        
        return Response({
            "status": "success", 
            "message": "Message marked as read",
            "read_at": read_status.read_at
        })
    
    @action(detail=False, methods=['post'])
    def mark_chat_as_read(self, request):
        """Отметить все сообщения в чате как прочитанные"""
        chat_id = request.data.get('chat_id')
        if not chat_id:
            return Response({"error": "chat_id is required"}, status=400)
        
        if not request.user.is_authenticated:
            return Response({"error": "User not authenticated"}, status=401)
        
        try:
            profile = request.user.profile
        except Profile.DoesNotExist:
            return Response({"error": "Profile not found"}, status=400)
        
        # Находим все непрочитанные сообщения в чате (кроме своих)
        unread_messages = Message.objects.filter(
            chat_id=chat_id
        ).exclude(
            Q(read_statuses__user=profile) | Q(sender=profile)
        )
        
        # Создаем статусы прочтения для всех непрочитанных сообщений
        read_statuses = []
        current_time = timezone.now()
        for message in unread_messages:
            read_statuses.append(
                MessageReadStatus(
                    message=message,
                    user=profile,
                    read_at=current_time
                )
            )
        
        if read_statuses:
            # Используем bulk_create для эффективности
            MessageReadStatus.objects.bulk_create(read_statuses, ignore_conflicts=True)
        
        return Response({
            "status": "success",
            "message": f"Marked {len(read_statuses)} messages as read"
        })
    
    @action(detail=False, methods=['get'])
    def unread_count(self, request):
        """Получить количество непрочитанных сообщений"""
        if not request.user.is_authenticated:
            return Response({"error": "User not authenticated"}, status=401)
        
        try:
            profile = request.user.profile
        except Profile.DoesNotExist:
            return Response({"error": "Profile not found"}, status=400)
        
        # Считаем сообщения, где текущий пользователь не отправитель и не прочитал
        unread_count = Message.objects.filter(
            ~Q(sender=profile)  # Исключаем сообщения, где пользователь отправитель
        ).exclude(
            read_statuses__user=profile
        ).count()
        
        # Или по чатам
        unread_by_chat = Message.objects.filter(
            ~Q(sender=profile)
        ).exclude(
            read_statuses__user=profile
        ).values('chat_id').annotate(count=models.Count('id'))
        
        # Преобразуем в словарь {chat_id: count}
        unread_by_chat_dict = {
            str(item['chat_id']): item['count'] 
            for item in unread_by_chat
        }
        
        return Response({
            "total_unread": unread_count,
            "unread_by_chat": unread_by_chat_dict
        })

    def create(self, request, *args, **kwargs):
        # Если есть file_url в запросе, значит это сообщение с файлом
        file_url = request.data.get('file_url')
        file_name = request.data.get('file_name')
        file_size = request.data.get('file_size')
        
        if file_url and not request.user.is_authenticated:
            return Response({"error": "User not authenticated"}, status=401)
        
        try:
            profile = request.user.profile
        except Profile.DoesNotExist:
            return Response({"error": "Profile not found"}, status=400)
        
        # Создаем сообщение
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        
        # Сохраняем с файловыми данными
        message = serializer.save(
            sender=profile,
            file_url=file_url,
            file_name=file_name,
            file_size=file_size
        )
        
        # Отправляем сообщение через WebSocket
        from channels.layers import get_channel_layer
        from asgiref.sync import async_to_sync
        
        channel_layer = get_channel_layer()
        if channel_layer:
            # Сериализуем сообщение для отправки
            message_data = MessageSerializer(message, context={'request': request}).data
            
            # Отправляем в группу чата
            async_to_sync(channel_layer.group_send)(
                f'chat_{message.chat.id}',
                {
                    'type': 'chat_message',
                    'message': message_data
                }
            )
            
            # Отправляем уведомления всем участникам чата (кроме отправителя)
            chat_participants = ChatParticipant.objects.filter(chat=message.chat).exclude(user=profile)
            for participant in chat_participants:
                async_to_sync(channel_layer.group_send)(
                    f'user_{participant.user.id}',
                    {
                        'type': 'notification',
                        'data': {
                            'type': 'new_message',
                            'chat_id': str(message.chat.id),
                            'message': message_data
                        }
                    }
                )
        
        headers = self.get_success_headers(serializer.data)
        return Response(serializer.data, status=201, headers=headers)


# Кастомная аутентификация для SSE (токен в query параметрах)
def authenticate_sse_request(request):
    """Аутентификация для SSE через токен в query параметрах"""
    token = request.GET.get('token') or request.GET.get('access_token')
    if not token:
        return None
    
    try:
        UntypedToken(token)
        decoded_data = jwt_decode(token, options={"verify_signature": False})
        user_id = decoded_data.get('user_id')
        if user_id:
            return User.objects.get(id=user_id)
    except (InvalidToken, TokenError, User.DoesNotExist):
        return None
    return None

# SSE Views для получения сообщений в реальном времени
# Используем обычный Django view вместо @api_view, так как DRF не поддерживает text/event-stream
@never_cache
def sse_chat_stream_v2(request, chat_id):
    """SSE endpoint для получения сообщений через Channels"""
    from channels.layers import get_channel_layer
    from asgiref.sync import async_to_sync
    
    # Аутентификация через токен в query параметрах
    user = authenticate_sse_request(request)
    if not user:
        response = StreamingHttpResponse(
            f"data: {json.dumps({'type': 'error', 'message': 'Authentication required'})}\n\n",
            content_type='text/event-stream'
        )
        response.status_code = 401
        return response
    
    request.user = user
    
    def event_stream():
        # Получаем пользователя
        try:
            profile = user.profile
        except Profile.DoesNotExist:
            yield f"data: {json.dumps({'type': 'error', 'message': 'Profile not found'})}\n\n"
            return
        
        # Проверяем доступ к чату
        try:
            chat = Chat.objects.get(id=chat_id)
            if not ChatParticipant.objects.filter(chat=chat, user=profile).exists():
                yield f"data: {json.dumps({'type': 'error', 'message': 'Access denied'})}\n\n"
                return
        except Chat.DoesNotExist:
            yield f"data: {json.dumps({'type': 'error', 'message': 'Chat not found'})}\n\n"
            return
        
        # Отслеживаем последнее проверенное сообщение
        last_message_id = None
        try:
            last_message = Message.objects.filter(chat=chat).order_by('-created_at').first()
            if last_message:
                last_message_id = last_message.id
        except:
            pass
        
        try:
            last_ping = time.time()
            while True:
                # Проверяем новые сообщения в БД (polling fallback)
                try:
                    if last_message_id:
                        new_messages = Message.objects.filter(
                            chat=chat,
                            id__gt=last_message_id
                        ).order_by('created_at')[:10]
                    else:
                        new_messages = Message.objects.filter(chat=chat).order_by('-created_at')[:1]
                    
                    for msg in new_messages:
                        if last_message_id is None or msg.id > last_message_id:
                            message_data = MessageSerializer(msg, context={'request': request}).data
                            yield f"data: {json.dumps({'type': 'new_message', 'message': message_data})}\n\n"
                            last_message_id = msg.id
                except Exception as e:
                    print(f"Error checking messages: {e}")
                
                # Отправляем ping каждые 30 секунд
                if time.time() - last_ping > 30:
                    yield f"data: {json.dumps({'type': 'ping'})}\n\n"
                    last_ping = time.time()
                
                time.sleep(1)  # Проверяем каждую секунду
                
        except Exception as e:
            print(f"SSE stream error: {e}")
    
    response = StreamingHttpResponse(event_stream(), content_type='text/event-stream')
    response['Cache-Control'] = 'no-cache'
    response['X-Accel-Buffering'] = 'no'  # Отключаем буферизацию в nginx
    response['Connection'] = 'keep-alive'
    # Разрешаем CORS для SSE
    response['Access-Control-Allow-Origin'] = '*'
    response['Access-Control-Allow-Credentials'] = 'true'
    return response


# Используем обычный Django view вместо @api_view для SSE
@never_cache
def sse_user_stream_v2(request, user_id):
    """SSE endpoint для получения уведомлений через Channels"""
    from channels.layers import get_channel_layer
    from asgiref.sync import async_to_sync
    
    # Аутентификация через токен в query параметрах
    user = authenticate_sse_request(request)
    if not user:
        response = StreamingHttpResponse(
            f"data: {json.dumps({'type': 'error', 'message': 'Authentication required'})}\n\n",
            content_type='text/event-stream'
        )
        response.status_code = 401
        return response
    
    request.user = user
    
    def event_stream():
        # Получаем пользователя
        try:
            profile = user.profile
        except Profile.DoesNotExist:
            yield f"data: {json.dumps({'type': 'error', 'message': 'Profile not found'})}\n\n"
            return
        
        # Проверяем, что user_id совпадает
        if str(profile.id) != str(user_id):
            yield f"data: {json.dumps({'type': 'error', 'message': 'Access denied'})}\n\n"
            return
        
        # Получаем чаты пользователя для проверки новых сообщений
        user_chats = Chat.objects.filter(participants=profile)
        
        # Отслеживаем последние проверенные сообщения
        last_checked = {str(chat.id): None for chat in user_chats}
        for chat in user_chats:
            try:
                last_msg = Message.objects.filter(chat=chat).order_by('-created_at').first()
                if last_msg:
                    last_checked[str(chat.id)] = last_msg.id
            except:
                pass
        
        try:
            last_ping = time.time()
            while True:
                # Проверяем новые сообщения во всех чатах пользователя
                for chat in user_chats:
                    try:
                        last_msg_id = last_checked.get(str(chat.id))
                        if last_msg_id:
                            # Используем exclude вместо __ne (не поддерживается для UUIDField)
                            new_messages = Message.objects.filter(
                                chat=chat,
                                id__gt=last_msg_id
                            ).exclude(sender=profile).order_by('created_at')[:10]  # Только сообщения от других
                        else:
                            continue
                        
                        for msg in new_messages:
                            message_data = MessageSerializer(msg, context={'request': request}).data
                            yield f"data: {json.dumps({'type': 'notification', 'data': {'type': 'new_message', 'chat_id': str(chat.id), 'message': message_data}})}\n\n"
                            last_checked[str(chat.id)] = msg.id
                    except Exception as e:
                        print(f"Error checking chat {chat.id}: {e}")
                
                # Отправляем ping каждые 30 секунд
                if time.time() - last_ping > 30:
                    yield f"data: {json.dumps({'type': 'ping'})}\n\n"
                    last_ping = time.time()
                
                time.sleep(2)  # Проверяем каждые 2 секунды
                
        except Exception as e:
            print(f"SSE stream error: {e}")
    
    response = StreamingHttpResponse(event_stream(), content_type='text/event-stream')
    response['Cache-Control'] = 'no-cache'
    response['X-Accel-Buffering'] = 'no'  # Отключаем буферизацию в nginx
    response['Connection'] = 'keep-alive'
    # Разрешаем CORS для SSE
    response['Access-Control-Allow-Origin'] = '*'
    response['Access-Control-Allow-Credentials'] = 'true'
    return response


@api_view(['POST'])
@permission_classes([AllowAny])
def register_user(request):
    try:
        username = request.data.get('username')
        password = request.data.get('password')

        if not all([username, password]):
            return Response({'error': 'Все поля обязательны'}, status=status.HTTP_400_BAD_REQUEST)

        if User.objects.filter(username=username).exists():
            return Response({'error': 'Пользователь с таким логином уже существует'}, status=status.HTTP_400_BAD_REQUEST)

        # Создаем пользователя (без email)
        user = User.objects.create_user(username=username, password=password)
        
        # Создаем профиль и связываем с пользователем
        Profile.objects.create(user=user, username=username)
        
        return Response({
            'message': 'Пользователь создан',
            'user_id': user.id
        }, status=status.HTTP_201_CREATED)
    
    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

@api_view(['POST'])
@permission_classes([AllowAny])
def login_user(request):
    username = request.data.get('username')
    password = request.data.get('password')
    user = authenticate(username=username, password=password)
    if user:
        login(request, user)
        return Response({'message': 'Успешный вход'})
    return Response({'error': 'Неверный логин или пароль'}, status=400)

@api_view(['POST'])
@permission_classes([AllowAny])
def logout_user(request):
    from django.contrib.auth import logout
    logout(request)
    return Response({'message': 'Успешный выход'})

# В views.py добавьте:
from rest_framework.decorators import api_view
from rest_framework.response import Response

@api_view(['GET'])
def get_current_user_profile(request):
    if not request.user.is_authenticated:
        return Response({'error': 'Not authenticated'}, status=401)
    
    try:
        profile = request.user.profile
        serializer = ProfileSerializer(profile)
        return Response(serializer.data)
    except Profile.DoesNotExist:
        return Response({'error': 'Profile not found'}, status=404)

# views.py
from rest_framework import viewsets, status
from rest_framework.decorators import action, api_view
from rest_framework.response import Response
from rest_framework.views import APIView  # Добавляем этот импорт
from rest_framework.parsers import MultiPartParser, FormParser
from django.db.models import Q
from django.utils import timezone
from django.core.files.storage import default_storage
from django.core.files.base import ContentFile
from django.conf import settings
import os
import uuid
from .models import Profile, Friendship, Chat, ChatParticipant, Message, MessageReadStatus
from .serializers import ProfileSerializer, FriendshipSerializer, ChatSerializer, ChatParticipantSerializer, MessageSerializer, MessageReadStatusSerializer


class FileUploadView(APIView):
    parser_classes = [MultiPartParser, FormParser]
    
    def post(self, request, *args, **kwargs):
        if not request.user.is_authenticated:
            return Response({"error": "User not authenticated"}, status=401)
        
        file = request.FILES.get('file')
        if not file:
            return Response({"error": "No file provided"}, status=400)
        
        # Проверяем размер файла (макс. 50MB)
        if file.size > 50 * 1024 * 1024:
            return Response({"error": "File too large (max 50MB)"}, status=400)
        
        try:
            profile = request.user.profile
        except Profile.DoesNotExist:
            return Response({"error": "Profile not found"}, status=400)
        
        # Генерируем уникальное имя файла
        file_extension = os.path.splitext(file.name)[1]
        unique_filename = f"{uuid.uuid4()}{file_extension}"
        
        # Создаем директорию messages если её нет
        messages_dir = os.path.join(settings.MEDIA_ROOT, 'messages')
        os.makedirs(messages_dir, exist_ok=True)
        
        # Сохраняем файл
        file_path = os.path.join('messages', unique_filename)
        full_path = os.path.join(settings.MEDIA_ROOT, file_path)
        with open(full_path, 'wb+') as destination:
            for chunk in file.chunks():
                destination.write(chunk)
        
        # Используем относительный путь вместо абсолютного URL
        # Это работает правильно через nginx прокси
        file_url = f'/media/{file_path}'
        
        return Response({
            "file_url": file_url,
            "file_name": file.name,
            "file_size": file.size
        })