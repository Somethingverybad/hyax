import uuid
import logging
from django.db import models

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from django.contrib.auth.models import User
from django.contrib.auth import authenticate, login
from .models import *
from .serializers import *
from .s3 import s3_enabled, upload_file as s3_upload
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response

logger = logging.getLogger(__name__)


# В views.py
class ProfileViewSet(viewsets.ModelViewSet):
    queryset = Profile.objects.all()
    serializer_class = ProfileSerializer
    permission_classes = [permissions.IsAuthenticated]

    def _own_profile_or_403(self, request, instance):
        """Менять и удалять можно только свой профиль. Раньше стоял AllowAny
        без проверки владельца — PATCH чужого профиля проходил у любого."""
        profile = getattr(request.user, 'profile', None)
        return profile is not None and profile.id == instance.id

    def update(self, request, *args, **kwargs):
        if not self._own_profile_or_403(request, self.get_object()):
            return Response({"error": "Можно менять только свой профиль"}, status=403)
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        if not self._own_profile_or_403(request, self.get_object()):
            return Response({"error": "Можно менять только свой профиль"}, status=403)
        return super().partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        if not self._own_profile_or_403(request, self.get_object()):
            return Response({"error": "Можно удалить только свой профиль"}, status=403)
        return super().destroy(request, *args, **kwargs)
    
    def retrieve(self, request, *args, **kwargs):
        """Получить профиль по ID с логированием"""
        profile_id = kwargs.get('pk')
        
        # Логируем запрос
        logger.warning(f"🔍 [ProfileViewSet.retrieve] Запрос профиля: pk={profile_id}, user={request.user}, authenticated={request.user.is_authenticated}")
        
        # Проверяем на undefined
        if profile_id in ['undefined', 'null', 'None']:
            logger.error(f"❌ [ProfileViewSet.retrieve] Получен некорректный ID: '{profile_id}' от пользователя {request.user}")
            return Response({
                'error': f'Invalid profile ID: {profile_id}',
                'detail': 'Profile ID cannot be "undefined", "null" or "None"',
                'hint': 'Use /api/profiles/current/ or /api/profiles/me/ to get your own profile',
                'user': str(request.user),
                'authenticated': request.user.is_authenticated
            }, status=400)
        
        try:
            instance = self.get_object()
            serializer = self.get_serializer(instance)
            data = serializer.data
            logger.info(f"✅ [ProfileViewSet.retrieve] Профиль найден: id={data.get('id')}, username={data.get('username')}")
            return Response(data)
        except Exception as e:
            logger.error(f"❌ [ProfileViewSet.retrieve] Ошибка получения профиля {profile_id}: {e}")
            raise

    def get_queryset(self):
        queryset = Profile.objects.all()
        search_query = self.request.query_params.get('search', None)
        
        if search_query:
            queryset = queryset.filter(username__icontains=search_query)
        
        return queryset
    
    @action(detail=False, methods=['get'], permission_classes=[permissions.IsAuthenticated])
    def me(self, request):
        """Получить профиль текущего пользователя (альтернативный эндпоинт)"""
        try:
            logger.warning(f"👤 [ProfileViewSet.me] Запрос от пользователя: {request.user}")
            profile = request.user.profile
            serializer = self.get_serializer(profile)
            data = serializer.data
            logger.warning(f"✅ [ProfileViewSet.me] Отправка профиля: id={data.get('id')}, username={data.get('username')}")
            return Response(data)
        except Profile.DoesNotExist:
            logger.error(f"❌ [ProfileViewSet.me] Профиль не найден для пользователя: {request.user}")
            return Response({"error": "Profile not found"}, status=404)
    
    @action(detail=False, methods=['patch'], permission_classes=[permissions.IsAuthenticated])
    def update_me(self, request):
        """Обновить профиль текущего пользователя"""
        try:
            profile = request.user.profile
            
            # Обновляем только разрешенные поля
            if 'bio' in request.data:
                profile.bio = request.data['bio']
            
            # avatar_url обновляется через AvatarUploadView
            
            profile.save()
            serializer = self.get_serializer(profile)
            return Response(serializer.data)
        except Profile.DoesNotExist:
            return Response({"error": "Profile not found"}, status=404)

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
            # prefetch обязателен: сериализатор теперь отдаёт участников, и без
            # него на каждый чат уходил бы отдельный запрос к базе — ровно та
            # проблема, которую мы убираем с клиента.
            from django.db.models import OuterRef, Subquery
            # Превью последнего сообщения не должно показывать удалённые:
            # ни удалённые у всех, ни спрятанные текущим пользователем «у себя».
            last = (
                Message.objects
                .filter(chat=OuterRef('pk'))
                .exclude(deleted_for_all=True)
                .exclude(deleted_for=profile)
                .order_by('-created_at')
            )
            return (
                Chat.objects
                .filter(participants=profile)
                .prefetch_related('participants')
                .annotate(
                    last_text_a=Subquery(last.values('content')[:1]),
                    last_sender_id_a=Subquery(last.values('sender_id')[:1]),
                    last_sticker_a=Subquery(last.values('sticker_id')[:1]),
                    last_voice_a=Subquery(last.values('voice_url')[:1]),
                    last_video_a=Subquery(last.values('video_url')[:1]),
                    last_file_a=Subquery(last.values('file_url')[:1]),
                )
                .select_related('pinned_message__sender')
                .order_by('-updated_at')
            )
        except Profile.DoesNotExist:
            return Chat.objects.none()

    @action(detail=False, methods=['get'])
    def saved(self, request):
        """«Избранное»: личный чат без собеседника, один на пользователя.
        Создаётся при первом обращении. В списке чатов клиент его не показывает —
        у него своя вкладка."""
        try:
            profile = request.user.profile
        except Profile.DoesNotExist:
            return Response({"error": "Profile not found"}, status=400)
        chat = Chat.objects.filter(kind="saved", creator=profile).first()
        if not chat:
            chat = Chat.objects.create(kind="saved", creator=profile, name="Избранное")
            ChatParticipant.objects.get_or_create(chat=chat, user=profile, defaults={"role": "owner"})
        return Response(self.get_serializer(chat).data)

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
        
    @action(detail=True, methods=['post'])
    def add_participants(self, request, pk=None):
        """Добавить людей в чат.

        Добавлять может только участник — иначе в чужую переписку можно было
        бы влезть по одному лишь идентификатору. Личная переписка при этом
        становится группой: втроём это уже не диалог.
        """
        chat = self.get_object()
        try:
            profile = request.user.profile
        except Profile.DoesNotExist:
            return Response({"error": "Profile not found"}, status=400)

        if not ChatParticipant.objects.filter(chat=chat, user=profile).exists():
            return Response({"error": "Вы не участник этого чата"}, status=403)

        # В существующей группе участников добавляет только админ-создатель.
        if chat.is_group and chat.creator_id and chat.creator_id != profile.id:
            return Response({"error": "Добавлять участников может только админ группы"}, status=403)

        ids = request.data.get('participants') or []
        if isinstance(ids, str):
            ids = [ids]
        profiles = list(Profile.objects.filter(id__in=ids))
        if not profiles:
            return Response({"error": "Некого добавлять"}, status=400)

        added = []
        for user in profiles:
            _, created = ChatParticipant.objects.get_or_create(chat=chat, user=user)
            if created:
                added.append(user.username)

        if chat.participants.count() > 2 and not chat.is_group:
            chat.is_group = True
            if not chat.creator_id:
                chat.creator = profile  # тот, кто собрал группу — админ
            if not chat.name:
                names = list(chat.participants.values_list('username', flat=True)[:3])
                chat.name = ", ".join(names)[:100]
            chat.save(update_fields=["is_group", "name", "creator"])

        return Response({"added": added, "chat": self.get_serializer(chat).data})

    @action(detail=True, methods=['post', 'patch'])
    def configure(self, request, pk=None):
        """Настройки группы: название и аватар. Меняет только админ-создатель."""
        chat = self.get_object()
        try:
            profile = request.user.profile
        except Profile.DoesNotExist:
            return Response({"error": "Profile not found"}, status=400)
        if not chat.is_group:
            return Response({"error": "Это не группа"}, status=400)
        if chat.creator_id and chat.creator_id != profile.id:
            return Response({"error": "Настраивать группу может только админ"}, status=403)

        fields = []
        name = request.data.get('name')
        if name is not None:
            chat.name = str(name).strip()[:100]
            fields.append('name')
        avatar_url = request.data.get('avatar_url')
        if avatar_url is not None:
            chat.avatar_url = avatar_url or None
            fields.append('avatar_url')
        if fields:
            chat.save(update_fields=fields)
        return Response(self.get_serializer(chat).data)

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
        
        # Группу создаём всегда новую: два разных сообщества могут состоять
        # из одних и тех же людей, склеивать их по составу нельзя.
        is_group = bool(request.data.get('is_group')) or len(participant_uuids) > 2
        if is_group:
            try:
                creator_profile = Profile.objects.get(user=request.user)
            except Profile.DoesNotExist:
                return Response({'detail': 'Current user profile not found'}, status=status.HTTP_400_BAD_REQUEST)
            chat = Chat.objects.create(
                is_group=True,
                name=(request.data.get('name') or '').strip()[:100],
                avatar_url=(request.data.get('avatar_url') or '') or None,
                creator=creator_profile,
            )
            # Создатель — обязательный участник: иначе группа не пройдёт фильтр
            # participants=profile в его же списке чатов и просто не покажется.
            members = list(existing_profiles) + [creator_profile]
            chat.participants.set(members)
            return Response(self.get_serializer(chat).data, status=status.HTTP_201_CREATED)

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

