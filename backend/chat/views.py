import uuid
from django.db import models

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
        
@api_view(['POST'])
@permission_classes([AllowAny])
def register_user(request):
    try:
        email = request.data.get('email')
        password = request.data.get('password')
        username = request.data.get('username')

        if not all([email, password, username]):
            return Response({'error': 'Все поля обязательны'}, status=status.HTTP_400_BAD_REQUEST)

        if User.objects.filter(username=email).exists():
            return Response({'error': 'Пользователь с таким email уже существует'}, status=status.HTTP_400_BAD_REQUEST)

        # Создаем пользователя
        user = User.objects.create_user(username=email, email=email, password=password)
        
        # Создаем профиль и связываем с пользователем
        Profile.objects.create(user=user, username=username)  # исправлено: user=user
        
        return Response({
            'message': 'Пользователь создан',
            'user_id': user.id
        }, status=status.HTTP_201_CREATED)
    
    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

@api_view(['POST'])
@permission_classes([AllowAny])
def login_user(request):
    email = request.data.get('email')
    password = request.data.get('password')
    user = authenticate(username=email, password=password)
    if user:
        login(request, user)
        return Response({'message': 'Успешный вход'})
    return Response({'error': 'Неверный email или пароль'}, status=400)

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
@permission_classes([IsAuthenticated])
def get_current_user_profile(request):
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