def _notify_new_message(message, profile, request):
    """Разослать новое сообщение: в сокет чата, пуш остальным участникам и
    персональные уведомления в сокеты (веб/десктоп без пушей). Общее для
    обычной отправки и пересылки."""
    from channels.layers import get_channel_layer
    from asgiref.sync import async_to_sync

    channel_layer = get_channel_layer()
    message_data = MessageSerializer(message, context={'request': request}).data
    if channel_layer:
        async_to_sync(channel_layer.group_send)(
            f'chat_{message.chat.id}',
            {'type': 'chat_message', 'message': message_data},
        )

    # Пуш остальным участникам. Уходит в фоновом потоке и не задерживает
    # ответ; падение отправки не должно ронять создание сообщения.
    try:
        from .fcm import notify_profiles
        recipients = message.chat.participants.exclude(id=profile.id)
        preview = (message.content or "").strip()
        if not preview:
            if message.sticker_id:
                preview = "Стикер"
            elif getattr(message, "video_url", None):
                preview = "Видео-сообщение"
            elif getattr(message, "voice_url", None):
                preview = "Голосовое сообщение"
            elif getattr(message, "file_url", None):
                preview = "Файл"
            else:
                preview = "Новое сообщение"
        # У поста канала заголовок пуша — имя канала, а не автора.
        push_title = message.chat.name if getattr(message.chat, "kind", "") == "channel" else profile.username
        notify_profiles(
            recipients,
            title=push_title,
            body=preview[:150],
            extra={"chat_id": str(message.chat.id)},
            sound=message.sound.slug if message.sound_id else None,
        )
    except Exception:
        logger.exception("push: не удалось поставить отправку")

    # WebSocket-уведомление в персональные каналы участников. Нужно веб- и
    # десктоп-клиентам: они не получают FCM-пуш, а по этому сообщению
    # обновляют список чатов и показывают системный баннер. Шлём всегда,
    # а не только при сбое пуша — иначе десктоп «молчит».
    if channel_layer:
        for participant in ChatParticipant.objects.filter(chat=message.chat).exclude(user=profile):
            async_to_sync(channel_layer.group_send)(
                f'user_{participant.user.id}',
                {
                    'type': 'notification',
                    'data': {
                        'type': 'new_message',
                        'chat_id': str(message.chat.id),
                        'message': message_data,
                    },
                }
            )


def _can_see_chat(chat, profile):
    """Читать чат может участник; публичный канал — любой."""
    if ChatParticipant.objects.filter(chat=chat, user=profile).exists():
        return True
    return chat.kind == "channel" and chat.is_public


def _can_post_to(chat, profile):
    """Писать в чат может участник; в канал — только owner/admin."""
    cp = ChatParticipant.objects.filter(chat=chat, user=profile).first()
    if not cp:
        return False
    if chat.kind == "channel":
        return cp.role in ("owner", "admin")
    return True


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
        # Скрываем удалённые: у всех — для каждого; «у себя» — для того, кто удалил.
        queryset = queryset.exclude(deleted_for_all=True)
        try:
            queryset = queryset.exclude(deleted_for=self.request.user.profile)
        except Exception:
            pass
        return queryset.order_by('created_at')

    @action(detail=True, methods=['post'])
    def remove(self, request, pk=None):
        """Удаление: scope=me (спрятать у себя) или scope=all (у всех, только автор)."""
        msg = self.get_object()
        try:
            profile = request.user.profile
        except Profile.DoesNotExist:
            return Response({"error": "Profile not found"}, status=400)
        scope = (request.data.get('scope') or 'me').lower()
        if scope == 'all':
            if msg.sender_id != profile.id:
                return Response({"error": "Удалить у всех может только автор"}, status=403)
            msg.deleted_for_all = True
            msg.save(update_fields=['deleted_for_all'])
        else:
            msg.deleted_for.add(profile)
        return Response({"ok": True})

    @action(detail=True, methods=['post'])
    def edit(self, request, pk=None):
        """Редактирование текста — только автор, только текстовое сообщение."""
        msg = self.get_object()
        try:
            profile = request.user.profile
        except Profile.DoesNotExist:
            return Response({"error": "Profile not found"}, status=400)
        if msg.sender_id != profile.id:
            return Response({"error": "Редактировать может только автор"}, status=403)
        content = (request.data.get('content') or '').strip()
        if not content:
            return Response({"error": "Пустой текст"}, status=400)
        msg.content = content
        msg.is_edited = True
        msg.save(update_fields=['content', 'is_edited'])
        return Response(MessageSerializer(msg, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def pin(self, request, pk=None):
        """Закрепить ({pin: true}) или открепить ({pin: false}) сообщение в его чате.
        Закреп один на чат. В личке и группе — любой участник, в канале — админы."""
        msg = self.get_object()
        try:
            profile = request.user.profile
        except Profile.DoesNotExist:
            return Response({"error": "Profile not found"}, status=400)
        chat = msg.chat
        if not _can_post_to(chat, profile):
            return Response({"error": "Закреплять могут только участники"}, status=403)
        pin = request.data.get('pin', True)
        pin = str(pin).lower() not in ('0', 'false', 'no')
        if pin:
            chat.pinned_message = msg
        elif chat.pinned_message_id == msg.id:
            chat.pinned_message = None
        chat.save(update_fields=['pinned_message'])
        from .serializers import pinned_payload
        return Response({"pinned_message": pinned_payload(chat.pinned_message)})

    @action(detail=True, methods=['post'])
    def forward(self, request, pk=None):
        """Переслать сообщение в другой чат ({chat_id}). Копируем содержимое,
        а не ссылаемся на оригинал: удаление исходника пересланное не трогает.
        В «Избранное» пересылается так же — это обычный чат с одним участником."""
        src = self.get_object()
        try:
            profile = request.user.profile
        except Profile.DoesNotExist:
            return Response({"error": "Profile not found"}, status=400)
        if not _can_see_chat(src.chat, profile):
            return Response({"error": "Нет доступа к исходному сообщению"}, status=403)
        target = Chat.objects.filter(id=request.data.get('chat_id')).first()
        if not target:
            return Response({"error": "Чат не найден"}, status=404)
        if not _can_post_to(target, profile):
            return Response({"error": "В этот чат нельзя написать"}, status=403)

        # Заголовок «от кого»: цепочку пересылок не наращиваем — сохраняем
        # первоисточник, как и мессенджеры.
        origin = src.forwarded_from or src.sender
        title = src.forwarded_title
        if not title:
            if src.chat.kind == "channel" and not (src.chat.sign_posts and src.sender):
                title = src.chat.name or "Канал"
                origin = None
            else:
                title = origin.username if origin else "Неизвестный"

        message = Message.objects.create(
            chat=target,
            sender=profile,
            content=src.content,
            file_url=src.file_url,
            file_name=src.file_name,
            file_size=src.file_size,
            sticker=src.sticker,
            voice_url=src.voice_url,
            voice_duration=src.voice_duration,
            video_url=src.video_url,
            video_duration=src.video_duration,
            video_mirror=src.video_mirror,
            download_only=src.download_only,
            forwarded_from=origin,
            forwarded_title=title[:120],
        )
        Chat.objects.filter(id=target.id).update(updated_at=timezone.now())
        _notify_new_message(message, profile, request)
        return Response(MessageSerializer(message, context={'request': request}).data, status=201)

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
        sticker_id = request.data.get('sticker_id')
        voice_url = request.data.get('voice_url')
        voice_duration = request.data.get('voice_duration')
        video_url = request.data.get('video_url')
        video_duration = request.data.get('video_duration')
        
        if (file_url or sticker_id or voice_url or video_url) and not request.user.is_authenticated:
            return Response({"error": "User not authenticated"}, status=401)
        
        try:
            profile = request.user.profile
        except Profile.DoesNotExist:
            return Response({"error": "Profile not found"}, status=400)

        # Канал: публиковать может только owner/admin.
        _chat_id = request.data.get('chat')
        if _chat_id:
            _ch = Chat.objects.filter(id=_chat_id).only('id', 'kind', 'name').first()
            if _ch and _ch.kind == 'channel':
                _cp = ChatParticipant.objects.filter(chat=_ch, user=profile).first()
                if not _cp or _cp.role not in ('owner', 'admin'):
                    return Response({"error": "Публиковать в канал могут только админы"}, status=403)

        # Создаем сообщение
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        
        # Подготавливаем данные для сохранения
        save_kwargs = {'sender': profile}
        
        if file_url:
            save_kwargs.update({
                'file_url': file_url,
                'file_name': file_name,
                'file_size': file_size,
                'download_only': str(request.data.get('download_only') or '').lower() in ('1', 'true', 'yes'),
            })
        
        if sticker_id:
            try:
                sticker = Sticker.objects.get(id=sticker_id)
                save_kwargs['sticker'] = sticker
            except Sticker.DoesNotExist:
                return Response({"error": "Sticker not found"}, status=400)

        # Аудио-стикер: звук, который прозвучит у получателя.
        sound_id = request.data.get('sound_id')
        if sound_id:
            try:
                save_kwargs['sound'] = NotificationSound.objects.get(
                    id=sound_id, is_active=True
                )
            except NotificationSound.DoesNotExist:
                return Response({"error": "Sound not found"}, status=400)

        # Реплай: отвечаем на сообщение. Цитату берём только из того же чата,
        # чтобы нельзя было процитировать чужую переписку по одному id.
        reply_to_id = request.data.get('reply_to_id')
        if reply_to_id:
            try:
                save_kwargs['reply_to'] = Message.objects.get(
                    id=reply_to_id, chat_id=request.data.get('chat')
                )
            except Message.DoesNotExist:
                pass

        if voice_url:
            save_kwargs.update({
                'voice_url': voice_url,
                'voice_duration': voice_duration
            })

        if video_url:
            save_kwargs.update({
                'video_url': video_url,
                'video_duration': video_duration,
                'video_mirror': str(request.data.get('video_mirror') or '').lower() in ('1', 'true', 'yes'),
            })
        
        # Сохраняем с данными
        message = serializer.save(**save_kwargs)
        
        _notify_new_message(message, profile, request)

        headers = self.get_success_headers(serializer.data)
        return Response(serializer.data, status=201, headers=headers)
        
@api_view(['POST'])
@permission_classes([AllowAny])
def register_user(request):
    try:
        username = request.data.get('username')
        password = request.data.get('password')

        if not all([username, password]):
            return Response({'error': 'Логин и пароль обязательны'}, status=status.HTTP_400_BAD_REQUEST)

        if User.objects.filter(username=username).exists():
            return Response({'error': 'Пользователь с таким логином уже существует'}, status=status.HTTP_400_BAD_REQUEST)

        # Создаем пользователя с username
        # email оставляем пустым или генерируем фейковый
        user = User.objects.create_user(
            username=username, 
            email=f"{username}@local.fake",  # фейковый email для совместимости
            password=password
        )
        
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
@permission_classes([IsAuthenticated])
def get_current_user_profile(request):
    """Получить профиль текущего пользователя"""
    try:
        logger.warning(f"👤 [get_current_user_profile] Запрос от пользователя: {request.user}")
        profile = request.user.profile
        serializer = ProfileSerializer(profile)
        data = serializer.data
        logger.warning(f"✅ [get_current_user_profile] Отправка профиля: id={data.get('id')}, username={data.get('username')}")
        return Response(data)
    except Profile.DoesNotExist:
        logger.error(f"❌ [get_current_user_profile] Профиль не найден для пользователя: {request.user}")
        return Response({'error': 'Profile not found'}, status=404)
    except Exception as e:
        logger.error(f"❌ [get_current_user_profile] Ошибка: {e}")
        return Response({'error': str(e)}, status=500)

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

        out_name = file.name
        out_size = file.size

        # Сжатие видео на сервере (ffmpeg): клиент присылает compress=video для
        # вкладки «Видео». Файлы (вкладка «Файл») не трогаем. Фото жмёт клиент.
        compress = (request.data.get('compress') or '').lower()
        is_video = file_extension.lower() in ('.mp4', '.mov', '.m4v', '.webm', '.avi', '.mkv')
        if compress == 'video' and is_video:
            import subprocess
            transcoded = os.path.join('messages', f"{uuid.uuid4()}.mp4")
            transcoded_full = os.path.join(settings.MEDIA_ROOT, transcoded)
            try:
                subprocess.run(
                    ["ffmpeg", "-y", "-i", full_path,
                     "-vf", "scale='-2:min(720,ih)'",
                     "-c:v", "libx264", "-crf", "28", "-preset", "veryfast",
                     "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart",
                     transcoded_full],
                    check=True, timeout=180,
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                )
                new_size = os.path.getsize(transcoded_full)
                # Берём пережатый вариант только если он реально меньше.
                if new_size > 0 and new_size < out_size:
                    os.remove(full_path)
                    file_path = transcoded
                    out_size = new_size
                    base = os.path.splitext(file.name)[0]
                    out_name = f"{base}.mp4"
                else:
                    os.remove(transcoded_full)
            except Exception:
                # ffmpeg недоступен/упал/таймаут — оставляем оригинал.
                try:
                    if os.path.exists(transcoded_full):
                        os.remove(transcoded_full)
                except Exception:
                    pass

        # Хранилище: при включённом S3 отправляем итоговый файл в бакет и
        # отдаём его публичный URL, локальную копию удаляем. Иначе — как раньше,
        # раздаём локально через nginx (/media/...).
        local_only = str(request.data.get('local') or '').lower() in ('1', 'true', 'yes')
        if s3_enabled() and not local_only:
            try:
                url = s3_upload(os.path.join(settings.MEDIA_ROOT, file_path), file_path)
                try:
                    os.remove(os.path.join(settings.MEDIA_ROOT, file_path))
                except Exception:
                    pass
                file_url = url
            except Exception:
                logger.exception("S3: загрузка не удалась, отдаю локально")
                file_url = f'/media/{file_path}'
        else:
            file_url = f'/media/{file_path}'

        return Response({
            "file_url": file_url,
            "file_name": out_name,
            "file_size": out_size
        })


# ViewSet для стикерпаков
class StickerPackViewSet(viewsets.ModelViewSet):
    queryset = StickerPack.objects.all()
    serializer_class = StickerPackSerializer
    permission_classes = [permissions.IsAuthenticated]
    
    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['request'] = self.request
        return context
    
    def get_queryset(self):
        """Возвращаем публичные паки и паки текущего пользователя"""
        try:
            profile = self.request.user.profile
            return StickerPack.objects.filter(
                models.Q(is_public=True) | models.Q(author=profile)
            ).prefetch_related('stickers').distinct()
        except Profile.DoesNotExist:
            return StickerPack.objects.filter(is_public=True).prefetch_related('stickers')
    
    def perform_create(self, serializer):
        """При создании пака автоматически назначаем автора"""
        try:
            profile = self.request.user.profile
            pack = serializer.save(author=profile)
            # Автоматически сохраняем пак для автора
            UserStickerPack.objects.get_or_create(user=profile, pack=pack)
        except Profile.DoesNotExist:
            raise ValidationError("Profile not found")
    
    @action(detail=True, methods=['post'])
    def save(self, request, pk=None):
        """Сохранить стикерпак себе"""
        pack = self.get_object()
        try:
            profile = request.user.profile
            user_pack, created = UserStickerPack.objects.get_or_create(user=profile, pack=pack)
            if created:
                return Response({"status": "success", "message": "Sticker pack saved"})
            else:
                return Response({"status": "already_saved", "message": "Sticker pack already saved"})
        except Profile.DoesNotExist:
            return Response({"error": "Profile not found"}, status=400)
    
    @action(detail=True, methods=['post'])
    def unsave(self, request, pk=None):
        """Удалить стикерпак из сохраненных"""
        pack = self.get_object()
        try:
            profile = request.user.profile
            deleted_count, _ = UserStickerPack.objects.filter(user=profile, pack=pack).delete()
            if deleted_count > 0:
                return Response({"status": "success", "message": "Sticker pack removed"})
            else:
                return Response({"status": "not_found", "message": "Sticker pack was not saved"})
        except Profile.DoesNotExist:
            return Response({"error": "Profile not found"}, status=400)
    
    @action(detail=False, methods=['get'])
    def my_packs(self, request):
        """Получить все сохраненные стикерпаки пользователя"""
        try:
            profile = request.user.profile
            user_packs = UserStickerPack.objects.filter(user=profile).select_related('pack__author').prefetch_related('pack__stickers')
            serializer = UserStickerPackSerializer(user_packs, many=True, context={'request': request})
            return Response(serializer.data)
        except Profile.DoesNotExist:
            return Response({"error": "Profile not found"}, status=400)
    
    @action(detail=True, methods=['post'])
    def share(self, request, pk=None):
        """Получить код для обмена стикерпаком"""
        pack = self.get_object()
        try:
            profile = request.user.profile
            # Проверяем, что пользователь либо автор, либо пак публичный
            if pack.author != profile and not pack.is_public:
                return Response({"error": "You can only share your own or public packs"}, status=403)
            
            # Возвращаем ID пака как код для обмена
            return Response({"share_code": str(pack.id), "pack_name": pack.name})
        except Profile.DoesNotExist:
            return Response({"error": "Profile not found"}, status=400)
    
    @action(detail=False, methods=['post'])
    def import_pack(self, request):
        """Импортировать стикерпак по коду (ID)"""
        share_code = request.data.get('share_code')
        if not share_code:
            return Response({"error": "share_code is required"}, status=400)
        
        try:
            profile = request.user.profile
            
            # Ищем пак по ID
            try:
                pack = StickerPack.objects.get(id=share_code)
            except StickerPack.DoesNotExist:
                return Response({"error": "Sticker pack not found"}, status=404)
            
            # Проверяем, что пак публичный или пользователь - автор
            if not pack.is_public and pack.author != profile:
                return Response({"error": "This sticker pack is private"}, status=403)
            
            # Сохраняем пак пользователю
            user_pack, created = UserStickerPack.objects.get_or_create(user=profile, pack=pack)
            
            if created:
                serializer = StickerPackSerializer(pack, context={'request': request})
                return Response({
                    "status": "success",
                    "message": f"Sticker pack '{pack.name}' added",
                    "pack": serializer.data
                })
            else:
                return Response({
                    "status": "already_saved",
                    "message": "You already have this sticker pack"
                })
        except Profile.DoesNotExist:
            return Response({"error": "Profile not found"}, status=400)


# ViewSet для стикеров
class StickerViewSet(viewsets.ModelViewSet):
    queryset = Sticker.objects.all()
    serializer_class = StickerSerializer
    permission_classes = [permissions.IsAuthenticated]
    
    def get_queryset(self):
        """Фильтруем стикеры по паку"""
        queryset = Sticker.objects.select_related('pack__author')
        pack_id = self.request.query_params.get('pack')
        if pack_id:
            queryset = queryset.filter(pack_id=pack_id)
        return queryset.order_by('order', 'created_at')
    
    def perform_create(self, serializer):
        """При создании стикера проверяем, что пользователь - автор пака"""
        pack_id = self.request.data.get('pack')
        if not pack_id:
            raise ValidationError("Pack ID is required")
        
        try:
            profile = self.request.user.profile
            pack = StickerPack.objects.get(id=pack_id)
            
            if pack.author != profile:
                raise PermissionError("You can only add stickers to your own packs")
            
            serializer.save()
        except StickerPack.DoesNotExist:
            raise ValidationError("Sticker pack not found")
        except Profile.DoesNotExist:
            raise ValidationError("Profile not found")


# Загрузка стикеров
class StickerUploadView(APIView):
    parser_classes = [MultiPartParser, FormParser]
    permission_classes = [permissions.IsAuthenticated]
    
    def post(self, request, *args, **kwargs):
        if not request.user.is_authenticated:
            return Response({"error": "User not authenticated"}, status=401)
        
        file = request.FILES.get('file')
        if not file:
            return Response({"error": "No file provided"}, status=400)
        
        # Проверяем размер файла (макс. 5MB для стикеров)
        if file.size > 5 * 1024 * 1024:
            return Response({"error": "File too large (max 5MB for stickers)"}, status=400)
        
        # Проверяем, что это изображение
        allowed_extensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp']
        file_extension = os.path.splitext(file.name)[1].lower()
        if file_extension not in allowed_extensions:
            return Response({"error": "Only image files are allowed for stickers"}, status=400)
        
        try:
            profile = request.user.profile
        except Profile.DoesNotExist:
            return Response({"error": "Profile not found"}, status=400)
        
        # Генерируем уникальное имя файла
        unique_filename = f"{uuid.uuid4()}{file_extension}"
        
        # Создаем директорию stickers если её нет
        stickers_dir = os.path.join(settings.MEDIA_ROOT, 'stickers')
        os.makedirs(stickers_dir, exist_ok=True)
        
        # Сохраняем файл
        file_path = os.path.join('stickers', unique_filename)
        full_path = os.path.join(settings.MEDIA_ROOT, file_path)
        with open(full_path, 'wb+') as destination:
            for chunk in file.chunks():
                destination.write(chunk)
        
        # Используем относительный путь
        file_url = f'/media/{file_path}'
        
        return Response({
            "file_url": file_url,
            "file_name": file.name,
        })


# Загрузка голосовых сообщений
class VoiceUploadView(APIView):
    parser_classes = [MultiPartParser, FormParser]
    permission_classes = [permissions.IsAuthenticated]
    
    def post(self, request, *args, **kwargs):
        if not request.user.is_authenticated:
            return Response({"error": "User not authenticated"}, status=401)
        
        file = request.FILES.get('file')
        if not file:
            return Response({"error": "No file provided"}, status=400)
        
        # Проверяем размер файла (макс. 10MB для голосовых сообщений)
        if file.size > 10 * 1024 * 1024:
            return Response({"error": "File too large (max 10MB for voice messages)"}, status=400)
        
        # Проверяем, что это аудио файл
        allowed_extensions = ['.mp3', '.wav', '.ogg', '.webm', '.m4a', '.aac']
        file_extension = os.path.splitext(file.name)[1].lower()
        if file_extension not in allowed_extensions:
            return Response({"error": "Only audio files are allowed for voice messages"}, status=400)
        
        try:
            profile = request.user.profile
        except Profile.DoesNotExist:
            return Response({"error": "Profile not found"}, status=400)
        
        # Генерируем уникальное имя файла
        unique_filename = f"{uuid.uuid4()}{file_extension}"
        
        # Создаем директорию voice если её нет
        voice_dir = os.path.join(settings.MEDIA_ROOT, 'voice')
        os.makedirs(voice_dir, exist_ok=True)
        
        # Сохраняем файл
        file_path = os.path.join('voice', unique_filename)
        full_path = os.path.join(settings.MEDIA_ROOT, file_path)
        with open(full_path, 'wb+') as destination:
            for chunk in file.chunks():
                destination.write(chunk)
        
        # Используем относительный путь
        file_url = f'/media/{file_path}'
        
        return Response({
            "file_url": file_url,
            "file_name": file.name,
        })


# Загрузка аватаров
class AvatarUploadView(APIView):
    parser_classes = [MultiPartParser, FormParser]
    permission_classes = [permissions.IsAuthenticated]
    
    def post(self, request, *args, **kwargs):
        if not request.user.is_authenticated:
            return Response({"error": "User not authenticated"}, status=401)
        
        file = request.FILES.get('file')
        if not file:
            return Response({"error": "No file provided"}, status=400)
        
        # Проверяем размер файла (макс. 5MB для аватаров)
        if file.size > 5 * 1024 * 1024:
            return Response({"error": "File too large (max 5MB for avatars)"}, status=400)
        
        # Проверяем, что это изображение
        allowed_extensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp']
        file_extension = os.path.splitext(file.name)[1].lower()
        if file_extension not in allowed_extensions:
            return Response({"error": "Only image files are allowed for avatars"}, status=400)
        
        try:
            profile = request.user.profile
        except Profile.DoesNotExist:
            return Response({"error": "Profile not found"}, status=400)
        
        # Генерируем уникальное имя файла
        unique_filename = f"avatar_{profile.id}{file_extension}"
        
        # Создаем директорию avatars если её нет
        avatars_dir = os.path.join(settings.MEDIA_ROOT, 'avatars')
        os.makedirs(avatars_dir, exist_ok=True)
        
        # Удаляем старый аватар если есть
        if profile.avatar_url:
            old_avatar_path = profile.avatar_url.replace('/media/', '')
            old_full_path = os.path.join(settings.MEDIA_ROOT, old_avatar_path)
            if os.path.exists(old_full_path):
                try:
                    os.remove(old_full_path)
                except:
                    pass
        
        # Сохраняем файл
        file_path = os.path.join('avatars', unique_filename)
        full_path = os.path.join(settings.MEDIA_ROOT, file_path)
        with open(full_path, 'wb+') as destination:
            for chunk in file.chunks():
                destination.write(chunk)
        
        # Используем относительный путь
        file_url = f'/media/{file_path}'
        
        # Обновляем профиль
        profile.avatar_url = file_url
        profile.save()
        
        return Response({
            "avatar_url": file_url,
            "message": "Avatar uploaded successfully"
        })


class MediaSignView(APIView):
    """Временная подписанная ссылка на приватное вложение в S3. Доступ только
    участнику чата, в котором это вложение реально фигурирует — украсть ссылку
    и открывать «когда захочется» нельзя: она протухает, а выдаётся лишь после
    проверки прав."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        from django.db.models import Q
        from .s3 import s3_enabled, presigned_get

        key = (request.query_params.get('key') or '').lstrip('/')
        if not key or '..' in key:
            return Response({"error": "bad key"}, status=400)
        if not s3_enabled():
            return Response({"error": "S3 disabled"}, status=400)
        try:
            profile = request.user.profile
        except Profile.DoesNotExist:
            return Response({"error": "Profile not found"}, status=400)

        marker = f's3://{key}'
        msg = Message.objects.filter(
            Q(file_url=marker) | Q(video_url=marker) | Q(voice_url=marker)
        ).select_related('chat').first()
        if not msg:
            return Response({"error": "not found"}, status=404)
        if not ChatParticipant.objects.filter(chat=msg.chat, user=profile).exists():
            return Response({"error": "forbidden"}, status=403)

        try:
            url = presigned_get(key, 3600)
        except Exception:
            logger.exception("presigned_get failed")
            return Response({"error": "sign failed"}, status=502)
        return Response({"url": url})


# ── Creative Space: студия паков звуков ──────────────────────────────────────
# Авторизация — обычный вход приложения (JWT). Пак привязывается к создателю
# (SoundPack.creator = Profile), править/удалять может только он. Паками
# пользуются все, но управление — через студию.

def _studio_profile(request):
    return getattr(request.user, "profile", None)


def _uniq_sound_slug(base):
    import uuid as _uuid
    from django.utils.text import slugify
    base = slugify(base) or f"snd-{_uuid.uuid4().hex[:8]}"
    slug = base[:36]
    i = 1
    while NotificationSound.objects.filter(slug=slug).exists():
        slug = f"{base[:32]}-{i}"
        i += 1
    return slug


def _transcode_sound(pack, name, uploaded_file, order):
    """Исходник → mp3 (≤30с, mono, 96k) → NotificationSound (save() делает .caf)."""
    import os, subprocess, tempfile
    from django.core.files import File
    slug = _uniq_sound_slug(name)
    in_tmp = tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(uploaded_file.name)[1] or ".bin")
    for chunk in uploaded_file.chunks():
        in_tmp.write(chunk)
    in_tmp.close()
    out_mp3 = tempfile.NamedTemporaryFile(delete=False, suffix=".mp3"); out_mp3.close()
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", in_tmp.name, "-t", "30",
             "-ac", "1", "-c:a", "libmp3lame", "-b:a", "96k", out_mp3.name],
            check=True, capture_output=True, timeout=120,
        )
        snd = NotificationSound(name=name[:64], slug=slug, pack=pack, order=order)
        with open(out_mp3.name, "rb") as mp3f:
            snd.file.save(f"{slug}.mp3", File(mp3f), save=True)
        return snd
    finally:
        for pth in (in_tmp.name, out_mp3.name):
            try: os.remove(pth)
            except Exception: pass


def _delete_sound_files(sound):
    import os
    from django.conf import settings
    try:
        if sound.file and os.path.exists(sound.file.path):
            os.remove(sound.file.path)
    except Exception: pass
    try:
        caf = os.path.join(settings.MEDIA_ROOT, "sounds", f"{sound.slug}.caf")
        if os.path.exists(caf):
            os.remove(caf)
    except Exception: pass


def _pack_payload(pack):
    sounds = NotificationSoundSerializer(pack.sounds.all().order_by("order", "slug"), many=True).data
    return {"id": str(pack.id), "name": pack.name, "order": pack.order, "sounds": sounds}


class SoundPackStudioView(APIView):
    """POST — создать пак (нужен вход). Пак привязывается к создателю."""
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        import os
        profile = _studio_profile(request)
        if not profile:
            return Response({"error": "Нет профиля у пользователя"}, status=403)

        pack_name = (request.data.get("pack_name") or "").strip()
        if not pack_name:
            return Response({"error": "Укажите название пака"}, status=400)
        files = request.FILES.getlist("files")
        names = request.data.getlist("names")
        if not files:
            return Response({"error": "Добавьте хотя бы один звук"}, status=400)

        pack = SoundPack.objects.create(name=pack_name[:64], order=SoundPack.objects.count(), creator=profile)
        created, failed = [], []
        for idx, f in enumerate(files):
            name = (names[idx] if idx < len(names) else "").strip() or os.path.splitext(f.name)[0]
            try:
                snd = _transcode_sound(pack, name, f, idx)
                created.append({"id": str(snd.id), "name": snd.name, "slug": snd.slug})
            except Exception as e:
                logger.exception("Студия: не удалось обработать %s", f.name)
                failed.append({"name": name, "error": str(e)[:120]})
        if not created:
            pack.delete()
            return Response({"error": "Ни один звук не обработан", "failed": failed}, status=400)
        return Response({"pack": _pack_payload(pack), "created": created, "failed": failed})


class MySoundPacksView(APIView):
    """GET — паки текущего пользователя со звуками (для управления в студии)."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        profile = _studio_profile(request)
        if not profile:
            return Response({"error": "Нет профиля у пользователя"}, status=403)
        packs = SoundPack.objects.filter(creator=profile).prefetch_related("sounds").order_by("order", "name")
        return Response({"packs": [_pack_payload(p) for p in packs]})


class SoundPackDetailView(APIView):
    """PATCH — переименовать пак. DELETE — удалить пак со звуками. Только владелец."""
    permission_classes = [permissions.IsAuthenticated]

    def _get_owned(self, request, pk):
        profile = _studio_profile(request)
        pack = SoundPack.objects.filter(pk=pk).first()
        if not pack:
            return None, Response({"error": "Пак не найден"}, status=404)
        if not profile or pack.creator_id != profile.id:
            return None, Response({"error": "Это не ваш пак"}, status=403)
        return pack, None

    def patch(self, request, pk):
        pack, err = self._get_owned(request, pk)
        if err: return err
        name = (request.data.get("name") or "").strip()
        if not name:
            return Response({"error": "Пустое название"}, status=400)
        pack.name = name[:64]; pack.save(update_fields=["name"])
        return Response(_pack_payload(pack))

    def delete(self, request, pk):
        pack, err = self._get_owned(request, pk)
        if err: return err
        for snd in pack.sounds.all():
            _delete_sound_files(snd)
        pack.sounds.all().delete()
        pack.delete()
        return Response({"ok": True})


class SoundPackAddSoundsView(APIView):
    """POST — добавить звуки в существующий пак. Только владелец."""
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request, pk):
        import os
        profile = _studio_profile(request)
        pack = SoundPack.objects.filter(pk=pk).first()
        if not pack:
            return Response({"error": "Пак не найден"}, status=404)
        if not profile or pack.creator_id != profile.id:
            return Response({"error": "Это не ваш пак"}, status=403)
        files = request.FILES.getlist("files")
        names = request.data.getlist("names")
        if not files:
            return Response({"error": "Добавьте хотя бы один звук"}, status=400)
        base_order = (pack.sounds.aggregate(m=models.Max("order"))["m"] or -1) + 1
        created, failed = [], []
        for idx, f in enumerate(files):
            name = (names[idx] if idx < len(names) else "").strip() or os.path.splitext(f.name)[0]
            try:
                snd = _transcode_sound(pack, name, f, base_order + idx)
                created.append({"id": str(snd.id), "name": snd.name, "slug": snd.slug})
            except Exception as e:
                logger.exception("Студия: не удалось обработать %s", f.name)
                failed.append({"name": name, "error": str(e)[:120]})
        if not created:
            return Response({"error": "Ни один звук не обработан", "failed": failed}, status=400)
        return Response({"pack": _pack_payload(pack), "created": created, "failed": failed})


class SoundDetailView(APIView):
    """PATCH — переименовать звук. DELETE — удалить звук. Только владелец пака."""
    permission_classes = [permissions.IsAuthenticated]

    def _get_owned(self, request, pk):
        profile = _studio_profile(request)
        snd = NotificationSound.objects.filter(pk=pk).select_related("pack").first()
        if not snd:
            return None, Response({"error": "Звук не найден"}, status=404)
        if not snd.pack or not profile or snd.pack.creator_id != profile.id:
            return None, Response({"error": "Это не ваш звук"}, status=403)
        return snd, None

    def patch(self, request, pk):
        snd, err = self._get_owned(request, pk)
        if err: return err
        name = (request.data.get("name") or "").strip()
        if not name:
            return Response({"error": "Пустое название"}, status=400)
        snd.name = name[:64]; snd.save(update_fields=["name"])
        return Response(NotificationSoundSerializer(snd).data)

    def delete(self, request, pk):
        snd, err = self._get_owned(request, pk)
        if err: return err
        _delete_sound_files(snd)
        snd.delete()
        return Response({"ok": True})


class NotificationSoundListView(APIView):
    """Каталог активных звуков уведомлений. Клиент сверяет updated_at со
    скачанным и докачивает недостающие файлы — новые звуки добавляются через
    админку без пересборки приложений."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        sounds = NotificationSound.objects.filter(is_active=True)
        return Response(NotificationSoundSerializer(sounds, many=True).data)


class IceServersView(APIView):
    """ICE-конфигурация для WebRTC. TURN-креды берутся из окружения сервера,
    чтобы не зашивать их в сборки приложений и менять без релиза."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        import os
        servers = [{"urls": "stun:stun.l.google.com:19302"}]
        realm = os.getenv("TURN_REALM", "").strip()
        username = os.getenv("TURN_USERNAME", "").strip()
        password = os.getenv("TURN_PASSWORD", "").strip()
        if realm and username and password:
            servers.append({
                "urls": [f"turn:{realm}:3478?transport=udp", f"turn:{realm}:3478?transport=tcp"],
                "username": username,
                "credential": password,
            })
        return Response({"iceServers": servers})


class PushRegisterView(APIView):
    """Регистрация APNs-токена устройства. Профиль берётся из сессии — чужое
    устройство привязать нельзя. Токен уникален: при переустановке приложения
    другим пользователем привязка переезжает."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        token = (request.data.get("token") or "").strip()
        platform = (request.data.get("platform") or "ios").lower()
        if not token:
            return Response({"error": "token обязателен"}, status=400)
        try:
            profile = request.user.profile
        except Profile.DoesNotExist:
            return Response({"error": "Profile not found"}, status=400)
        device, created = PushToken.objects.update_or_create(
            token=token,
            defaults={"user": profile, "platform": platform},
        )
        return Response({"ok": True, "created": created})


# ── Боты: создание/список/удаление (владелец = текущий пользователь) ──────────
# Бот — отдельный класс пользователей (Profile.is_bot). Логина по паролю нет,
# в API ходит по bot_token (см. chat/bot_auth.py). После создания бота его можно
# добавлять в чаты как обычного пользователя, а сам бот читает и шлёт сообщения
# теми же эндпоинтами, авторизуясь заголовком «Authorization: Bot <token>».

def _bot_payload(bot, with_token=False):
    data = {
        "id": str(bot.id),
        "username": bot.username,
        "bio": bot.bio or "",
        "avatar_url": bot.avatar_url,
        "is_bot": True,
        "owner": str(bot.bot_owner_id) if bot.bot_owner_id else None,
        "created_at": bot.created_at,
    }
    if with_token:
        data["token"] = bot.bot_token
    return data


class BotsView(APIView):
    """GET — мои боты (с токенами). POST — создать бота."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        me = getattr(request.user, "profile", None)
        if not me:
            return Response({"error": "Нет профиля"}, status=403)
        bots = Profile.objects.filter(is_bot=True, bot_owner=me).order_by("created_at")
        return Response({"bots": [_bot_payload(b, with_token=True) for b in bots]})

    def post(self, request):
        import secrets
        me = getattr(request.user, "profile", None)
        if not me:
            return Response({"error": "Нет профиля"}, status=403)
        if getattr(me, "is_bot", False):
            return Response({"error": "Бот не может создавать ботов"}, status=403)

        username = (request.data.get("username") or "").strip()
        if len(username) < 2:
            return Response({"error": "Имя бота короче 2 символов"}, status=400)
        if User.objects.filter(username=username).exists() or Profile.objects.filter(username=username).exists():
            return Response({"error": "Имя уже занято"}, status=400)

        token = secrets.token_urlsafe(32)
        user = User.objects.create(username=username, email=f"{username}@bot.local", is_active=True)
        user.set_unusable_password()
        user.save()
        bot = Profile.objects.create(
            user=user,
            username=username,
            is_bot=True,
            bot_owner=me,
            bot_token=token,
            bio=(request.data.get("bio") or "")[:500],
            avatar_url=(request.data.get("avatar_url") or None),
        )
        return Response({"bot": _bot_payload(bot, with_token=True)}, status=201)


class BotDetailView(APIView):
    """POST — перевыпустить токен. DELETE — удалить бота. Только владелец."""
    permission_classes = [permissions.IsAuthenticated]

    def _owned(self, request, pk):
        me = getattr(request.user, "profile", None)
        bot = Profile.objects.filter(pk=pk, is_bot=True).select_related("user").first()
        if not bot:
            return None, Response({"error": "Бот не найден"}, status=404)
        if not me or bot.bot_owner_id != me.id:
            return None, Response({"error": "Это не ваш бот"}, status=403)
        return bot, None

    def post(self, request, pk):
        import secrets
        bot, err = self._owned(request, pk)
        if err:
            return err
        bot.bot_token = secrets.token_urlsafe(32)
        bot.save(update_fields=["bot_token"])
        return Response({"id": str(bot.id), "token": bot.bot_token})

    def delete(self, request, pk):
        bot, err = self._owned(request, pk)
        if err:
            return err
        user = bot.user
        bot.delete()
        if user:
            user.delete()  # каскадом уберёт связанные записи бота
        return Response({"ok": True})


# ── Каналы (kind=channel поверх Chat) ─────────────────────────────────────────
# Вещание «один-ко-многим»: owner/admin публикуют посты (обычные Message),
# подписчики читают, реагируют и комментируют. Постинг гейтится в
# MessageViewSet.create по роли. Пуш подписчикам и WS идут там же.

import re as _re


def _prof(request):
    return getattr(request.user, "profile", None)


def _role_in(chat, profile):
    if not profile:
        return None
    cp = ChatParticipant.objects.filter(chat=chat, user=profile).first()
    return cp.role if cp else None


def _channel_or_none(pk):
    return Chat.objects.filter(pk=pk, kind="channel").first()


def _valid_username(u):
    return bool(_re.match(r"^[A-Za-z0-9_]{3,32}$", u or ""))


def _post_payload(msg, request):
    """Пост канала = Message + сводка реакций/просмотров/комментов."""
    data = MessageSerializer(msg, context={"request": request}).data
    prof = _prof(request)
    aggs = list(msg.reactions.values("value").annotate(c=models.Count("id")).order_by("-c"))
    data["reactions"] = [{"value": a["value"], "count": a["c"]} for a in aggs]
    data["reactions_total"] = sum(a["c"] for a in aggs)
    data["my_reaction"] = None
    if prof:
        mine = msg.reactions.filter(user=prof).first()
        data["my_reaction"] = mine.value if mine else None
    data["comments_count"] = msg.comments.filter(deleted=False).count()
    data["views_count"] = msg.views.count()
    return data


class ChannelsView(APIView):
    """GET — мои каналы. POST — создать канал."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        me = _prof(request)
        chans = Chat.objects.filter(kind="channel", participants=me).order_by("-updated_at")
        return Response({"channels": [ChannelSerializer(c, context={"request": request}).data for c in chans]})

    def post(self, request):
        me = _prof(request)
        if not me:
            return Response({"error": "Нет профиля"}, status=403)
        name = (request.data.get("name") or "").strip()
        if len(name) < 2:
            return Response({"error": "Название канала короче 2 символов"}, status=400)
        username = (request.data.get("username") or "").strip().lstrip("@") or None
        if username is not None:
            if not _valid_username(username):
                return Response({"error": "@username: 3–32 символа, латиница/цифры/подчёркивание"}, status=400)
            if Chat.objects.filter(username__iexact=username).exists():
                return Response({"error": "Такой @username уже занят"}, status=400)
        ch = Chat.objects.create(
            kind="channel", name=name[:100], username=username,
            description=(request.data.get("description") or "")[:500],
            is_public=True,
            sign_posts=str(request.data.get("sign_posts") or "").lower() in ("1", "true", "yes"),
            creator=me,
        )
        ChatParticipant.objects.create(chat=ch, user=me, role="owner")
        ch.subscribers_count = 1
        ch.save(update_fields=["subscribers_count"])
        return Response({"channel": ChannelSerializer(ch, context={"request": request}).data}, status=201)


class ChannelDiscoverView(APIView):
    """GET ?q= — поиск публичных каналов по названию / @username."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        q = (request.query_params.get("q") or "").strip().lstrip("@")
        qs = Chat.objects.filter(kind="channel", is_public=True)
        if q:
            qs = qs.filter(models.Q(name__icontains=q) | models.Q(username__icontains=q))
        qs = qs.order_by("-subscribers_count")[:20]
        return Response({"channels": [ChannelSerializer(c, context={"request": request}).data for c in qs]})


class ChannelDetailView(APIView):
    """GET — инфо + админы. PATCH — правка (owner/admin). DELETE — удалить (owner)."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk):
        ch = _channel_or_none(pk)
        if not ch:
            return Response({"error": "Канал не найден"}, status=404)
        admins = ChatParticipant.objects.filter(chat=ch, role__in=("owner", "admin")).select_related("user")
        data = ChannelSerializer(ch, context={"request": request}).data
        data["admins"] = [
            {"id": str(a.user_id), "username": a.user.username, "role": a.role} for a in admins
        ]
        return Response(data)

    def patch(self, request, pk):
        ch = _channel_or_none(pk)
        if not ch:
            return Response({"error": "Канал не найден"}, status=404)
        me = _prof(request)
        if _role_in(ch, me) not in ("owner", "admin"):
            return Response({"error": "Только админы канала"}, status=403)
        fields = []
        if "name" in request.data:
            nm = (request.data.get("name") or "").strip()
            if len(nm) < 2:
                return Response({"error": "Название короче 2 символов"}, status=400)
            ch.name = nm[:100]; fields.append("name")
        if "description" in request.data:
            ch.description = (request.data.get("description") or "")[:500]; fields.append("description")
        if "avatar_url" in request.data:
            ch.avatar_url = request.data.get("avatar_url") or None; fields.append("avatar_url")
        if "sign_posts" in request.data:
            ch.sign_posts = str(request.data.get("sign_posts")).lower() in ("1", "true", "yes"); fields.append("sign_posts")
        if "username" in request.data:
            username = (request.data.get("username") or "").strip().lstrip("@") or None
            if username is not None:
                if not _valid_username(username):
                    return Response({"error": "Некорректный @username"}, status=400)
                if Chat.objects.filter(username__iexact=username).exclude(pk=ch.pk).exists():
                    return Response({"error": "@username занят"}, status=400)
            ch.username = username; fields.append("username")
        if fields:
            ch.save(update_fields=fields)
        return Response(ChannelSerializer(ch, context={"request": request}).data)

    def delete(self, request, pk):
        ch = _channel_or_none(pk)
        if not ch:
            return Response({"error": "Канал не найден"}, status=404)
        if _role_in(ch, _prof(request)) != "owner":
            return Response({"error": "Удалить канал может только владелец"}, status=403)
        ch.delete()
        return Response({"ok": True})


class ChannelSubscribeView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        ch = _channel_or_none(pk)
        if not ch:
            return Response({"error": "Канал не найден"}, status=404)
        me = _prof(request)
        cp, created = ChatParticipant.objects.get_or_create(chat=ch, user=me, defaults={"role": "subscriber"})
        if created:
            ch.subscribers_count = models.F("subscribers_count") + 1
            ch.save(update_fields=["subscribers_count"])
            ch.refresh_from_db(fields=["subscribers_count"])
        return Response(ChannelSerializer(ch, context={"request": request}).data)


class ChannelLeaveView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        ch = _channel_or_none(pk)
        if not ch:
            return Response({"error": "Канал не найден"}, status=404)
        me = _prof(request)
        cp = ChatParticipant.objects.filter(chat=ch, user=me).first()
        if not cp:
            return Response({"ok": True})
        if cp.role == "owner":
            return Response({"error": "Владелец не может отписаться — удалите канал"}, status=400)
        cp.delete()
        if ch.subscribers_count > 0:
            ch.subscribers_count = models.F("subscribers_count") - 1
            ch.save(update_fields=["subscribers_count"])
        return Response({"ok": True})


class ChannelAdminsView(APIView):
    """GET — список админов. POST {user_id, action:add|remove} — только owner."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk):
        ch = _channel_or_none(pk)
        if not ch:
            return Response({"error": "Канал не найден"}, status=404)
        admins = ChatParticipant.objects.filter(chat=ch, role__in=("owner", "admin")).select_related("user")
        return Response({"admins": [
            {"id": str(a.user_id), "username": a.user.username, "role": a.role, "is_bot": a.user.is_bot} for a in admins
        ]})

    def post(self, request, pk):
        ch = _channel_or_none(pk)
        if not ch:
            return Response({"error": "Канал не найден"}, status=404)
        if _role_in(ch, _prof(request)) != "owner":
            return Response({"error": "Управлять админами может только владелец"}, status=403)
        target = Profile.objects.filter(id=request.data.get("user_id")).first()
        if not target:
            return Response({"error": "Пользователь не найден"}, status=404)
        action = (request.data.get("action") or "add").lower()
        cp, created = ChatParticipant.objects.get_or_create(chat=ch, user=target, defaults={"role": "subscriber"})
        if created:
            ch.subscribers_count = models.F("subscribers_count") + 1
            ch.save(update_fields=["subscribers_count"])
        if cp.role == "owner":
            return Response({"error": "Нельзя менять роль владельца"}, status=400)
        cp.role = "admin" if action == "add" else "subscriber"
        cp.save(update_fields=["role"])
        return Response({"ok": True, "user_id": str(target.id), "role": cp.role})


class ChannelPostsView(APIView):
    """GET — лента канала (последние посты со сводкой откликов)."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk):
        ch = _channel_or_none(pk)
        if not ch:
            return Response({"error": "Канал не найден"}, status=404)
        me = _prof(request)
        if not ch.is_public and _role_in(ch, me) is None:
            return Response({"error": "Канал приватный"}, status=403)
        posts = list(
            Message.objects.filter(chat=ch, deleted_for_all=False)
            .select_related("sender", "sound")
            .order_by("-created_at")[:50]
        )[::-1]
        return Response({"posts": [_post_payload(m, request) for m in posts]})


def _post_or_none(pk):
    return Message.objects.filter(pk=pk).select_related("chat").first()


class PostReactView(APIView):
    """POST {value, kind?} — поставить/сменить реакцию. DELETE — снять."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        msg = _post_or_none(pk)
        if not msg:
            return Response({"error": "Пост не найден"}, status=404)
        me = _prof(request)
        if not ChatParticipant.objects.filter(chat=msg.chat, user=me).exists():
            return Response({"error": "Подпишитесь, чтобы реагировать"}, status=403)
        value = (request.data.get("value") or "").strip()
        if not value:
            return Response({"error": "Пустая реакция"}, status=400)
        PostReaction.objects.update_or_create(
            post=msg, user=me,
            defaults={"value": value[:64], "kind": (request.data.get("kind") or "emoji")[:10]},
        )
        return Response(_post_payload(msg, request))

    def delete(self, request, pk):
        msg = _post_or_none(pk)
        if not msg:
            return Response({"error": "Пост не найден"}, status=404)
        PostReaction.objects.filter(post=msg, user=_prof(request)).delete()
        return Response(_post_payload(msg, request))


class PostCommentsView(APIView):
    """GET — комментарии поста. POST {content, parent?} — добавить."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk):
        msg = _post_or_none(pk)
        if not msg:
            return Response({"error": "Пост не найден"}, status=404)
        comments = msg.comments.filter(deleted=False).select_related("author").order_by("created_at")
        return Response({"comments": PostCommentSerializer(comments, many=True).data})

    def post(self, request, pk):
        msg = _post_or_none(pk)
        if not msg:
            return Response({"error": "Пост не найден"}, status=404)
        me = _prof(request)
        if not ChatParticipant.objects.filter(chat=msg.chat, user=me).exists():
            return Response({"error": "Подпишитесь, чтобы комментировать"}, status=403)
        content = (request.data.get("content") or "").strip()
        if not content:
            return Response({"error": "Пустой комментарий"}, status=400)
        parent = None
        parent_id = request.data.get("parent")
        if parent_id:
            parent = PostComment.objects.filter(id=parent_id, post=msg).first()
        c = PostComment.objects.create(post=msg, author=me, parent=parent, content=content[:2000])
        return Response(PostCommentSerializer(c).data, status=201)


class PostCommentDetailView(APIView):
    """DELETE — удалить коммент (автор или админ канала)."""
    permission_classes = [permissions.IsAuthenticated]

    def delete(self, request, pk):
        c = PostComment.objects.filter(pk=pk).select_related("post", "post__chat").first()
        if not c:
            return Response({"error": "Комментарий не найден"}, status=404)
        me = _prof(request)
        if c.author_id != (me.id if me else None) and _role_in(c.post.chat, me) not in ("owner", "admin"):
            return Response({"error": "Нельзя удалить чужой комментарий"}, status=403)
        c.deleted = True
        c.save(update_fields=["deleted"])
        return Response({"ok": True})


class PostViewMark(APIView):
    """POST — отметить просмотр поста (гость публичного канала тоже считается)."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        msg = _post_or_none(pk)
        if not msg:
            return Response({"error": "Пост не найден"}, status=404)
        me = _prof(request)
        is_participant = ChatParticipant.objects.filter(chat=msg.chat, user=me).exists()
        if not (msg.chat.is_public or is_participant):
            return Response({"error": "Нет доступа"}, status=403)
        PostView.objects.get_or_create(post=msg, user=me)
        return Response({"views_count": msg.views.count()})
