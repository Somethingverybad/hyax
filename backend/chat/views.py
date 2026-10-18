import re
import shutil
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
def _contact_ids(me):
    """Кто со мной в общем чате — личка или группа (каналы не в счёт: там
    подписчики друг друга не знают). Подзапрос, а не список: людей может быть много."""
    if not me:
        return Profile.objects.none().values("id")
    shared = Chat.objects.filter(participants=me, kind__in=["direct", "group"])
    return ChatParticipant.objects.filter(chat__in=shared).values("user_id")


class ProfileViewSet(viewsets.ModelViewSet):
    queryset = Profile.objects.all()
    serializer_class = ProfileSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self):
        # Личные настройки (18+, принятие правил) отдаём и принимаем только в
        # запросах к своему профилю; чужой профиль читается базовым набором.
        if self.action in ('update', 'partial_update', 'me', 'update_me'):
            return OwnProfileSerializer
        return ProfileSerializer

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
        search_query = (self.request.query_params.get('search') or '').strip()

        # Каталога людей нет: подстрочный поиск (icontains) позволял перебирать
        # всех пользователей по одной букве. Ник совпадает целиком — значит,
        # его тебе назвали (участник в группу, админ в канал). Знакомятся
        # по ссылке «Поделиться профилем» (/u/<ник>).
        if search_query:
            q = search_query.lstrip('@')
            # Точное совпадение важнее: есть ники, различающиеся только
            # регистром (EvilTree и eviltree), и без учёта регистра находились
            # оба — а по ссылке открывался случайный.
            exact = queryset.filter(username=q)
            queryset = exact if exact.exists() else queryset.filter(username__iexact=q)
            # «Не показывать меня в поиске» — и по точному нику тоже, кроме тех,
            # с кем уже есть общий чат.
            me0 = getattr(self.request.user, 'profile', None)
            queryset = queryset.filter(Q(hide_from_search=False) | Q(id__in=_contact_ids(me0)))
            queryset = queryset.exclude(Q(is_bot=True, bot_private=True) & ~Q(bot_owner=me0))
            # Ботов по нику не ищут: к боту приходят по ссылке и нажимают
            # «Начать». В поиске бот виден, только если личка с ним уже есть.
            me = getattr(self.request.user, 'profile', None)
            my_direct = Chat.objects.filter(kind='direct', participants=me) if me else Chat.objects.none()
            queryset = queryset.filter(Q(is_bot=False) | Q(chats__in=my_direct)).distinct()
        elif self.action == 'list':
            queryset = queryset.none()

        return queryset

    @action(detail=False, methods=['get'], url_path=r'by-username/(?P<username>[^/]+)',
            permission_classes=[permissions.IsAuthenticated])
    def by_username(self, request, username=None):
        """Публичная карточка для ссылки /u/<ник>."""
        name = (username or '').strip()
        # Сначала точное совпадение с учётом регистра, и только если его нет —
        # без учёта, и лишь когда такой профиль один. Раньше ссылка /u/EvilTree
        # открывала профиль eviltree: он просто стоял первым.
        profile = Profile.objects.filter(username=name).first()
        if profile is None:
            candidates = list(Profile.objects.filter(username__iexact=name)[:2])
            profile = candidates[0] if len(candidates) == 1 else None
        # Приватный бот — только для владельца: остальным его как будто нет.
        if profile is not None and profile.bot_closed_to(getattr(request.user, 'profile', None)):
            profile = None
        if not profile:
            return Response({"error": "Пользователь не найден"}, status=404)
        return Response(PublicProfileSerializer(profile, context={'request': request}).data)

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
            from django.db.models import Exists, OuterRef, Subquery
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
                    last_entities_a=Subquery(last.values('entities')[:1]),
                    last_cipher_a=Subquery(last.values('cipher')[:1]),
                    last_geo_a=Subquery(last.values('geo_lat')[:1]),
                    last_sender_id_a=Subquery(last.values('sender_id')[:1]),
                    last_sticker_a=Subquery(last.values('sticker_id')[:1]),
                    last_sticker_file_a=Subquery(last.values('sticker_file')[:1]),
                    last_voice_a=Subquery(last.values('voice_url')[:1]),
                    last_video_a=Subquery(last.values('video_url')[:1]),
                    last_file_a=Subquery(last.values('file_url')[:1]),
                    last_at_a=Subquery(last.values('created_at')[:1]),
                    last_id_a=Subquery(last.values('id')[:1]),
                    # Моё закрепление: у каждого участника своё.
                    my_pinned_at=Subquery(
                        ChatParticipant.objects
                        .filter(chat=OuterRef('pk'), user=profile)
                        .values('pinned_at')[:1]
                    ),
                    # Мои личные обои (см. ChatSerializer.get_my_wallpaper).
                    my_wp_kind=Subquery(ChatParticipant.objects.filter(chat=OuterRef('pk'), user=profile).values('wallpaper_kind')[:1]),
                    my_wp_url=Subquery(ChatParticipant.objects.filter(chat=OuterRef('pk'), user=profile).values('wallpaper_url')[:1]),
                    my_wp_poster=Subquery(ChatParticipant.objects.filter(chat=OuterRef('pk'), user=profile).values('wallpaper_poster')[:1]),
                    my_wp_anim=Subquery(ChatParticipant.objects.filter(chat=OuterRef('pk'), user=profile).values('wallpaper_anim')[:1]),
                )
                # Прочитал ли последнее сообщение кто-то кроме автора — для
                # второй галки в списке чатов.
                .annotate(last_read_a=Exists(
                    MessageReadStatus.objects
                    .filter(message_id=OuterRef('last_id_a'))
                    .exclude(user_id=OuterRef('last_sender_id_a'))
                ))
                .select_related('pinned_message__sender', 'secret')
                # Закреплённые сверху (позже закреплённый выше), остальные — по
                # времени последнего сообщения. Пустой чат опускается на время
                # создания: иначе он висел бы наверху вечно.
                .order_by(
                    models.F('my_pinned_at').desc(nulls_last=True),
                    models.F('last_at_a').desc(nulls_last=True),
                    '-created_at',
                )
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

    @action(detail=True, methods=['post', 'delete'])
    def pin(self, request, pk=None):
        """POST — закрепить чат вверху списка, DELETE — открепить.

        Закрепление личное: у собеседника порядок свой. Время закрепления
        задаёт порядок среди закреплённых — последний закреплённый сверху.
        """
        profile = getattr(request.user, 'profile', None)
        if not profile:
            return Response({"error": "Profile not found"}, status=400)
        row = ChatParticipant.objects.filter(chat_id=pk, user=profile).first()
        if not row:
            return Response({"error": "Вы не участник этого чата"}, status=404)
        row.pinned_at = timezone.now() if request.method == 'POST' else None
        row.save(update_fields=['pinned_at'])
        return Response({"ok": True, "pinned_at": row.pinned_at.isoformat() if row.pinned_at else None})

    @action(detail=True, methods=['post'])
    def accept_request(self, request, pk=None):
        """Принять запрос на переписку (принимает тот, кого ждёт чат)."""
        me = getattr(request.user, 'profile', None)
        chat = Chat.objects.filter(id=pk, pending_for=me).first() if me else None
        if not chat:
            return Response({"error": "Запрос не найден"}, status=404)
        Chat.objects.filter(id=chat.id).update(pending_for=None, updated_at=timezone.now())
        ids = list(chat.participants.values_list('id', flat=True))
        _user_event(ids, {"type": "chat_request", "chat_id": str(chat.id), "state": "accepted"})
        try:
            from .fcm import notify_profiles
            from .i18n import L
            notify_profiles(Profile.objects.filter(id__in=ids).exclude(id=me.id), title=me.username,
                            body=L("Принял(а) ваш запрос на переписку"), extra={"chat_id": str(chat.id), "kind": "chat_request"})
        except Exception:
            logger.exception("запрос на переписку: пуш о принятии не ушёл")
        chat.refresh_from_db()
        return Response(self.get_serializer(chat).data)

    @action(detail=True, methods=['post'])
    def decline_request(self, request, pk=None):
        """Отклонить запрос: чат удаляется у обоих."""
        me = getattr(request.user, 'profile', None)
        chat = Chat.objects.filter(id=pk, pending_for=me).first() if me else None
        if not chat:
            return Response({"error": "Запрос не найден"}, status=404)
        ids = list(chat.participants.values_list('id', flat=True))
        chat.delete()
        _user_event(ids, {"type": "chat_removed", "chat_id": str(pk), "reason": "declined", "by": str(me.id)})
        return Response({"ok": True})

    def destroy(self, request, *args, **kwargs):
        """Удалить чат (у всех участников). Остальным — событие, чтобы чат
        сразу пропал из списка и закрылся, если открыт."""
        chat = self.get_object()
        me = getattr(request.user, 'profile', None)
        # Группу и канал у всех удаляет только владелец; остальные выходят
        # (старые приложения шлют DELETE и вместо «выйти»).
        if chat.kind == "channel":
            cp = ChatParticipant.objects.filter(chat=chat, user=me).first()
            if cp and cp.role != "owner":
                cp.delete()
                if chat.subscribers_count > 0:
                    Chat.objects.filter(id=chat.id).update(subscribers_count=models.F("subscribers_count") - 1)
                return Response(status=status.HTTP_204_NO_CONTENT)
        elif chat.is_group and me and chat.creator_id != me.id:
            _leave_group(chat, me)
            return Response(status=status.HTTP_204_NO_CONTENT)
        ids = [] if chat.kind == "channel" else list(chat.participants.exclude(id=getattr(me, 'id', None)).values_list('id', flat=True)[:200])
        cid = str(chat.id)
        resp = super().destroy(request, *args, **kwargs)
        _user_event(ids, {"type": "chat_removed", "chat_id": cid, "reason": "deleted", "by": str(getattr(me, "id", ""))})
        return resp

    @action(detail=True, methods=['post'])
    def leave(self, request, pk=None):
        """Выйти из чата"""
        chat = self.get_object()
        try:
            profile = request.user.profile
            if chat.is_group and chat.kind != "channel":
                _leave_group(chat, profile)  # владелец уходит — владение следующему
            else:
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
            return Response({"error": "Добавлять участников может только владелец группы"}, status=403)

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

    @action(detail=True, methods=['post'])
    def remove_participant(self, request, pk=None):
        """Удалить человека из группы — только владелец. Удалённому чат
        пропадает сразу, остальным обновляется состав."""
        chat = self.get_object()
        me = getattr(request.user, 'profile', None)
        if not me:
            return Response({"error": "Profile not found"}, status=400)
        if not chat.is_group or chat.kind == "channel":
            return Response({"error": "Это не группа"}, status=400)
        if chat.creator_id != me.id:
            return Response({"error": "Удалять участников может только владелец группы"}, status=403)
        try:
            uid = uuid.UUID(str(request.data.get('user_id') or ''))
        except ValueError:
            return Response({"error": "Участник не найден"}, status=404)
        if uid == me.id:
            return Response({"error": "Себя удалить нельзя — выйдите из группы"}, status=400)
        cp = ChatParticipant.objects.filter(chat=chat, user_id=uid).first()
        if not cp:
            return Response({"error": "Участник не найден"}, status=404)
        cp.delete()
        _user_event([uid], {"type": "chat_removed", "chat_id": str(chat.id), "reason": "removed", "by": str(me.id)})
        _user_event(list(ChatParticipant.objects.filter(chat=chat).exclude(user=me).values_list('user_id', flat=True)),
                    {"type": "group_updated", "chat_id": str(chat.id)})
        return Response({"ok": True})

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
            return Response({"error": "Настраивать группу может только владелец"}, status=403)

        fields = []
        name = request.data.get('name')
        if name is not None:
            chat.name = str(name).strip()[:100]
            fields.append('name')
        avatar_url = request.data.get('avatar_url')
        if avatar_url is not None:
            chat.avatar_url = avatar_url or None
            fields.append('avatar_url')
        if 'notify_sound_id' in request.data:
            # Один звук на всю группу: с ним приходят все её сообщения у всех.
            sid = request.data.get('notify_sound_id')
            chat.notify_sound = NotificationSound.objects.filter(id=sid, is_active=True).first() if sid else None
            fields.append('notify_sound')
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
            
        
        _me = getattr(request.user, 'profile', None)
        if _me is not None and _me.is_bot:
            return Response({'detail': 'Бот не пишет первым: человек должен нажать «Начать» на карточке бота'}, status=403)
        _raw = request.data.get('participants', [])
        _ids = [str(x) for x in (_raw if isinstance(_raw, list) else [_raw]) if x]
        if _ids and _me is not None:
            try:
                if Profile.objects.filter(id__in=_ids, is_bot=True, bot_private=True).exclude(bot_owner=_me).exists():
                    return Response({'detail': 'Бот не найден'}, status=404)
            except Exception:
                pass  # кривой id участника — дальше разберётся обычная проверка
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
        # Личка при блокировке в любую сторону не создаётся: иначе один писал
        # бы в пустоту, а второй получал бы новый чат от того, кого закрыл.
        if len(participant_uuids) == 2:
            from .moderation import blocked_either_way
            if blocked_either_way(participant_uuids[0], participant_uuids[1]):
                return Response({'detail': 'Нельзя написать этому пользователю'}, status=status.HTTP_403_FORBIDDEN)

        existing_chats = Chat.objects.annotate(
            participant_count=models.Count('participants'),
            matching_participants=models.Count(
                'participants',
                filter=models.Q(participants__id__in=participant_uuids)
            )
        ).filter(
            participant_count=len(participant_uuids),
            matching_participants=len(participant_uuids),
            # Только обычная личка: секретный чат или группа из тех же двух
            # людей — другой чат. Иначе после удаления обычной лички при живом
            # секретном чате новую было не создать — возвращался секретный.
            kind='direct', is_group=False,
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
        
        # Создаем новый чат. У собеседника включено «Подтверждать новые чаты» —
        # чат приходит запросом: писать и звонить нельзя, пока он не примет.
        me_profile = next((p for p in existing_profiles if p.user_id == request.user.id), None)
        target = next((p for p in existing_profiles if me_profile is None or p.id != me_profile.id), None)
        needs_ok = bool(me_profile and target and target.confirm_chats and not target.is_bot and not me_profile.is_bot)
        chat = Chat.objects.create(pending_for=target if needs_ok else None)
        chat.participants.set(existing_profiles)
        if needs_ok:
            _chat_request_notify(chat, me_profile, target)

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

def _user_event(profile_ids, data):
    """Событие в личные сокеты (user_<id>) — список чатов и открытый чат
    обновляются сразу."""
    try:
        from channels.layers import get_channel_layer
        from asgiref.sync import async_to_sync
        layer = get_channel_layer()
        if not layer:
            return
        for pid in profile_ids:
            async_to_sync(layer.group_send)(f'user_{pid}', {'type': 'notification', 'data': data})
    except Exception:
        logger.exception("событие пользователю не ушло")


def _leave_group(chat, me):
    """Выйти из группы. Уходит владелец — владельцем становится тот, кто в
    группе дольше всех; ушёл последний — группа удаляется."""
    ChatParticipant.objects.filter(chat=chat, user=me).delete()
    rest = ChatParticipant.objects.filter(chat=chat).order_by('joined_at')
    first = rest.first()
    if not first:
        chat.delete()
        return
    if not chat.creator_id or chat.creator_id == me.id:
        Chat.objects.filter(id=chat.id).update(creator_id=first.user_id)
    _user_event(list(rest.values_list('user_id', flat=True)), {"type": "group_updated", "chat_id": str(chat.id)})


def _chat_request_notify(chat, requester, target):
    """Запрос на переписку: тому, кого ждём, — событие и пуш."""
    _user_event([target.id], {"type": "chat_request", "chat_id": str(chat.id), "state": "pending",
                              "from_username": requester.username})
    try:
        from .fcm import notify_profiles
        from .i18n import L
        notify_profiles(Profile.objects.filter(id=target.id), title=requester.username,
                        body=L("Хочет начать с вами переписку"), extra={"chat_id": str(chat.id), "kind": "chat_request"})
    except Exception:
        logger.exception("запрос на переписку: пуш не ушёл")


def broadcast_read(chat_id, reader):
    """Сообщить остальным участникам, что reader прочитал чат: у авторов
    сообщений вторая галка загорается сразу, без перезагрузки ленты. Шлётся в
    личные группы user_<id>, как реакции, — сокет конкретного чата открыт не
    всегда, а галка в списке чатов тоже должна обновиться."""
    try:
        from channels.layers import get_channel_layer
        from asgiref.sync import async_to_sync
        layer = get_channel_layer()
        if not layer:
            return
        data = {
            'type': 'read',
            'chat_id': str(chat_id),
            'reader_id': str(reader.id),
            'read_at': timezone.now().isoformat(),
        }
        for uid in ChatParticipant.objects.filter(chat_id=chat_id).exclude(user=reader).values_list('user_id', flat=True):
            async_to_sync(layer.group_send)(f'user_{uid}', {'type': 'notification', 'data': data})
    except Exception:
        logger.exception("прочтение: рассылка не удалась")


def _mark_chat_read_for(chat, profile):
    """Помечает прочитанными все чужие сообщения чата для profile. Вызывается,
    когда человек сам пишет в чат: раз ответил — значит, видел. Иначе входящие,
    пришедшие пока чат был открыт, оставались «непрочитанными» и в списке чатов
    висел бейдж поверх собственного последнего сообщения."""
    try:
        unread = list(Message.objects.filter(chat=chat).exclude(Q(read_statuses__user=profile) | Q(sender=profile)))
        now = timezone.now()
        MessageReadStatus.objects.bulk_create(
            [MessageReadStatus(message=m, user=profile, read_at=now) for m in unread], ignore_conflicts=True,
        )
        if unread:
            broadcast_read(chat.id, profile)
    except Exception:
        logger.exception("mark_chat_read_for failed")


def _forward_copy(src, target, profile, album_id=None):
    """Копия сообщения в другой чат. Копируем содержимое, а не ссылаемся на
    оригинал: удаление исходника пересланное не трогает. Заголовок «от кого» —
    первоисточник, цепочку пересылок не наращиваем, как и мессенджеры."""
    origin = src.forwarded_from or src.sender
    title = src.forwarded_title
    fchat = src.forwarded_chat
    if not title:
        if src.chat.kind == "channel":
            # Из канала — всегда «Переслано из «Канал»»: читатель видит, откуда
            # пост, и по тапу открывает канал. Автора помним, только если канал
            # подписывает посты, — тогда он идёт вторым («Канал · автор»).
            title = src.chat.name or "Канал"
            origin = src.sender if (src.chat.sign_posts and src.sender) else None
            fchat = src.chat
        else:
            title = origin.username if origin else "Неизвестный"
    return Message.objects.create(
        chat=target,
        sender=profile,
        content=src.content,
        entities=getattr(src, 'entities', None) or [],
        file_url=src.file_url,
        file_name=src.file_name,
        file_size=src.file_size,
        file_width=getattr(src, 'file_width', None),
        file_height=getattr(src, 'file_height', None),
        poster_url=getattr(src, 'poster_url', None),
        sticker=src.sticker,
        sticker_file=getattr(src, 'sticker_file', "") or (src.sticker.file_url if src.sticker_id else ""),
        voice_url=src.voice_url,
        voice_duration=src.voice_duration,
        video_url=src.video_url,
        video_duration=src.video_duration,
        video_mirror=src.video_mirror,
        video_flip=src.video_flip,
        download_only=src.download_only,
        album_id=album_id,
        forwarded_from=origin,
        forwarded_title=title[:120],
        forwarded_chat=fchat,
    )


def _socket_new_message(message, request):
    """Только в сокет чата, без пуша — для остальных сообщений пакета."""
    try:
        from channels.layers import get_channel_layer
        from asgiref.sync import async_to_sync
        layer = get_channel_layer()
        if layer:
            async_to_sync(layer.group_send)(
                f'chat_{message.chat.id}',
                {'type': 'chat_message', 'message': MessageSerializer(message, context={'request': request}).data},
            )
    except Exception:
        logger.exception("пакетная пересылка: сокет не ответил")


def _notify_new_message(message, profile, request):
    _mark_chat_read_for(message.chat, profile)
    # Стена: подписчиков нет, читают все по запросу — рассылать некому.
    if getattr(message.chat, "kind", "") == "wall":
        return
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
        from .presence import viewers
        # У кого этот чат открыт — пуш не нужен: сообщение он и так видит, а
        # звук аудио-стикера проиграет само приложение (см. ChatWindow).
        watching = viewers(message.chat.id)
        recipients = message.chat.participants.exclude(id=profile.id)
        # Кто заблокировал отправителя — пуш о его сообщении не получает.
        recipients = recipients.exclude(blocks__blocked_id=profile.id)
        recipients = _without_muted(message.chat, recipients)
        # Скрыл «Долгий ящик» — его бот больше не пушит.
        if getattr(message.chat, "kind", "") == "ideabox":
            recipients = recipients.exclude(ideabox_enabled=False)
        if watching:
            recipients = recipients.exclude(id__in=watching)
            logger.info("push: чат открыт у %d — пуш им не шлю", len(watching))
        from .formatting import mask_preview
        from .i18n import L, clip, render
        # Подписи вместо текста — L(...): каждому получателю на его языке
        # (notify_profiles делит получателей по Profile.language).
        preview = mask_preview(message.content or "", getattr(message, "entities", None)).strip()
        if getattr(message, "geo_lat", None) is not None:
            preview = L("📍 Геопозиция")
        if getattr(message.chat, "kind", "") == "secret":
            preview = L("Новое сообщение в секретном чате")
        if not preview:
            if message.sticker_id:
                preview = L("Стикер")
            elif getattr(message, "video_url", None):
                preview = L("Видео-сообщение")
            elif getattr(message, "voice_url", None):
                preview = L("Голосовое сообщение")
            elif getattr(message, "file_url", None):
                preview = L("Файл")
            else:
                preview = L("Новое сообщение")
        # У поста канала заголовок пуша — имя канала, а не автора.
        push_title = message.chat.name if getattr(message.chat, "kind", "") == "channel" else profile.username
        # Чат «Долгого ящика» и системные («Идеи», «Жалобы»): имя бота и чата
        # из базы по-русски — в пуше переводим.
        if getattr(message.chat, "kind", "") == "ideabox" and getattr(profile, "is_bot", False):
            push_title = L(profile.username)
        # Группа: заголовок — название группы, в тексте — кто написал. Так по
        # пушу сразу видно, что это из группы, а не лично.
        is_group_chat = bool(getattr(message.chat, "is_group", False)) and getattr(message.chat, "kind", "") != "channel"
        if is_group_chat:
            push_title = (message.chat.name or "").strip() or L("Группа")
            if getattr(message.chat, "kind", "") == "system":
                push_title = L(push_title)
            if not message.action_id:
                _pv, _who = preview, profile.username
                preview = lambda lang: f"{_who}: {render(_pv, lang)}"
        # Действие: адресату — «подмигивает вам», остальным в группе — «подмигивает Имя».
        if message.action_id and message.action_target_id:
            _act = message.action
            _tgt = recipients.filter(id=message.action_target_id)
            for _t in _tgt:
                # Адресату — на его языке: «подмигивает вам» / «winks at you» / «…당신에게…».
                _lang = (getattr(_t, "language", "") or "")[:2]
                _you = {"en": "you", "ko": "당신"}.get(_lang, "вам")
                notify_profiles(Profile.objects.filter(id=_t.id), title=push_title,
                                body=f"{_act.emoji} {_act.phrase(_lang, profile.username, _you, view='you')}"[:150],
                                extra={"chat_id": str(message.chat.id)},
                                sound=(message.chat.notify_sound.slug if getattr(message.chat, 'notify_sound_id', None)
                                       else profile.notify_sound.slug if getattr(profile, 'notify_sound_id', None) else None))
            recipients = recipients.exclude(id=message.action_target_id)
            # Остальным в группе — «Вася подмигивает Пете» на их языке.
            _who, _whom = profile.username, message.action_target.username
            preview = lambda lang: f"{_act.emoji} {_act.phrase(lang, _who, _whom)}"
        # Запомнить, кому ушёл пуш по этому чату: прочитают — уберём его
        # с экрана тихим пушем chat_read (см. mark_chat_as_read).
        from .presence import note_pushed
        note_pushed(list(recipients.values_list("id", flat=True)), message.chat.id)
        notify_profiles(
            recipients,
            title=push_title,
            body=clip(preview, 150),
            extra={"chat_id": str(message.chat.id)},
            # Звук: аудио-стикер поста, иначе звук канала, иначе «мой звук»
            # отправителя. У канала свой — подписчики узнают его по звуку.
            sound=(message.sound.slug if message.sound_id
                   else message.chat.notify_sound.slug if getattr(message.chat, 'notify_sound_id', None)
                   else profile.notify_sound.slug if getattr(profile, 'notify_sound_id', None) else None),
            # Кому выключено превью — «Новое сообщение» вместо текста.
            hide_body_for=set(recipients.filter(push_preview=False).values_list("id", flat=True)),
            # Звук приложили к сообщению специально — играет и у тех, кто
            # выключил звук уведомлений.
            keep_sound=bool(message.sound_id),
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
                        # Чей это чат — для баннера на десктопе: у поста канала
                        # заголовок — канал, а не автор (как и в пуше).
                        'chat_kind': message.chat.kind,
                        'chat_name': message.chat.name or "",
                        'chat_avatar': message.chat.avatar_url or "",
                        'message': message_data,
                    },
                }
            )


def _push_reaction(message, reactor, emoji):
    """Пуш автору сообщения: на него отреагировали.

    Себе не шлём, заблокировавшему — тоже, и тому, у кого этот чат открыт:
    он и так видит реакцию (то же правило, что у новых сообщений).
    """
    author = message.sender
    if not author or author.id == reactor.id:
        return
    try:
        from .fcm import notify_profiles
        from .presence import viewers
        from .moderation import blocked_either_way
        if blocked_either_way(author.id, reactor.id):
            return
        if str(author.id) in viewers(message.chat_id):
            return
        from .formatting import mask_preview
        from .i18n import L, clip
        preview = mask_preview(message.content or "", getattr(message, "entities", None)).strip()
        if not preview:
            preview = L("Стикер" if message.sticker_id else
                        "Видео-сообщение" if getattr(message, "video_url", None) else
                        "Голосовое сообщение" if getattr(message, "voice_url", None) else
                        "Файл" if getattr(message, "file_url", None) else "сообщение")
        notify_profiles(
            Profile.objects.filter(id=author.id),
            title=reactor.username,
            # На языке автора: «❤️ на «…»» / «Reacted ❤️ to “…”».
            body=L("{emoji} на «{text}»", emoji=emoji, text=clip(preview, 60)),
            extra={"chat_id": str(message.chat_id), "kind": "reaction"},
            hide_body_for=set(
                Profile.objects.filter(id=author.id, push_preview=False).values_list("id", flat=True)
            ),
        )
    except Exception:
        logger.exception("реакции: пуш не ушёл")


def _notify_reactions(message):
    """Разослать сводку реакций участникам чата.

    В личные сокеты, а не в сокет чата: клиент подключается только к
    личному каналу (см. pages/Chat.tsx), а обычная синхронизация реакции
    не приносит — она не меняет само сообщение.

    В сводке — кто поставил: по этому списку каждый находит свои реакции,
    и это же показывают мессенджеры при долгом нажатии на реакцию.
    """
    from channels.layers import get_channel_layer
    from asgiref.sync import async_to_sync
    from .reactions import ALL

    layer = get_channel_layer()
    if not layer:
        return
    order = {emoji: i for i, (emoji, _) in enumerate(ALL)}
    groups = {}
    for r in message.reactions.all():
        groups.setdefault(r.value, []).append(str(r.user_id))
    payload = [
        {"emoji": e, "count": len(users), "users": users}
        for e, users in sorted(groups.items(), key=lambda kv: (order.get(kv[0], 99), kv[0]))
    ]
    try:
        for row in ChatParticipant.objects.filter(chat_id=message.chat_id):
            async_to_sync(layer.group_send)(
                f'user_{row.user_id}',
                {
                    'type': 'notification',
                    'data': {
                        'type': 'reaction',
                        'chat_id': str(message.chat_id),
                        'message_id': str(message.id),
                        'reactions': payload,
                    },
                },
            )
    except Exception:
        logger.exception("реакции: рассылка не удалась")


def _without_muted(chat, recipients):
    """Убрать тех, кто выключил уведомления этого чата (ChatParticipant.muted):
    сообщение они увидят в ленте, пуш и звук им не нужны."""
    muted_ids = ChatParticipant.objects.filter(chat=chat, muted=True).values_list("user_id", flat=True)
    return recipients.exclude(id__in=muted_ids)


def _can_see_chat(chat, profile):
    """Читать чат может участник; публичный канал и Стена — любой."""
    if chat.kind == "wall":
        return True
    if ChatParticipant.objects.filter(chat=chat, user=profile).exists():
        return True
    return chat.kind == "channel" and chat.is_public


def _can_post_to(chat, profile):
    """Писать в чат может участник; в канал — только owner/admin; на Стену —
    любой, кому не запретили (chat/wall.py)."""
    if chat.kind == "wall":
        from .wall import wall_ban
        return wall_ban(profile) is None
    if getattr(chat, "pending_for_id", None):
        return False  # запрос на переписку ещё не принят
    cp = ChatParticipant.objects.filter(chat=chat, user=profile).first()
    if not cp:
        return False
    if chat.kind == "channel":
        return cp.role in ("owner", "admin")
    return True


# Разделы «Медиа и файлы» чата: по расширению вложения (оно есть и в s3://,
# и в /media/...). Видео-сообщения («треугольники») — к видео.
MEDIA_KINDS = ("photo", "video", "music", "voice", "file")
_IMG_RE = r"\.(jpe?g|png|webp|gif|heic|heif|bmp|avif)(\?.*)?$"
_VID_RE = r"\.(mp4|mov|m4v|webm|mkv|3gp)(\?.*)?$"
_AUD_RE = r"\.(mp3|m4a|aac|ogg|oga|opus|flac|wav|weba|aiff?)(\?.*)?$"


def _media_q(kind):
    has_file = models.Q(file_url__isnull=False) & ~models.Q(file_url="")
    img = has_file & models.Q(file_url__iregex=_IMG_RE)
    vid = has_file & models.Q(file_url__iregex=_VID_RE)
    aud = has_file & models.Q(file_url__iregex=_AUD_RE)
    if kind == "photo":
        return img & models.Q(download_only=False)
    if kind == "video":
        return (vid & models.Q(download_only=False)) | (models.Q(video_url__isnull=False) & ~models.Q(video_url=""))
    if kind == "music":
        return aud
    if kind == "voice":
        return models.Q(voice_url__isnull=False) & ~models.Q(voice_url="")
    # Файлы — всё прочее и картинки/видео, отправленные «Файлом».
    return has_file & ~aud & (models.Q(download_only=True) | (~models.Q(file_url__iregex=_IMG_RE) & ~models.Q(file_url__iregex=_VID_RE)))


class MessageViewSet(viewsets.ModelViewSet):
    serializer_class = MessageSerializer
    queryset = Message.objects.all()
    # Стандартные PUT/PATCH/DELETE закрыты: правка — действие edit (только
    # автор), удаление — remove (мягкое, с рассылкой). Раньше через них любой
    # вошедший мог переписать или стереть из базы чужое сообщение.
    http_method_names = ['get', 'post', 'head', 'options']
    
    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['request'] = self.request
        return context
    
    def get_queryset(self):
        queryset = Message.objects.select_related('sender__notify_sound').prefetch_related('read_statuses__user')
        me = getattr(self.request.user, 'profile', None)
        if me is None:
            return Message.objects.none()
        # Только сообщения чатов, которые мне видны: где я участник, Стена и
        # публичные каналы. Раньше фильтра не было — список без chat отдавал
        # сообщения всех чатов, а по id читалось любое.
        queryset = queryset.annotate(
            _member=models.Exists(ChatParticipant.objects.filter(chat_id=models.OuterRef('chat_id'), user=me)),
            # Глюк-стикер уже разыгран у меня — см. MessageSerializer.get_effect_seen.
            _effect_seen=models.Exists(MessageEffectSeen.objects.filter(message_id=models.OuterRef('pk'), user=me)),
        ).filter(models.Q(_member=True) | models.Q(chat__kind='wall') | models.Q(chat__kind='channel', chat__is_public=True))
        chat_id = self.request.query_params.get('chat')
        if chat_id:
            queryset = queryset.filter(chat_id=chat_id)
        elif getattr(self, 'action', None) == 'list':
            return Message.objects.none()  # ленту отдаём только по конкретному чату
        # Скрываем удалённые: у всех — для каждого; «у себя» — для того, кто удалил.
        queryset = queryset.exclude(deleted_for_all=True)
        try:
            me = self.request.user.profile
            queryset = queryset.exclude(deleted_for=me)
            # Заблокированные: их сообщения для меня не существуют.
            from .moderation import blocked_ids
            blocked = blocked_ids(me)
            if blocked:
                queryset = queryset.exclude(sender_id__in=blocked)
        except Exception:
            pass
        return queryset.order_by('created_at')

    @action(detail=False, methods=['get'], url_path='media')
    def media(self, request):
        """Медиа чата по разделам: GET ?chat=<id>&type=photo|video|music|voice|file
        [&before=<ISO>&limit=60] → {results, has_more[, counts]} — новые первыми.
        Видимость — как у ленты (удалённые, «у себя», заблокированные).
        Секретный чат сервер не разберёт: вложения там зашифрованы."""
        chat_id = request.query_params.get('chat')
        kind = request.query_params.get('type') or 'photo'
        if not chat_id or kind not in MEDIA_KINDS:
            return Response({"error": "Нужны chat и type"}, status=400)
        base = self.get_queryset().filter(models.Q(cipher__isnull=True) | models.Q(cipher=''))
        counts = None
        if not request.query_params.get('before'):
            counts = {k: base.filter(_media_q(k)).count() for k in MEDIA_KINDS}
        qs = base.filter(_media_q(kind)).order_by('-created_at')
        before = request.query_params.get('before')
        if before:
            from django.utils.dateparse import parse_datetime
            dt = parse_datetime(before)
            if dt:
                qs = qs.filter(created_at__lt=dt)
        try:
            limit = max(1, min(100, int(request.query_params.get('limit') or 60)))
        except ValueError:
            limit = 60
        rows = list(qs[:limit + 1])
        out = {
            "results": MessageSerializer(rows[:limit], many=True, context={'request': request}).data,
            "has_more": len(rows) > limit,
        }
        if counts is not None:
            out["counts"] = counts
        return Response(out)

    @action(detail=False, methods=['post'], url_path='effects_seen')
    def effects_seen(self, request):
        """Эффекты получения разыграны: {"ids": [...]} — запоминаем у себя на
        сервере, чтобы ни это, ни другие мои устройства (и переустановленное
        приложение) не играли их снова. Только видимые мне чужие сообщения с
        эффектом; повторная отметка ничего не меняет."""
        me = request.user.profile
        ids = request.data.get('ids') or []
        if not isinstance(ids, list):
            return Response({'error': 'ids — список'}, status=400)
        valid = []
        for i in ids[:200]:
            try:
                valid.append(str(uuid.UUID(str(i))))
            except ValueError:
                continue  # чужой мусор в списке не валит весь запрос
        msgs = list(self.get_queryset().filter(id__in=valid).exclude(effect='').exclude(sender=me).values_list('id', flat=True))
        MessageEffectSeen.objects.bulk_create(
            [MessageEffectSeen(message_id=m, user=me) for m in msgs], ignore_conflicts=True)
        return Response({'ok': True, 'count': len(msgs)})

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
            # У всех — автор; в канале ещё владелец и админы: пост чужого
            # админа или уволенного автора иначе было бы не убрать. Подписчикам
            # удаление доедет обычной синхронизацией — save() двигает updated_at.
            from .serializers import is_admin_profile
            if msg.sender_id != profile.id and not (msg.chat.kind == "channel" and _can_post_to(msg.chat, profile)) \
                    and not (msg.chat.kind == "wall" and is_admin_profile(profile)):
                return Response({"error": "Удалить у всех может только автор"}, status=403)
            msg.deleted_for_all = True
            msg.save(update_fields=['deleted_for_all', 'updated_at'])
            from .ideabox import relay_delete
            relay_delete(msg)
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
        # Секретный чат: новый шифротекст вместо текста.
        if msg.chat.kind == 'secret':
            import re as _re
            cipher = str(request.data.get('cipher') or '')
            if not cipher or len(cipher) > 64 * 1024 or not _re.fullmatch(r"[A-Za-z0-9+/=]+", cipher):
                return Response({"error": "Нет шифротекста"}, status=400)
            msg.cipher = cipher
            msg.is_edited = True
            msg.save(update_fields=['cipher', 'is_edited', 'updated_at'])
            return Response(MessageSerializer(msg, context={'request': request}).data)
        content = (request.data.get('content') or '').strip()
        if not content:
            return Response({"error": "Пустой текст"}, status=400)
        msg.content = content
        # Оформление присылают вместе с текстом; без поля — снимаем старое,
        # его диапазоны к новому тексту уже не подходят.
        from .formatting import clean_entities, resolve_custom_emoji
        msg.entities = resolve_custom_emoji(clean_entities(request.data.get('entities'), content))
        msg.is_edited = True
        msg.translations = {}
        msg.save(update_fields=['content', 'entities', 'translations', 'is_edited', 'updated_at'])
        # Идея и ответ на неё живут в двух чатах — правка доезжает до копии.
        from .ideabox import relay_edit
        relay_edit(msg)
        from .translate import schedule as _schedule_translation
        _schedule_translation(msg, profile, request)
        from .mentions import store_mentions
        store_mentions(msg)
        return Response(MessageSerializer(msg, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def transcribe(self, request, pk=None):
        """Расшифровать голосовое — любой, кто видит чат. Идёт в фоне;
        готовый текст приезжает через /messages/sync/ (updated_at)."""
        from .transcribe import transcribe_async, too_long, TOO_LONG_ERROR
        msg = self.get_object()
        if msg.chat.kind == 'secret':
            return Response({"error": "Голосовые секретного чата сервер не расшифрует"}, status=400)
        if too_long(msg):
            return Response({"error": TOO_LONG_ERROR, "too_long": True}, status=422)
        profile = getattr(request.user, 'profile', None)
        if profile is None or not _can_see_chat(msg.chat, profile):
            return Response({"error": "Нет доступа"}, status=403)
        if not msg.voice_url:
            return Response({"error": "Это не голосовое"}, status=400)
        # Расшифровка личная: запоминаем, кто попросил, — остальным текст не
        # показываем (MessageSerializer.to_representation).
        me = str(profile.id)
        update = []
        if me not in (msg.transcript_for or []):
            msg.transcript_for = [*(msg.transcript_for or []), me]
            update.append('transcript_for')
        if msg.transcript_status not in ('done', 'pending'):
            msg.transcript_status = 'pending'
            update.append('transcript_status')
        if update:
            msg.save(update_fields=[*update, 'updated_at'])
        if 'transcript_status' in update:
            transcribe_async(msg.id)
        elif msg.transcript_status == 'done' and 'transcript_for' in update:
            # Расшифровка уже есть, попросил новый человек — переведём ему, если надо.
            from .translate import schedule_transcript
            schedule_transcript(msg.id)
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

    @action(detail=True, methods=['get'])
    def viewers(self, request, pk=None):
        """Кто прочитал и кто какие реакции поставил — поимённо.

        Прочитавшие со статусом «Скрыт» (hide_online) в список не попадают:
        просмотр у них не засчитывается. Реакции — публичное действие, они
        видны у всех. Сам автор среди прочитавших не показывается."""
        msg = self.get_object()
        try:
            profile = request.user.profile
        except Profile.DoesNotExist:
            return Response({"error": "Profile not found"}, status=400)
        if not _can_see_chat(msg.chat, profile):
            return Response({"error": "Нет доступа к сообщению"}, status=403)
        readers = (MessageReadStatus.objects.filter(message=msg)
                   .exclude(user_id=msg.sender_id).exclude(user__hide_online=True)
                   .select_related("user").order_by("-read_at")[:200])
        read_by = [{"id": str(r.user_id), "username": r.user.username, "avatar_url": r.user.avatar_url, "read_at": r.read_at.isoformat()} for r in readers]
        from .reactions import ALL
        order = {emoji: i for i, (emoji, _) in enumerate(ALL)}
        grouped = {}
        for r in msg.reactions.select_related("user").order_by("created_at"):
            grouped.setdefault(r.value, []).append({"id": str(r.user_id), "username": r.user.username, "avatar_url": r.user.avatar_url, "at": r.created_at.isoformat()})
        reactions = [{"emoji": e, "users": u} for e, u in sorted(grouped.items(), key=lambda kv: (order.get(kv[0], 99), kv[0]))]
        return Response({"read_by": read_by, "reactions": reactions})

    @action(detail=True, methods=['post'])
    def press(self, request, pk=None):
        """Нажатие на кнопку под сообщением: {data} уходит боту-автору.

        В историю не пишем — это сигнал, а не сообщение: бот сам решит, что
        ответить. Нажать может только тот, кто видит чат.
        """
        msg = self.get_object()
        try:
            profile = request.user.profile
        except Profile.DoesNotExist:
            return Response({"error": "Profile not found"}, status=400)
        if not _can_see_chat(msg.chat, profile):
            return Response({"error": "Нет доступа к сообщению"}, status=403)
        data = str(request.data.get('data') or '').strip()[:128]
        allowed = {b.get('data') for row in (msg.buttons or []) for b in row}
        if not data or data not in allowed:
            return Response({"error": "Такой кнопки нет"}, status=400)
        if not msg.sender or not msg.sender.is_bot:
            return Response({"error": "Эти кнопки никому не адресованы"}, status=400)
        # «Долгий ящик» — наш бот: кнопки обрабатываем здесь же, а не сокетом.
        if msg.chat.kind == 'ideabox':
            from .ideabox import handle_press
            caps = request.data.get('caps') or []
            out = handle_press(msg, profile, data, request, caps if isinstance(caps, list) else [])
            return Response(out, status=400 if out.get("error") else 200)

        from channels.layers import get_channel_layer
        from asgiref.sync import async_to_sync
        layer = get_channel_layer()
        if layer:
            async_to_sync(layer.group_send)(
                f'user_{msg.sender_id}',
                {
                    'type': 'notification',
                    'data': {
                        'type': 'button',
                        'chat_id': str(msg.chat_id),
                        'message_id': str(msg.id),
                        'data': data,
                        'from_id': str(profile.id),
                        'from_username': profile.username,
                    },
                },
            )
        return Response({"ok": True})

    @action(detail=True, methods=['post'])
    def react(self, request, pk=None):
        """Поставить или снять реакцию: {emoji}. Повторное нажатие снимает.

        Разных реакций от одного человека — не больше Profile.reaction_limit
        (по умолчанию три). Набор эмодзи закрытый: chat/reactions.py.
        """
        from .reactions import ALLOWED
        from .serializers import reactions_payload
        msg = self.get_object()
        try:
            profile = request.user.profile
        except Profile.DoesNotExist:
            return Response({"error": "Profile not found"}, status=400)
        if not _can_see_chat(msg.chat, profile):
            return Response({"error": "Нет доступа к сообщению"}, status=403)
        emoji = (request.data.get('emoji') or '').strip()
        if emoji not in ALLOWED:
            return Response({"error": "Такой реакции нет"}, status=400)

        # Повторное нажатие снимает реакцию; разных — не больше предела профиля.
        removed = PostReaction.objects.filter(post=msg, user=profile, value=emoji).delete()[0]
        if not removed:
            limit = profile.reaction_limit or 3
            if PostReaction.objects.filter(post=msg, user=profile).count() >= limit:
                return Response(
                    {"error": "Больше реакций на это сообщение поставить нельзя",
                     "limit": limit},
                    status=409,
                )
            PostReaction.objects.create(post=msg, user=profile, value=emoji, kind="emoji")

        # Помечаем сообщение изменённым: обычная синхронизация (since=…)
        # приносит только то, что менялось, и без этого реакция не доезжала
        # до того, у кого чат был закрыт — событие он пропустил, а лента
        # открывалась из кеша. Теперь реакция приедет и без события.
        msg.save(update_fields=["updated_at"])
        msg.refresh_from_db()
        _notify_reactions(msg)
        if not removed:
            _push_reaction(msg, profile, emoji)
        if msg.chat.kind in ("channel", "wall"):
            _touch_post(msg)
        return Response({"reactions": reactions_payload(msg, profile.id)})

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
        if src.chat.kind == 'secret' or target.kind == 'secret':
            return Response({"error": "Секретные сообщения не пересылаются"}, status=403)
        if not _can_post_to(target, profile):
            return Response({"error": "В этот чат нельзя написать"}, status=403)

        message = _forward_copy(src, target, profile)
        Chat.objects.filter(id=target.id).update(updated_at=timezone.now())
        _notify_new_message(message, profile, request)
        from .translate import schedule as _schedule_translation
        _schedule_translation(message, profile, request)  # автоперевод в личке, в фоне
        return Response(MessageSerializer(message, context={'request': request}).data, status=201)

    @action(detail=False, methods=['post'])
    def forward_many(self, request):
        """Переслать несколько сообщений одним пакетом ({message_ids, chat_id}).
        Копии получают общий album_id — клиент склеивает их в один пузырь,
        как альбом фотографий. Порядок — по времени исходников, а не по тому,
        в каком порядке их отметили."""
        try:
            profile = request.user.profile
        except Profile.DoesNotExist:
            return Response({"error": "Profile not found"}, status=400)
        ids = request.data.get('message_ids') or []
        if not isinstance(ids, list) or not ids or len(ids) > 50:
            return Response({"error": "Нужно от 1 до 50 сообщений"}, status=400)
        target = Chat.objects.filter(id=request.data.get('chat_id')).first()
        if not target:
            return Response({"error": "Чат не найден"}, status=404)
        if not _can_post_to(target, profile):
            return Response({"error": "В этот чат нельзя написать"}, status=403)
        sources = list(Message.objects.filter(id__in=ids, deleted_for_all=False).select_related('chat', 'sender', 'forwarded_from').order_by('created_at'))
        if len(sources) != len(set(ids)):
            return Response({"error": "Часть сообщений не найдена"}, status=404)
        # Доступ проверяем по каждому чату-источнику: в пакет могли попасть
        # сообщения только одного чата, но полагаться на это нельзя.
        for chat in {m.chat for m in sources}:
            if not _can_see_chat(chat, profile):
                return Response({"error": "Нет доступа к исходному сообщению"}, status=403)
            if chat.kind == 'secret':
                return Response({"error": "Секретные сообщения не пересылаются"}, status=403)
        if target.kind == 'secret':
            return Response({"error": "В секретный чат не пересылается"}, status=403)
        album = uuid.uuid4() if len(sources) > 1 else None
        created = [_forward_copy(src, target, profile, album_id=album) for src in sources]
        Chat.objects.filter(id=target.id).update(updated_at=timezone.now())
        # Уведомление — одно на пакет, по последнему сообщению: иначе получатель
        # ловил бы по пушу на каждое. В сокет чата остальные уходят отдельно,
        # без пуша — лента получателя должна увидеть каждое.
        for m in created[:-1]:
            _socket_new_message(m, request)
        _notify_new_message(created[-1], profile, request)
        return Response({"messages": MessageSerializer(created, many=True, context={'request': request}).data}, status=201)

    @action(detail=False, methods=['get'])
    def sync(self, request):
        """Лента постранично и приращениями — для ленивой загрузки и кэша на клиенте.

        chat — обязателен; limit ≤ 200 (по умолчанию 50).
        before=<ISO> — страница старее: created_at < before, самые новые из них.
        around=<id> — окно вокруг сообщения: половина лимита до него, половина
        после. Нужно для перехода к закреплённому или к цитате: раньше клиент
        дотягивался до старого сообщения, запрашивая страницы одну за другой —
        полтора десятка запросов и около десяти секунд ожидания.
        since=<ISO> — всё, что менялось после: новые, отредактированные и
        удалённые у всех (их id — в deleted, самих сообщений нет).
        Ответ: {messages, deleted, has_more, now}; now — серверное время для
        следующего since, чтобы часы клиента не участвовали.
        """
        from django.utils.dateparse import parse_datetime
        try:
            profile = request.user.profile
        except Profile.DoesNotExist:
            return Response({"error": "Profile not found"}, status=400)
        chat_id = request.query_params.get('chat')
        if not chat_id:
            return Response({"error": "chat is required"}, status=400)
        chat = Chat.objects.filter(id=chat_id).first()
        if not chat or not _can_see_chat(chat, profile):
            return Response({"error": "Чат не найден"}, status=404)
        try:
            limit = max(1, min(int(request.query_params.get('limit') or 50), 200))
        except ValueError:
            limit = 50
        now = timezone.now()
        base = (
            Message.objects.filter(chat=chat)
            .exclude(deleted_for=profile)
            .select_related('sender__notify_sound', 'sound', 'sticker', 'reply_to__sender', 'forwarded_from')
            .prefetch_related('read_statuses__user')
        )
        # Заблокированные: их сообщения не отдаём ни страницей, ни приращением.
        from .moderation import blocked_ids
        blocked = blocked_ids(profile)
        if blocked:
            base = base.exclude(sender_id__in=blocked)
        ser = lambda qs: MessageSerializer(qs, many=True, context={'request': request}).data

        since = parse_datetime(request.query_params.get('since') or '')
        if since:
            changed = list(base.filter(updated_at__gt=since).order_by('created_at'))
            return Response({
                "messages": ser([m for m in changed if not m.deleted_for_all]),
                "deleted": [str(m.id) for m in changed if m.deleted_for_all],
                "authors": _changed_authors(chat, since),
                "has_more": False,
                "now": now.isoformat(),
            })

        live = base.exclude(deleted_for_all=True)

        around = (request.query_params.get('around') or '').strip()
        if around:
            target = live.filter(id=around).first()
            if not target:
                return Response({"error": "Сообщение не найдено"}, status=404)
            half = limit // 2
            older = list(live.filter(created_at__lt=target.created_at).order_by('-created_at')[:half])[::-1]
            newer = list(live.filter(created_at__gt=target.created_at).order_by('created_at')[:half])
            window = older + [target] + newer
            return Response({
                "messages": ser(window),
                "deleted": [],
                # Сверху есть ещё, если набрали полную половину; снизу — если
                # новее окна остались сообщения (клиент вернётся к низу кнопкой).
                "has_more": len(older) >= half,
                "has_newer": live.filter(created_at__gt=(newer[-1].created_at if newer else target.created_at)).exists(),
                "now": now.isoformat(),
            })

        before = parse_datetime(request.query_params.get('before') or '')
        if before:
            live = live.filter(created_at__lt=before)
        page = list(live.order_by('-created_at')[:limit + 1])
        has_more = len(page) > limit
        page = page[:limit][::-1]
        return Response({
            "messages": ser(page),
            "deleted": [],
            "has_more": has_more,
            "now": now.isoformat(),
        })

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
        # Ленту в логи не печатаем: тексты сообщений в stdout контейнера —
        # это утечка, а не отладка.
        return super().list(request, *args, **kwargs)

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
        elif message.sender_id != profile.id:
            broadcast_read(message.chat_id, profile)
        
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
        
        # Только свой чат: иначе можно было бы пометить прочитанной чужую
        # переписку и разослать её участникам ложное «прочитано».
        if not ChatParticipant.objects.filter(chat_id=chat_id, user=profile).exists():
            return Response({"error": "Chat not found"}, status=404)

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
            broadcast_read(chat_id, profile)
        # Прочитал — уведомления этого чата на моих телефонах больше не нужны:
        # тихий пуш chat_read их убирает (если пуши по чату вообще были).
        try:
            from .presence import take_pushed
            if take_pushed(profile.id, chat_id):
                from .fcm import notify_data
                notify_data(Profile.objects.filter(id=profile.id), {"type": "chat_read", "chat_id": str(chat_id)})
        except Exception:
            logger.exception("chat_read: тихий пуш не ушёл")
        
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
        
        # Считаем сообщения в моих чатах, где я не отправитель и не прочитал.
        # Только мои чаты: иначе в счётчик попадали посты Стены и чужих каналов.
        unread_count = Message.objects.filter(
            ~Q(sender=profile), chat__participants=profile
        ).exclude(
            read_statuses__user=profile
        ).count()
        
        # Или по чатам
        unread_by_chat = Message.objects.filter(
            ~Q(sender=profile), chat__participants=profile
        ).exclude(
            read_statuses__user=profile
        ).values('chat_id').annotate(count=models.Count('id'))
        
        # Преобразуем в словарь {chat_id: count}
        unread_by_chat_dict = {
            str(item['chat_id']): item['count'] 
            for item in unread_by_chat
        }
        
        # Где меня упомянули или ответили на моё — и я ещё не прочитал: «@» в
        # списке чатов. Только группы: в личке любое сообщение и так мне.
        mention_chats = (
            Message.objects
            .filter(chat__participants=profile, chat__is_group=True)
            .exclude(chat__kind__in=('channel', 'secret'))
            .exclude(sender=profile)
            .exclude(deleted_for_all=True)
            .exclude(read_statuses__user=profile)
            .filter(Q(mentions__contains=[{"id": str(profile.id)}]) | Q(reply_to__sender=profile))
            .values_list('chat_id', flat=True)
            .distinct()
        )

        return Response({
            "total_unread": unread_count,
            "unread_by_chat": unread_by_chat_dict,
            "mention_by_chat": {str(c): True for c in mention_chats},
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
            _ch = Chat.objects.filter(id=_chat_id).only('id', 'kind', 'name', 'pending_for').first()
            if not _ch:
                return Response({"error": "Чат не найден"}, status=404)
            # Писать можно только туда, где ты участник (Стена — всем, кроме
            # забаненных): раньше в личку и группу проверки не было.
            if _ch.kind not in ('channel', 'wall', 'secret') and not _ch.pending_for_id \
                    and not ChatParticipant.objects.filter(chat=_ch, user=profile).exists():
                return Response({"error": "Вы не участник этого чата"}, status=403)
            # Запрос на переписку не принят — писать нельзя никому.
            if _ch and _ch.pending_for_id:
                return Response({"error": "Сначала примите запрос на переписку" if _ch.pending_for_id == profile.id
                                 else "Собеседник ещё не принял запрос на переписку", "chat_request": True}, status=403)
            # Секретный чат: сервер принимает только шифротекст (chat/secret.py).
            if _ch and _ch.kind == 'secret':
                from .secret import create_secret_message
                return create_secret_message(request, profile, _ch)
            # Бот «только чтение» (Обновлямбус): в его личку писать нельзя.
            if _ch and _ch.kind == 'direct' and not profile.is_bot and \
                    Profile.objects.filter(chatparticipant__chat=_ch, is_bot=True, readonly_bot=True).exists():
                return Response({"error": "Этому боту нельзя писать — он только рассылает"}, status=403)
            if _ch and _ch.kind == 'direct' and profile.is_bot and not _ch.bot_started:
                return Response({"error": "Человек ещё не нажал «Начать» — бот не пишет первым"}, status=403)
            # Приватный бот: писать ему может только владелец, а сам он — только владельцу.
            if _ch and not profile.is_bot and Profile.objects.filter(
                    chatparticipant__chat=_ch, is_bot=True, bot_private=True).exclude(bot_owner=profile).exists():
                return Response({"error": "Бот недоступен"}, status=403)
            if _ch and profile.is_bot and profile.bot_private and Profile.objects.filter(
                    chatparticipant__chat=_ch, is_bot=False).exclude(id=profile.bot_owner_id).exists():
                return Response({"error": "Приватный бот пишет только владельцу"}, status=403)
            if _ch and _ch.kind == 'channel':
                _cp = ChatParticipant.objects.filter(chat=_ch, user=profile).first()
                if not _cp or _cp.role not in ('owner', 'admin'):
                    return Response({"error": "Публиковать в канал могут только админы"}, status=403)
            # Стена: пишут все, кроме забаненных (chat/wall.py).
            if _ch and _ch.kind == 'wall':
                from .wall import wall_ban, ban_payload
                _ban = wall_ban(profile)
                if _ban:
                    return Response({"error": "Вам запрещено писать на Стену", "wall_ban": ban_payload(_ban)}, status=403)

        # Действие («подмигнуть»): адресат — указанный участник, в личке —
        # собеседник. Текст сообщения — для превью и поиска; клиент рисует
        # жест по центру ленты.
        action_obj = None
        action_target = None
        action_id = request.data.get('action_id')
        if action_id:
            action_obj = ChatAction.objects.filter(id=action_id, is_active=True).first()
            if not action_obj:
                return Response({"error": "Такого действия нет"}, status=400)
            _chat_for_action = Chat.objects.filter(id=_chat_id).first() if _chat_id else None
            if not _chat_for_action:
                return Response({"error": "Чат не найден"}, status=404)
            target_id = request.data.get('target_id')
            if target_id:
                action_target = Profile.objects.filter(id=target_id).first()
                if not action_target or not ChatParticipant.objects.filter(chat=_chat_for_action, user=action_target).exists():
                    return Response({"error": "Адресат не в этом чате"}, status=400)
            else:
                other = ChatParticipant.objects.filter(chat=_chat_for_action).exclude(user=profile).select_related('user').first()
                if not other or _chat_for_action.is_group:
                    return Response({"error": "Укажите, кому адресовано действие"}, status=400)
                action_target = other.user

        # Музыка из своего плейлиста: файл уже в хранилище — ссылку берём у
        # трека, ничего не перекачивая. Только свои плейлисты: иначе по id
        # чужого трека можно было бы разослать чужой файл.
        track_id = request.data.get('playlist_track_id')
        if track_id:
            track = PlaylistTrack.objects.filter(id=track_id, playlist__owner=profile).first()
            if not track:
                return Response({"error": "Трек не найден в ваших плейлистах"}, status=404)
            file_url = track.file_url
            ext = os.path.splitext(file_url.split('?')[0])[1] or '.mp3'
            base = f"{track.artist} — {track.title}" if track.artist else track.title
            file_name = (base[:200] + ext)
            file_size = None

        # Геопозиция: координаты, текст и ссылку на карту ставим сами.
        geo = None
        if request.data.get('geo_lat') is not None or request.data.get('geo_lng') is not None:
            try:
                lat, lng = float(request.data.get('geo_lat')), float(request.data.get('geo_lng'))
            except (TypeError, ValueError):
                return Response({"error": "Неверные координаты"}, status=400)
            if not (-90 <= lat <= 90 and -180 <= lng <= 180):
                return Response({"error": "Неверные координаты"}, status=400)
            geo = (round(lat, 6), round(lng, 6))

        # Создаем сообщение
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        
        # Подготавливаем данные для сохранения
        save_kwargs = {'sender': profile}
        if action_obj:
            save_kwargs.update({'action': action_obj, 'action_target': action_target,
                                'content': f"{action_obj.emoji} {action_obj.verb} {action_target.username}"})
        if geo:
            save_kwargs.update({
                'geo_lat': geo[0], 'geo_lng': geo[1], 'entities': [],
                'content': f"📍 Геопозиция\nhttps://yandex.ru/maps/?pt={geo[1]},{geo[0]}&z=16&l=map",
            })
        
        if file_url:
            save_kwargs.update({
                'file_url': file_url,
                'file_name': file_name,
                'file_size': file_size,
                'poster_url': request.data.get('poster_url') or None,
                'download_only': str(request.data.get('download_only') or '').lower() in ('1', 'true', 'yes'),
            })
        
        if sticker_id:
            try:
                sticker = Sticker.objects.get(id=sticker_id)
                save_kwargs['sticker'] = sticker
                save_kwargs['sticker_file'] = sticker.file_url or ""
            except Sticker.DoesNotExist:
                return Response({"error": "Sticker not found"}, status=400)
            # Эффект получения — только у стикеров и только из известного набора.
            effect = str(request.data.get('effect') or '')
            if effect in ('burst',):
                save_kwargs['effect'] = effect

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
                'video_flip': str(request.data.get('video_flip') or '').lower() in ('1', 'true', 'yes'),
            })
        
        # Стена: отметка «Контент 4+» — только от автора и только здесь.
        if _chat_id and _ch and _ch.kind == 'wall':
            save_kwargs['wall_safe'] = str(request.data.get('wall_safe') or '').lower() in ('1', 'true', 'yes')

        # Сохраняем с данными
        message = serializer.save(**save_kwargs)
        if message.content and message.chat.is_group:
            from .mentions import store_mentions
            store_mentions(message)

        # Сообщение — одна ссылка на картинку: забираем её к себе и показываем
        # картинкой (в фоне; клиент получит подмену обычной синхронизацией).
        if not message.file_url:
            from .linkimage import image_url_in, fetch_async
            link = image_url_in(message.content)
            if link:
                fetch_async(message.id, link)

        _notify_new_message(message, profile, request)
        from .translate import schedule as _schedule_translation
        _schedule_translation(message, profile, request)  # автоперевод в личке, в фоне

        # «Долгий ящик»: идею — к разработчику (chat/ideabox.py).
        if getattr(message.chat, 'kind', '') == 'ideabox' and not profile.is_bot:
            from .ideabox import deliver_idea
            deliver_idea(message, profile)
        # Реплай админа на идею в «Идеях» — автору в его ящик.
        elif message.reply_to_id and getattr(message.chat, 'kind', '') == 'system' and not profile.is_bot:
            from .ideabox import relay_staff_reply
            try:
                relay_staff_reply(message)
            except Exception:
                logger.exception("ideabox: ответ %s не доставлен автору", message.id)

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

        # Без учёта регистра: EvilTree и eviltree — для людей один и тот же
        # ник, и два таких профиля путали ссылки и поиск.
        if User.objects.filter(username__iexact=username).exists() or Profile.objects.filter(username__iexact=username).exists():
            return Response({'error': 'Пользователь с таким логином уже существует'}, status=status.HTTP_400_BAD_REQUEST)

        # Создаем пользователя с username
        # email оставляем пустым или генерируем фейковый
        user = User.objects.create_user(
            username=username, 
            email=f"{username}@local.fake",  # фейковый email для совместимости
            password=password
        )
        
        # Создаем профиль и связываем с пользователем.
        # accept_terms шлют клиенты с галочкой согласия на экране регистрации.
        # Старые сборки поля не знают — их не отбиваем, а правила покажем
        # отдельным экраном после обновления (terms_accepted_at пуст).
        accepted = str(request.data.get('accept_terms', '')).lower() in ('1', 'true', 'on')
        new_profile = Profile.objects.create(
            user=user, username=username,
            terms_accepted_at=timezone.now() if accepted else None,
        )
        # «Долгий ящик» — у каждого с первого входа (chat/ideabox.py).
        try:
            from .ideabox import user_chat
            user_chat(new_profile)
        except Exception:
            logger.exception("ideabox: не создан чат для %s", username)
        
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
        serializer = OwnProfileSerializer(profile)
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


def _probe_dims(path):
    """Ширина/высота картинки или видео через ffprobe (Pillow в образе нет,
    ffprobe читает и jpg/png/webp/gif, и mp4/mov/webm). Поворот из тега
    rotate учитываем — телефонное видео часто «лежит» в контейнере."""
    import subprocess, json as _json
    try:
        out = subprocess.run(['ffprobe', '-v', 'quiet', '-print_format', 'json', '-show_streams', path],
                             capture_output=True, timeout=20).stdout
        for st in _json.loads(out or b'{}').get('streams', []):
            w, h = st.get('width'), st.get('height')
            if st.get('codec_type') == 'video' and w and h:
                rot = str((st.get('tags') or {}).get('rotate', '0'))
                for sd in st.get('side_data_list') or []:
                    if sd.get('rotation') is not None:
                        rot = str(sd['rotation'])
                if abs(int(float(rot))) % 180 == 90:
                    w, h = h, w
                return int(w), int(h)
    except Exception:
        logger.exception('ffprobe dims failed')
    return None


def _make_poster(video_path, rel_base, local_only=False):
    """Кадр-превью видео: jpg до 640 px по ширине, рядом с файлом (<имя>.jpg).
    Без него лента показывала заглушку, пока WebKit не декодирует первый кадр —
    а он этого до тапа не делает. Возвращает URL (s3:// или /media/…) или None."""
    import subprocess
    rel = f"{os.path.splitext(rel_base)[0]}.jpg"
    full = os.path.join(settings.MEDIA_ROOT, rel)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    ok = False
    for ss in ("0.5", "0"):  # совсем короткий ролик: кадра на 0.5 с может не быть
        try:
            subprocess.run(
                ["ffmpeg", "-y", "-ss", ss, "-i", video_path, "-frames:v", "1",
                 "-vf", "scale='trunc(min(640,iw)/2)*2:-2'", "-q:v", "4", full],
                check=True, timeout=30, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            if os.path.exists(full) and os.path.getsize(full) > 0:
                ok = True
                break
        except Exception:
            continue
    if not ok:
        return None
    if s3_enabled() and not local_only:
        try:
            url = s3_upload(full, rel, "image/jpeg")
            os.remove(full)
            return url
        except Exception:
            logger.exception("poster: S3 не принял, оставляю локально")
    return f"/media/{rel}"


def _finalize_upload(request, file_path, original_name, out_size, file_extension):
    """Общий хвост загрузки для запроса: см. _finalize_file."""
    compress = (request.data.get('compress') or '').lower()
    local_only = str(request.data.get('local') or '').lower() in ('1', 'true', 'yes')
    return Response(_finalize_file(file_path, original_name, out_size, file_extension, compress, local_only))


def _finalize_file(file_path, original_name, out_size, file_extension, compress, local_only):
    """Сжатие видео, размеры, S3 — и итог загрузки словарём.

    Не зависит от запроса: для кусочной загрузки эта работа идёт в фоновом
    потоке. Внутри запроса она занимала десятки секунд на большом видео, и
    сервер обрывал такой запрос по таймауту.
    """
    full_path = os.path.join(settings.MEDIA_ROOT, file_path)
    out_name = original_name
    is_video = file_extension.lower() in ('.mp4', '.mov', '.m4v', '.webm', '.avi', '.mkv')

    # Сжатие видео на сервере (ffmpeg): клиент присылает compress=video для
    # вкладки «Видео». Файлы (вкладка «Файл») не трогаем. Фото жмёт клиент.
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
                full_path = transcoded_full
                out_size = new_size
                out_name = f"{os.path.splitext(original_name)[0]}.mp4"
            else:
                os.remove(transcoded_full)
        except Exception:
            # ffmpeg недоступен/упал/таймаут — оставляем оригинал.
            try:
                if os.path.exists(transcoded_full):
                    os.remove(transcoded_full)
            except Exception:
                pass

    # Хранилище: при включённом S3 отправляем итоговый файл в бакет и отдаём
    # его публичный URL, локальную копию удаляем. Иначе раздаём локально через
    # nginx (/media/...). Размеры — пока файл ещё на диске.
    dims = None
    if is_video or file_extension.lower() in ('.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.heic', '.heif'):
        dims = _probe_dims(full_path)
    poster_url = _make_poster(full_path, file_path, local_only) if is_video else None
    if s3_enabled() and not local_only:
        try:
            url = s3_upload(full_path, file_path)
            try:
                os.remove(full_path)
            except Exception:
                pass
            file_url = url
        except Exception:
            logger.exception("S3: загрузка не удалась, отдаю локально")
            file_url = f'/media/{file_path}'
    else:
        file_url = f'/media/{file_path}'

    return {
        "file_url": file_url,
        "file_name": out_name,
        "file_size": out_size,
        "width": dims[0] if dims else None,
        "height": dims[1] if dims else None,
        "poster_url": poster_url,
    }


class FileUploadView(APIView):
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request, *args, **kwargs):
        if not request.user.is_authenticated:
            return Response({"error": "User not authenticated"}, status=401)

        file = request.FILES.get('file')
        if not file:
            return Response({"error": "No file provided"}, status=400)

        # Лимита на размер вложений нет (по решению владельца): nginx —
        # client_max_body_size 0, файл пишется на диск чанками.
        try:
            request.user.profile
        except Profile.DoesNotExist:
            return Response({"error": "Profile not found"}, status=400)

        file_extension = os.path.splitext(file.name)[1]
        messages_dir = os.path.join(settings.MEDIA_ROOT, 'messages')
        os.makedirs(messages_dir, exist_ok=True)
        file_path = os.path.join('messages', f"{uuid.uuid4()}{file_extension}")
        with open(os.path.join(settings.MEDIA_ROOT, file_path), 'wb+') as destination:
            for chunk in file.chunks():
                destination.write(chunk)

        return _finalize_upload(request, file_path, file.name, file.size, file_extension)


class ChunkUploadView(APIView):
    """Загрузка файла кусками: POST /api/upload/chunk/, готовность — GET
    /api/upload/chunk/<upload_id>/.

    Большое видео одним запросом не проходит через CDN — тот обрывает приём по
    таймауту шлюза примерно через минуту. А CDN нужен: через него клиенты
    обходят блокировки. Поэтому файл режется на куски по несколько мегабайт.

    Последний кусок только склеивает файл и сразу отвечает «обрабатывается»:
    сжатие видео и отправка в хранилище идут в фоне. Раньше они шли прямо в
    запросе последнего куска — десятки секунд; сервер обрывал такой запрос,
    телефон повторял кусок, а куски к тому времени уже удалены — «не все куски
    дошли», и видео висело на 92%. Итог клиент забирает короткими опросами.

    Состояния на диске (MEDIA_ROOT/chunks/): <id>/ — куски, <id>.processing —
    идёт обработка, <id>.done.json — итог, <id>.error — сбой обработки.
    """
    parser_classes = [MultiPartParser, FormParser]
    # Брошенные на середине загрузки выметаем при каждой сборке.
    STALE_HOURS = 12

    def _root(self):
        return os.path.join(settings.MEDIA_ROOT, 'chunks')

    def _dir(self, upload_id):
        return os.path.join(self._root(), upload_id)

    def _state(self, upload_id, suffix):
        return os.path.join(self._root(), f"{upload_id}.{suffix}")

    def _sweep(self):
        import time as _time
        root = self._root()
        if not os.path.isdir(root):
            return
        deadline = _time.time() - self.STALE_HOURS * 3600
        for name in os.listdir(root):
            path = os.path.join(root, name)
            try:
                if os.path.getmtime(path) >= deadline:
                    continue
                if os.path.isdir(path):
                    shutil.rmtree(path, ignore_errors=True)
                else:
                    os.remove(path)
            except OSError:
                pass

    def _status(self, upload_id):
        """Итог, «обрабатывается», сбой — или None, если такой загрузки нет."""
        import json as _json
        done = self._state(upload_id, 'done.json')
        if os.path.exists(done):
            try:
                with open(done, encoding='utf-8') as f:
                    return Response(_json.load(f))
            except (OSError, ValueError):
                pass
        err = self._state(upload_id, 'error')
        if os.path.exists(err):
            try:
                msg = open(err, encoding='utf-8').read()[:200]
            except OSError:
                msg = ''
            return Response({"error": msg or "Не удалось обработать файл"}, status=500)
        if os.path.exists(self._state(upload_id, 'processing')):
            return Response({"processing": True, "upload_id": upload_id}, status=202)
        return None

    @staticmethod
    def _valid_id(upload_id):
        # Только hex: идентификатор идёт в путь на диске.
        return bool(re.fullmatch(r'[0-9a-f]{32}', upload_id or ''))

    def get(self, request, upload_id=None, *args, **kwargs):
        if not request.user.is_authenticated:
            return Response({"error": "User not authenticated"}, status=401)
        if not self._valid_id(upload_id):
            return Response({"error": "Некорректный upload_id"}, status=400)
        st = self._status(upload_id)
        return st or Response({"error": "Загрузка не найдена"}, status=404)

    def post(self, request, *args, **kwargs):
        if not request.user.is_authenticated:
            return Response({"error": "User not authenticated"}, status=401)
        try:
            request.user.profile
        except Profile.DoesNotExist:
            return Response({"error": "Profile not found"}, status=400)

        upload_id = (request.data.get('upload_id') or '').strip()
        if not self._valid_id(upload_id):
            return Response({"error": "Некорректный upload_id"}, status=400)
        try:
            index = int(request.data.get('index'))
            total = int(request.data.get('total'))
        except (TypeError, ValueError):
            return Response({"error": "index и total обязательны"}, status=400)
        if total < 1 or total > 2000 or not (0 <= index < total):
            return Response({"error": "index вне диапазона"}, status=400)

        # Повтор после того, как файл уже склеен (ответ до телефона не дошёл):
        # отдаём состояние, а не «не все куски дошли» — кусков уже нет.
        st = self._status(upload_id)
        if st is not None:
            return st

        chunk = request.FILES.get('chunk')
        if not chunk:
            return Response({"error": "Нет куска"}, status=400)

        target_dir = self._dir(upload_id)
        os.makedirs(target_dir, exist_ok=True)
        with open(os.path.join(target_dir, f"{index:05d}"), 'wb+') as dst:
            for part in chunk.chunks():
                dst.write(part)

        if index < total - 1:
            return Response({"received": index, "total": total})

        # Последний кусок — проверяем, что дошли все, и склеиваем.
        names = sorted(n for n in os.listdir(target_dir) if n.isdigit())
        if len(names) != total:
            missing = sorted(set(range(total)) - {int(n) for n in names})
            return Response({"error": "Не все куски дошли", "missing": missing[:20]}, status=409)

        original_name = (request.data.get('file_name') or 'file').strip()[:255]
        file_extension = os.path.splitext(original_name)[1]
        compress = (request.data.get('compress') or '').lower()
        local_only = str(request.data.get('local') or '').lower() in ('1', 'true', 'yes')
        os.makedirs(os.path.join(settings.MEDIA_ROOT, 'messages'), exist_ok=True)
        file_path = os.path.join('messages', f"{uuid.uuid4()}{file_extension}")
        full_path = os.path.join(settings.MEDIA_ROOT, file_path)
        with open(full_path, 'wb+') as dst:
            for name in names:
                with open(os.path.join(target_dir, name), 'rb') as src:
                    shutil.copyfileobj(src, dst, 1024 * 1024)
        size = os.path.getsize(full_path)
        # Метку «обрабатывается» ставим ДО удаления кусков: повтор в этот
        # момент должен увидеть обработку, а не пустое место.
        open(self._state(upload_id, 'processing'), 'w').close()
        shutil.rmtree(target_dir, ignore_errors=True)
        self._sweep()

        # Без фона — только в тестах и если явно попросили (sync=1): там
        # ждать удобнее, чем опрашивать.
        if getattr(settings, 'CHUNK_UPLOAD_SYNC', False) or str(request.data.get('sync') or '') == '1':
            self._finish(upload_id, file_path, original_name, size, file_extension, compress, local_only)
            return self._status(upload_id)

        import threading
        threading.Thread(
            target=self._finish,
            args=(upload_id, file_path, original_name, size, file_extension, compress, local_only),
            daemon=True,
        ).start()
        return Response({"processing": True, "upload_id": upload_id}, status=202)

    def _finish(self, upload_id, file_path, original_name, size, file_extension, compress, local_only):
        import json as _json
        from django.db import close_old_connections
        try:
            result = _finalize_file(file_path, original_name, size, file_extension, compress, local_only)
            with open(self._state(upload_id, 'done.json'), 'w', encoding='utf-8') as f:
                _json.dump(result, f, ensure_ascii=False)
        except Exception as e:
            logger.exception("Кусочная загрузка: обработка %s не удалась", upload_id)
            try:
                with open(self._state(upload_id, 'error'), 'w', encoding='utf-8') as f:
                    f.write(str(e)[:200])
            except OSError:
                pass
        finally:
            try:
                os.remove(self._state(upload_id, 'processing'))
            except OSError:
                pass
            close_old_connections()


# ViewSet для стикерпаков
ADULT_LOCKED_ERROR = "Это пак 18+. Включите «Показывать 18+» в настройках профиля"


def _adult_hidden(pack, me):
    """Пак 18+ скрыт от тех, кто не включил настройку. Автор свой пак видит
    всегда — иначе не смог бы его ни править, ни снять пометку."""
    if not getattr(pack, "is_adult", False):
        return False
    if me is None:
        return True
    owner_id = getattr(pack, "author_id", None) or getattr(pack, "creator_id", None)
    return not me.allow_adult and owner_id != me.id


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
    
    def _author_or_403(self, request):
        pack = self.get_object()
        if pack.author_id != getattr(getattr(request.user, 'profile', None), 'id', None):
            return Response({"error": "Менять может только автор пака"}, status=403)
        return None

    def update(self, request, *args, **kwargs):
        # Раньше проверки не было: PATCH чужого публичного пака проходил у любого.
        return self._author_or_403(request) or super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        return self._author_or_403(request) or super().partial_update(request, *args, **kwargs)

    @action(detail=True, methods=['post'])
    def save(self, request, pk=None):
        """Сохранить стикерпак себе"""
        pack = self.get_object()
        try:
            profile = request.user.profile
            if _adult_hidden(pack, profile):
                return Response({"error": ADULT_LOCKED_ERROR, "adult_locked": True}, status=403)
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
            if not profile.allow_adult:
                # Пак пометили 18+ уже после того, как человек его сохранил, —
                # из пикера он пропадает, подписка остаётся и вернётся с настройкой.
                user_packs = user_packs.exclude(models.Q(pack__is_adult=True) & ~models.Q(pack__author=profile))
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
    
    def destroy(self, request, *args, **kwargs):
        pack = self.get_object()
        if pack.author_id != getattr(getattr(request.user, 'profile', None), 'id', None):
            return Response({"error": "Удалять может только автор пака"}, status=403)
        # Файлы стикеров с диска — кроме тех, что уже отправлены: в переписке
        # они остаются (Message.sticker_file), иначе у получателей пустой пузырь.
        sent = set(Message.objects.filter(sticker__pack=pack).exclude(sticker_file="")
                   .values_list('sticker_file', flat=True))
        for s in pack.stickers.all():
            # Свои эмодзи хранятся адресом прямо в тексте сообщений (custom_emoji) —
            # их файлы маленькие и остаются, иначе в переписке пропали бы картинки.
            if s.file_url in sent or pack.kind == "emoji":
                continue
            try:
                if s.file_url.startswith('/media/'):
                    os.remove(os.path.join(settings.MEDIA_ROOT, s.file_url[len('/media/'):]))
            except Exception:
                pass
        return super().destroy(request, *args, **kwargs)

    @action(detail=False, methods=['get'])
    def authored(self, request):
        """Паки, которые создал я (для студии)."""
        profile = getattr(request.user, 'profile', None)
        qs = StickerPack.objects.filter(author=profile).prefetch_related('stickers').order_by('-created_at')
        return Response(StickerPackSerializer(qs, many=True, context={'request': request}).data)

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
            if _adult_hidden(pack, profile):
                return Response({"error": ADULT_LOCKED_ERROR, "adult_locked": True}, status=403)
            
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
def _clean_keyword(value):
    """Макрос — одно слово без пробелов, до 40 знаков; пусто — не подсказывать."""
    s = (str(value or '')).strip().split()
    return (s[0] if s else '')[:40]


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
        me = getattr(self.request.user, 'profile', None)
        if not (me and me.allow_adult):
            hidden = models.Q(pack__is_adult=True)
            if me:
                hidden &= ~models.Q(pack__author=me)
            queryset = queryset.exclude(hidden)
        return queryset.order_by('order', 'created_at')
    
    def perform_create(self, serializer):
        """Добавлять стикеры может автор набора, а в совместном (open_add) —
        и все, кто его сохранил."""
        pack_id = self.request.data.get('pack')
        if not pack_id:
            raise ValidationError("Pack ID is required")
        
        try:
            profile = self.request.user.profile
            pack = StickerPack.objects.get(id=pack_id)
            
            # Раньше здесь был PermissionError — клиент получал 500 вместо отказа.
            if pack.author_id != profile.id and not (
                pack.open_add and UserStickerPack.objects.filter(user=profile, pack=pack).exists()
            ):
                from rest_framework.exceptions import PermissionDenied
                raise PermissionDenied("Добавлять стикеры может только автор набора")
            
            serializer.save(keyword=_clean_keyword(self.request.data.get('keyword')))
        except StickerPack.DoesNotExist:
            raise ValidationError("Sticker pack not found")
        except Profile.DoesNotExist:
            raise ValidationError("Profile not found")

    # Менять и удалять стикер может только автор набора: раньше ModelViewSet
    # пускал любого вошедшего — чужой пак можно было выпотрошить.
    def _own(self, sticker):
        me = getattr(self.request.user, 'profile', None)
        if not me or sticker.pack.author_id != me.id:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Стикер можно менять только в своём наборе")

    def perform_update(self, serializer):
        self._own(serializer.instance)
        # Пак и файл через PATCH не переносятся: только макрос, эмодзи, порядок.
        for k in ('pack', 'file_url', 'file_name'):
            serializer.validated_data.pop(k, None)
        kw = self.request.data.get('keyword')
        serializer.save(**({'keyword': _clean_keyword(kw)} if kw is not None else {}))

    def perform_destroy(self, instance):
        self._own(instance)
        instance.delete()


# Загрузка стикеров
# ── Анимированные стикеры и аватары ─────────────────────────────────────
# GIF и короткое видео (до ANIM_SECONDS) переводим в mp4 без звука: меньше и
# плавнее GIF. Рядом кладём первый кадр: <база>.mp4 и <база>.mp4.jpg, а в
# адрес пишем кадр — старые клиенты, пуши и CallKit видят обычную картинку,
# новые по «.mp4.jpg» понимают, что рядом видео, и проигрывают его.
ANIM_EXTS = (".gif", ".mp4", ".mov", ".m4v", ".webm", ".mkv")
ANIM_SECONDS = 5
ANIM_MAX_MB = 25


def _has_alpha(src, ext):
    """Есть ли в анимации прозрачность (GIF, webm с альфой) — mp4 её не хранит."""
    import subprocess
    import re
    if ext not in (".gif", ".webm"):
        return False
    cmd = ["ffmpeg", "-v", "error"] + (["-c:v", "libvpx-vp9"] if ext == ".webm" else [])
    cmd += ["-t", str(ANIM_SECONDS), "-i", src, "-vf",
            "alphaextract,signalstats,metadata=print:key=lavfi.signalstats.YMIN:file=-", "-f", "null", "-"]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    except Exception:
        return False
    vals = [int(v) for v in re.findall(r"lavfi\.signalstats\.YMIN=(\d+)", r.stdout or "")]
    return bool(vals) and min(vals) < 250


def _animated_media(src, ext, kind, dest_rel_base):
    """GIF или видео → анимация. kind="sticker" — вписать в 512 с пропорциями,
    прозрачный — анимированным WebP (иначе в mp4 вышел бы чёрный фон);
    kind="avatar" — квадрат по центру, 512. Возвращает /media/... или None."""
    import subprocess
    abs_base = os.path.join(settings.MEDIA_ROOT, dest_rel_base)
    os.makedirs(os.path.dirname(abs_base), exist_ok=True)
    if kind == "avatar":
        vf = "crop='min(iw,ih)':'min(iw,ih)',scale='trunc(min(512,iw)/2)*2':-2"
    else:
        vf = "scale=w='min(512,iw)':h='min(512,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2"
    made = []
    try:
        if kind == "sticker" and _has_alpha(src, ext):
            out = abs_base + ".webp"
            made.append(out)
            dec = ["-c:v", "libvpx-vp9"] if ext == ".webm" else []
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *dec, "-t", str(ANIM_SECONDS), "-i", src, "-an",
                            "-vf", vf + ",fps=20", "-c:v", "libwebp_anim", "-lossless", "0", "-q:v", "70", "-loop", "0", out],
                           check=True, timeout=180)
            return "/media/" + dest_rel_base + ".webp"
        out = abs_base + ".mp4"
        made += [out, out + ".jpg"]
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-t", str(ANIM_SECONDS), "-i", src, "-an",
                        "-vf", vf + ",fps=30,format=yuv420p", "-c:v", "libx264", "-crf", "26", "-preset", "veryfast",
                        "-movflags", "+faststart", out], check=True, timeout=180)
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", out, "-frames:v", "1", "-q:v", "3", out + ".jpg"],
                       check=True, timeout=60)
        anim_webp(out)
        return "/media/" + dest_rel_base + ".mp4.jpg"
    except Exception:
        logger.exception("анимация %s → %s не получилась", src, kind)
        for f in made:
            try:
                os.remove(f)
            except OSError:
                pass
        return None


def anim_webp(mp4_path):
    """Рядом с видео — лёгкий анимированный WebP «<база>.mp4.webp»: его клиент
    показывает, когда iOS не даёт запустить видео сама (энергосбережение) —
    картинки анимируются всегда, как у видео-обоев. Не вышло — не беда:
    останется кадр."""
    import subprocess
    try:
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", mp4_path, "-an",
                        "-vf", "scale='min(256,iw)':-2:flags=lanczos,fps=15",
                        "-c:v", "libwebp_anim", "-lossless", "0", "-q:v", "60", "-loop", "0", mp4_path + ".webp"],
                       check=True, timeout=120)
        return True
    except Exception:
        logger.exception("анимированный WebP для %s не получился", mp4_path)
        return False


def _save_upload_tmp(file, ext):
    """Загруженный файл — во временный, ffmpeg читает с диска."""
    import tempfile
    fd, path = tempfile.mkstemp(suffix=ext)
    with os.fdopen(fd, "wb") as out:
        for chunk in file.chunks():
            out.write(chunk)
    return path


def _remove_media(url):
    """Удалить файл из MEDIA_ROOT по /media/... (с видео рядом с кадром)."""
    if not url or not url.startswith("/media/"):
        return
    path = os.path.join(settings.MEDIA_ROOT, url.replace("/media/", "", 1))
    paths = [path] + ([path[:-4], path[:-4] + ".webp"] if path.endswith(".mp4.jpg") else [])
    for p in paths:
        try:
            if os.path.exists(p):
                os.remove(p)
        except OSError:
            pass


def _emoji_image(src):
    """Картинка своего эмодзи → /media/emoji/<uuid>.png (до 100 px) или None."""
    import subprocess
    rel = f"emoji/{uuid.uuid4()}.png"
    out = os.path.join(settings.MEDIA_ROOT, rel)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    try:
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", src,
                        "-vf", "scale=w='min(100,iw)':h='min(100,ih)':force_original_aspect_ratio=decrease:flags=lanczos",
                        "-frames:v", "1", out], check=True, timeout=60)
        return "/media/" + rel
    except Exception:
        logger.exception("эмодзи %s не получился", src)
        try:
            os.remove(out)
        except OSError:
            pass
        return None


class StickerUploadView(APIView):
    parser_classes = [MultiPartParser, FormParser]
    permission_classes = [permissions.IsAuthenticated]
    
    def post(self, request, *args, **kwargs):
        if not request.user.is_authenticated:
            return Response({"error": "User not authenticated"}, status=401)
        
        file = request.FILES.get('file')
        if not file:
            return Response({"error": "No file provided"}, status=400)
        
        file_extension = os.path.splitext(file.name)[1].lower()
        animated = file_extension in ANIM_EXTS
        # Картинка — до 5 МБ; GIF и видео — до 25 МБ (сожмутся в mp4).
        if file.size > (ANIM_MAX_MB if animated else 5) * 1024 * 1024:
            return Response({"error": "Файл слишком большой" if animated else "File too large (max 5MB for stickers)"}, status=400)

        allowed_extensions = ['.png', '.jpg', '.jpeg', '.webp'] + list(ANIM_EXTS)
        if file_extension not in allowed_extensions:
            return Response({"error": "Только картинка, GIF или видео"}, status=400)

        try:
            profile = request.user.profile
        except Profile.DoesNotExist:
            return Response({"error": "Profile not found"}, status=400)

        # Свой эмодзи — из обычной картинки: 100 px PNG с прозрачностью (рисуется
        # в строке текста, десятками — поэтому маленький).
        if request.data.get('kind') == 'emoji':
            if animated:
                return Response({"error": "Эмодзи — из картинки: PNG, JPG или WebP"}, status=400)
            tmp = _save_upload_tmp(file, file_extension)
            try:
                url = _emoji_image(tmp)
            finally:
                try:
                    os.remove(tmp)
                except OSError:
                    pass
            if not url:
                return Response({"error": "Не удалось обработать картинку"}, status=400)
            return Response({"file_url": url, "file_name": file.name})

        # GIF и видео до 5 с — анимированный стикер (mp4 или прозрачный WebP).
        if animated:
            tmp = _save_upload_tmp(file, file_extension)
            try:
                url = _animated_media(tmp, file_extension, "sticker", f"stickers/{uuid.uuid4()}")
            finally:
                try:
                    os.remove(tmp)
                except OSError:
                    pass
            if not url:
                return Response({"error": "Не удалось обработать анимацию"}, status=400)
            return Response({"file_url": url, "file_name": file.name})
        
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
        
        # Размер: голосовое до 15 минут (клиент обрывает сам) — при 48 кбит/с это
        # ~5 МБ; 25 МБ — запас, если Safari запишет AAC с битрейтом выше заданного.
        if file.size > 25 * 1024 * 1024:
            return Response({"error": "File too large (max 25MB for voice messages)"}, status=400)
        
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


# Картинки профиля: аватар и обложка. Отличаются каталогом, полем модели и
# лимитом размера — проверки и удаление прежнего файла общие.
def _shrink_image(abs_path, max_side):
    """Ужать картинку до max_side по большей стороне (ffmpeg, Pillow в образе
    нет). Тяжёлый PNG/WebP после ужатия переводим в JPEG — аватар 4 МБ на
    iPhone декодировался секунды и при каждом переходе показывал скелетон
    (баг-репорт 170e4253). GIF не трогаем — анимация. Возвращает итоговый путь."""
    import subprocess
    root, ext = os.path.splitext(abs_path)
    ext = ext.lower()
    if ext == ".gif":
        return abs_path
    tmp = f"{root}.tmp{ext}"
    try:
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", abs_path, "-vf", f"scale=min({max_side}\\,iw):-2", "-q:v", "4", tmp],
                       check=True, timeout=60)
        os.replace(tmp, abs_path)
        if ext in (".png", ".webp") and os.path.getsize(abs_path) > 400 * 1024:
            jpg = f"{root}.jpg"
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", abs_path, "-q:v", "4", jpg], check=True, timeout=60)
            os.remove(abs_path)
            return jpg
    except Exception:
        logger.warning("ужатие картинки не удалось: %s", abs_path)
        try:
            os.remove(tmp)
        except OSError:
            pass
    return abs_path


def _save_profile_image(request, *, field, subdir, prefix, max_mb, stamped, profile=None):
    """Кладёт картинку в MEDIA_ROOT/<subdir> и прописывает путь в профиль.

    stamped=True добавляет к имени случайный суффикс: обложка меняется целиком,
    и при постоянном имени браузер продолжал бы показывать прежнюю из кеша.
    У аватара имя стабильное — так сложилось исторически, ссылки на него
    разбросаны по кешам клиентов.

    profile — чей профиль: по умолчанию свой; владелец бота передаёт бота
    (аватар бота из студии, BotAvatarView).
    """
    file = request.FILES.get('file')
    if not file:
        return Response({"error": "No file provided"}, status=400)

    if file.size > max_mb * 1024 * 1024:
        return Response({"error": f"File too large (max {max_mb}MB)"}, status=400)

    allowed_extensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp']
    file_extension = os.path.splitext(file.name)[1].lower()
    # Аватар может быть анимированным: GIF или видео до 5 с → mp4.
    animated = subdir == 'avatars' and file_extension in ANIM_EXTS
    if file_extension not in allowed_extensions and not animated:
        return Response({"error": "Only image files are allowed"}, status=400)

    if profile is None:
        try:
            profile = request.user.profile
        except Profile.DoesNotExist:
            return Response({"error": "Profile not found"}, status=400)

    if animated:
        tmp = _save_upload_tmp(file, file_extension)
        try:
            url = _animated_media(tmp, file_extension, "avatar", f"{subdir}/{prefix}_{profile.id}_{uuid.uuid4().hex[:8]}")
        finally:
            try:
                os.remove(tmp)
            except OSError:
                pass
        if not url:
            return Response({"error": "Не удалось обработать анимацию"}, status=400)
        _remove_media(getattr(profile, field, None))
        setattr(profile, field, url)
        profile.save(update_fields=[field])
        return url

    target_dir = os.path.join(settings.MEDIA_ROOT, subdir)
    os.makedirs(target_dir, exist_ok=True)

    # Прежний файл удаляем, иначе в media копятся хвосты от каждой замены.
    _remove_media(getattr(profile, field, None))

    suffix = f"_{uuid.uuid4().hex[:8]}" if stamped else ""
    file_path = os.path.join(subdir, f"{prefix}_{profile.id}{suffix}{file_extension}")
    abs_path = os.path.join(settings.MEDIA_ROOT, file_path)
    with open(abs_path, 'wb+') as destination:
        for chunk in file.chunks():
            destination.write(chunk)
    # Аватар — до 640 px по стороне, обложка — до 1600: в интерфейсе больше не нужно.
    final = _shrink_image(abs_path, 640 if subdir == 'avatars' else 1600)
    file_path = os.path.relpath(final, settings.MEDIA_ROOT)

    file_url = f'/media/{file_path}'
    setattr(profile, field, file_url)
    profile.save(update_fields=[field])
    return file_url


class AnimatedAvatarUploadView(APIView):
    """POST avatar/animated/ — GIF или видео до 5 с → аватар-видео для группы
    или канала (квадрат 512, mp4 и кадр рядом). Отдаёт {file_url}; ставит его
    чату сам клиент — так же, как обычную картинку."""
    parser_classes = [MultiPartParser, FormParser]
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        file = request.FILES.get('file')
        if not file:
            return Response({"error": "No file provided"}, status=400)
        ext = os.path.splitext(file.name)[1].lower()
        if ext not in ANIM_EXTS:
            return Response({"error": "Нужен GIF или видео"}, status=400)
        if file.size > ANIM_MAX_MB * 1024 * 1024:
            return Response({"error": "Файл слишком большой"}, status=400)
        tmp = _save_upload_tmp(file, ext)
        try:
            url = _animated_media(tmp, ext, "avatar", f"avatars/chat_{uuid.uuid4().hex}")
        finally:
            try:
                os.remove(tmp)
            except OSError:
                pass
        if not url:
            return Response({"error": "Не удалось обработать анимацию"}, status=400)
        return Response({"file_url": url})


# Загрузка аватаров
class AvatarUploadView(APIView):
    parser_classes = [MultiPartParser, FormParser]
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, *args, **kwargs):
        # stamped: имя со случайным хвостом. С постоянным именем адрес не
        # менялся, и новый аватар не было видно — телефон и браузер показывали
        # картинку из кеша, пока его не сбросишь. Прежний файл всё равно
        # удаляется, хвостов в media не копится.
        result = _save_profile_image(
            request, field='avatar_url', subdir='avatars', prefix='avatar',
            max_mb=ANIM_MAX_MB if os.path.splitext(getattr(request.FILES.get('file'), 'name', ''))[1].lower() in ANIM_EXTS else 5,
            stamped=True,
        )
        if isinstance(result, Response):
            return result
        return Response({
            "avatar_url": result,
            "message": "Avatar uploaded successfully"
        })


# Загрузка обложки профиля
class CoverUploadView(APIView):
    """Широкий баннер за аватаром. Лимит выше, чем у аватара: обложка на всю
    ширину экрана, 5 МБ для неё маловато."""
    parser_classes = [MultiPartParser, FormParser]
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, *args, **kwargs):
        result = _save_profile_image(
            request, field='cover_url', subdir='covers', prefix='cover',
            max_mb=10, stamped=True,
        )
        if isinstance(result, Response):
            return result
        return Response({
            "cover_url": result,
            "message": "Cover uploaded successfully"
        })

    def delete(self, request, *args, **kwargs):
        """Снять обложку — экран профиля вернётся к однотонной подложке."""
        try:
            profile = request.user.profile
        except Profile.DoesNotExist:
            return Response({"error": "Profile not found"}, status=400)
        if profile.cover_url:
            old_full_path = os.path.join(settings.MEDIA_ROOT, profile.cover_url.replace('/media/', ''))
            if os.path.exists(old_full_path):
                try:
                    os.remove(old_full_path)
                except OSError:
                    pass
            profile.cover_url = None
            profile.save(update_fields=['cover_url'])
        return Response({"cover_url": None})


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
        # Картинка из чужих сохранёнок открывается, только если их владелец
        # открыл сохранёнки этому человеку: иначе прямая ссылка обходила бы
        # настройку доступа (см. can_see_saved).
        from .moderation import can_see_saved
        saved_owners = SavedImage.objects.filter(file_url=marker).values_list('owner_id', flat=True)
        # Музыка из своих плейлистов открывается всегда: трек остаётся,
        # даже если исходное сообщение удалили (см. PlaylistTrack).
        in_my_playlist = PlaylistTrack.objects.filter(
            file_url=marker, playlist__owner=profile).exists()
        # Плейлист, открытый по ссылке, слушают все, кому её дали: иначе
        # поделиться можно было бы только названиями треков.
        if not in_my_playlist:
            in_my_playlist = PlaylistTrack.objects.filter(file_url=marker).exclude(
                playlist__share_token="").exists()
        # Открытый плейлист — только собеседникам его владельца (_music_contacts).
        if not in_my_playlist:
            public_owners = set(PlaylistTrack.objects.filter(
                file_url=marker, playlist__is_public=True).values_list('playlist__owner_id', flat=True))
            in_my_playlist = bool(public_owners and public_owners & _music_contacts(profile))
        # Трек из эфира, который мне виден (chat/radio.py).
        if not in_my_playlist:
            from .radio import track_on_air_for
            in_my_playlist = track_on_air_for(profile, file_url=marker)
        # Обои чата: ключ wallpapers/… подписываем участнику чата, у которого
        # они стоят (общие или личные), — это не сообщение, в Message их нет.
        is_wallpaper = key.startswith('wallpapers/') and (
            Chat.objects.filter(Q(wallpaper_url=marker) | Q(wallpaper_poster=marker) | Q(wallpaper_anim=marker), participants=profile).exists()
            or ChatParticipant.objects.filter(Q(wallpaper_url=marker) | Q(wallpaper_poster=marker) | Q(wallpaper_anim=marker), user=profile).exists()
        )
        if not is_wallpaper and not in_my_playlist and not any(can_see_saved(owner_id, profile.id) for owner_id in saved_owners):
            # Один файл может лежать в нескольких сообщениях: переслали, отправили
            # в два чата. Право на скачивание — если он виден хотя бы в одном чате,
            # где человек участник. Раньше брали first() (порядок по UUID —
            # случайный), и участники второго чата получали 403.
            msgs = list(Message.objects.filter(
                Q(file_url=marker) | Q(video_url=marker) | Q(voice_url=marker)
            ).exclude(deleted_for_all=True).select_related('chat'))
            if not msgs:
                return Response({"error": "not found"}, status=404)
            if not any(_can_see_chat(m.chat, profile) for m in msgs):
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


def _pack_payload(pack, me=None, locked=False):
    # locked — пак 18+ открыли без настройки: карточка видна (название, автор,
    # пометка), а сами звуки не отдаём.
    sounds = [] if locked else NotificationSoundSerializer(pack.sounds.all().order_by("order", "slug"), many=True).data
    return {
        "id": str(pack.id), "name": pack.name, "order": pack.order, "sounds": sounds,
        "sounds_count": pack.sounds.count(),
        "is_public": pack.is_public, "is_default": pack.is_default,
        "cover_url": pack.cover_url or None,
        "is_adult": pack.is_adult, "adult_locked": locked,
        "creator": pack.creator.username if pack.creator_id else None,
        "added": bool(me) and UserSoundPack.objects.filter(user=me, pack=pack).exists(),
        "mine": bool(me) and pack.creator_id == getattr(me, "id", None),
    }


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

    def get(self, request, pk):
        """Карточка пака по ссылке /sp/<id>: публичный — любому, приватный — владельцу."""
        me = _studio_profile(request)
        pack = SoundPack.objects.filter(pk=pk).prefetch_related("sounds").first()
        if not pack or (not pack.is_public and (not me or pack.creator_id != me.id)):
            return Response({"error": "Пак не найден"}, status=404)
        return Response(_pack_payload(pack, me, locked=_adult_hidden(pack, me)))

    def patch(self, request, pk):
        pack, err = self._get_owned(request, pk)
        if err: return err
        fields = []
        if "name" in request.data:
            name = (request.data.get("name") or "").strip()
            if not name:
                return Response({"error": "Пустое название"}, status=400)
            pack.name = name[:64]; fields.append("name")
        if "is_adult" in request.data:
            pack.is_adult = str(request.data.get("is_adult")).lower() in ("1", "true", "on")
            fields.append("is_adult")
        if not fields:
            return Response({"error": "Нечего менять"}, status=400)
        pack.save(update_fields=fields)
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
        # Не всё всем: стандартные паки (галочка в админке) и звуки вне паков —
        # у каждого; остальное — то, что человек создал сам или добавил по ссылке.
        me = getattr(request.user, "profile", None)
        visible = models.Q(pack__isnull=True) | models.Q(pack__is_default=True)
        if me:
            visible |= models.Q(pack__creator=me) | models.Q(pack__added_by_users__user=me)
        sounds = NotificationSound.objects.filter(is_active=True).filter(visible)
        if not (me and me.allow_adult):
            # Паки 18+ без настройки не попадают ни в пикер, ни в звуки пушей
            # (пуш с таким звуком придёт со стандартным). Свой пак автор видит.
            hidden = models.Q(pack__is_adult=True)
            if me:
                hidden &= ~models.Q(pack__creator=me)
            sounds = sounds.exclude(hidden)
        sounds = sounds.distinct()
        return Response(NotificationSoundSerializer(sounds, many=True).data)


class IceServersView(APIView):
    """ICE-конфигурация для WebRTC. TURN-креды берутся из окружения сервера,
    чтобы не зашивать их в сборки приложений и менять без релиза."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        from .ice import ice_servers
        return Response({"iceServers": ice_servers()})


class PeopleSearchView(APIView):
    """GET /api/people/search/?q=<ник> — люди по началу ника (от 2 символов, до
    20, точное совпадение первым). Не находятся: боты (к ним — по ссылке и
    «Начать»), я сам, удалённые, скрывшие себя из поиска (кроме тех, с кем уже
    есть общий чат), те, кого я заблокировал. Заблокировавший меня находится:
    блокировка невидима для заблокированного. Не чаще 30 запросов в минуту —
    перебором по буквам базу не выкачать."""
    permission_classes = [permissions.IsAuthenticated]
    LIMIT, PER_MINUTE = 20, 30

    def get(self, request):
        from django.core.cache import cache
        from django.db.models import Case, F, IntegerField, When
        from django.db.models.functions import Length
        from .moderation import blocked_ids
        me = getattr(request.user, "profile", None)
        if me is None or me.is_bot:
            return Response({"error": "Profile not found"}, status=400)
        q = (request.query_params.get("q") or "").strip().lstrip("@")
        if len(q) < 2:
            return Response([])
        key = f"people-search:{me.id}"
        cache.add(key, 0, 60)
        try:
            n = cache.incr(key)
        except ValueError:
            cache.set(key, 1, 60); n = 1
        if n > self.PER_MINUTE:
            return Response({"error": "Слишком часто — подождите минуту"}, status=429)
        qs = (Profile.objects.filter(username__istartswith=q, is_bot=False, user__is_active=True)
              .exclude(id=me.id).exclude(id__in=blocked_ids(me))
              .filter(Q(hide_from_search=False) | Q(id__in=_contact_ids(me)))
              .annotate(exact=Case(When(username__iexact=q, then=0), default=1, output_field=IntegerField()),
                        ulen=Length("username"))
              .order_by("exact", "ulen", F("last_seen").desc(nulls_last=True))[:self.LIMIT])
        return Response([{
            "id": str(p.id), "username": p.username, "avatar_url": p.avatar_url,
            "bio": (p.bio or "")[:120], "aura_color": p.aura_color, "aura_text": p.aura_text,
        } for p in qs])


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
        defaults = {"user": profile, "platform": platform}
        # Ключ шифрования пушей от устройства (см. fcm.py). Клиент без ключа —
        # старая версия, ей пуши уходят открытым текстом, как раньше.
        secret = (request.data.get("secret") or "").strip()
        if secret:
            defaults["secret"] = secret[:64]
        # device_id связывает токен с сеансом (chat/devices.py): «выйти с
        # устройства» удаляет и его пуш-токен, иначе пуши шли бы на чужой телефон.
        did = (request.data.get("device_id") or "").strip()[:64] or None
        if did:
            # unique (user, device_id, platform): прежний токен этого вида с
            # этого устройства уходит. Раньше без platform VoIP-токен iPhone
            # стирал обычный и наоборот — оставался тот, что пришёл последним,
            # и без VoIP-токена iPhone в фоне не звонил.
            PushToken.objects.filter(user=profile, device_id=did, platform=platform).exclude(token=token).delete()
            defaults["device_id"] = did
        device, created = PushToken.objects.update_or_create(token=token, defaults=defaults)
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
        "webapp_url": bot.webapp_url or "",
        "webapp_title": bot.webapp_title or "",
        "is_bot": True,
        "owner": str(bot.bot_owner_id) if bot.bot_owner_id else None,
        "private": bool(bot.bot_private),
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

        username = (request.data.get("username") or "").strip().lstrip("@")
        # Ник бота идёт в ссылку /u/<ник> и в «@ник запрос» — только латиница,
        # цифры и _, занятость — без учёта регистра (MyBot и mybot — один ник).
        if not _valid_username(username):
            return Response({"error": "Ник бота — от 3 до 32 символов: латиница, цифры и _"}, status=400)
        if User.objects.filter(username__iexact=username).exists() or Profile.objects.filter(username__iexact=username).exists():
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


class BotStartView(APIView):
    """POST bots/<id>/start/ — человек начинает диалог с ботом: личка
    создаётся (или находится), помечается bot_started, боту уходит /start.
    Повторный вызов просто открывает чат."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        me = getattr(request.user, 'profile', None)
        if not me or me.is_bot:
            return Response({"error": "Нет профиля"}, status=403)
        bot = Profile.objects.filter(id=pk, is_bot=True).first()
        if not bot or bot.bot_closed_to(me):
            return Response({"error": "Бот не найден"}, status=404)
        from .moderation import blocked_either_way
        if blocked_either_way(me.id, bot.id):
            return Response({"error": "Нельзя написать этому боту"}, status=403)
        chat = Chat.objects.filter(kind='direct', participants=me).filter(participants=bot).first()
        if not chat:
            chat = Chat.objects.create(kind='direct')
            ChatParticipant.objects.create(chat=chat, user=me)
            ChatParticipant.objects.create(chat=chat, user=bot)
        started = False
        if not chat.bot_started:
            chat.bot_started = True
            chat.save(update_fields=['bot_started'])
            msg = Message.objects.create(chat=chat, sender=me, content="/start")
            _notify_new_message(msg, me, request)
            started = True
        return Response({"chat_id": str(chat.id), "started": started})


class BotDetailView(APIView):
    """POST — перевыпустить токен. PATCH {bio} — описание. DELETE — удалить
    бота. Только владелец (студия: управление ботами)."""
    permission_classes = [permissions.IsAuthenticated]

    def _owned(self, request, pk, allow_self=False):
        me = getattr(request.user, "profile", None)
        bot = Profile.objects.filter(pk=pk, is_bot=True).select_related("user").first()
        if not bot:
            return None, Response({"error": "Бот не найден"}, status=404)
        # allow_self: описание и мини-приложение бот может поменять и сам, своим токеном.
        if not me or (bot.bot_owner_id != me.id and not (allow_self and me.id == bot.id)):
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

    def patch(self, request, pk):
        """{bio?, webapp_url?, webapp_title?} — описание и мини-приложение
        (адрес https; пустой — убрать). Токен в ответе — только владельцу."""
        from .webapp import valid_app_url
        bot, err = self._owned(request, pk, allow_self=True)
        if err:
            return err
        fields = []
        if "bio" in request.data:
            bot.bio = (request.data.get("bio") or "").strip()[:500]
            fields.append("bio")
        if "webapp_url" in request.data:
            url = (request.data.get("webapp_url") or "").strip()
            if url and not valid_app_url(url):
                return Response({"error": "Адрес мини-приложения — https://…"}, status=400)
            bot.webapp_url = url
            fields.append("webapp_url")
        if "webapp_title" in request.data:
            bot.webapp_title = (request.data.get("webapp_title") or "").strip()[:32]
            fields.append("webapp_title")
        mine = bot.bot_owner_id == getattr(getattr(request.user, "profile", None), "id", None)
        if "private" in request.data:
            # Приватность — только владелец (не сам бот своим токеном).
            if not mine:
                return Response({"error": "Приватность бота меняет только владелец"}, status=403)
            bot.bot_private = str(request.data.get("private")).lower() in ("1", "true", "yes")
            fields.append("bot_private")
        if not fields:
            return Response({"error": "Нечего менять"}, status=400)
        bot.save(update_fields=fields)
        return Response({"bot": _bot_payload(bot, with_token=mine)})

    def delete(self, request, pk):
        bot, err = self._owned(request, pk)
        if err:
            return err
        user = bot.user
        bot.delete()
        if user:
            user.delete()  # каскадом уберёт связанные записи бота
        return Response({"ok": True})


class BotAvatarView(APIView):
    """POST multipart {file} — аватар бота, загружает владелец (студия).
    Как у людей: картинка, GIF или короткое видео (станет mp4)."""
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request, pk):
        bot, err = BotDetailView()._owned(request, pk)
        if err:
            return err
        ext = os.path.splitext(getattr(request.FILES.get('file'), 'name', ''))[1].lower()
        result = _save_profile_image(
            request, field='avatar_url', subdir='avatars', prefix='avatar',
            max_mb=ANIM_MAX_MB if ext in ANIM_EXTS else 5, stamped=True, profile=bot,
        )
        if isinstance(result, Response):
            return result
        return Response({"avatar_url": result, "bot": _bot_payload(bot, with_token=True)})


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


def _changed_authors(chat, since):
    """Авторы сообщений чата, у кого после since менялись ник или аватар:
    клиент подменит подписи у закэшированных сообщений."""
    try:
        rows = (Profile.objects.filter(identity_updated_at__gt=since, message__chat=chat)
                .distinct().values("id", "username", "avatar_url", "aura_color", "aura_text")[:200])
        return [{"id": str(r["id"]), "username": r["username"], "avatar_url": r["avatar_url"],
                 "aura_color": r["aura_color"], "aura_text": r["aura_text"]} for r in rows]
    except Exception:
        return []


def _touch_post(msg):
    """Реакция или комментарий меняют сводку поста: двигаем updated_at, чтобы
    since-синхронизация у остальных принесла свежие счётчики (у Стены и
    каналов нет сокета чата — только опрос)."""
    try:
        Message.objects.filter(id=msg.id).update(updated_at=timezone.now())
    except Exception:
        pass


def _post_payload(msg, request):
    """Пост канала = Message + сводка реакций/просмотров/комментов."""
    data = MessageSerializer(msg, context={"request": request}).data
    prof = _prof(request)
    # Сводка та же, что у сообщений ([{emoji, count, mine}]): реакции в
    # каналах и в переписке — одно и то же, и клиент рисует их одним
    # модулем (components/chat/Reactions.tsx).
    data["reactions_total"] = msg.reactions.count()
    data["comments_count"] = msg.comments.filter(deleted=False).count()
    data["views_count"] = msg.views.count()
    return data


def _fill_action_translations(action):
    """Пустые переводы действия — переводчиком (chat/translate.py). Фраза —
    шаблон с {who} и {whom}: метки должны дожить до перевода, иначе поле
    остаётся пустым и показывается русская фраза. Переводчик недоступен —
    тоже пусто, админ заполнит руками."""
    from .translate import translate_text
    def tr(text, lang):
        try:
            return (translate_text(text, lang, "ru") or "").strip()
        except Exception:
            logger.warning("действие %s: перевод на %s не удался", action.name, lang)
            return ""
    from .action_text import ru_self, ru_you
    # Русские формы для отправителя и адресата — по правилам; из них же переводы.
    if not action.phrase_ru_self:
        action.phrase_ru_self = ru_self(action.verb)[:120]
    if not action.phrase_ru_you:
        action.phrase_ru_you = ru_you(action.verb)[:120]
    sources = {
        "": (f"{{who}} {action.verb} {{whom}}", ("{who}", "{whom}")),
        "_self": (action.phrase_ru_self, ("{whom}",)),
        "_you": (action.phrase_ru_you, ("{who}",)),
    }
    for lang in ("en", "ko"):
        if not getattr(action, f"name_{lang}"):
            setattr(action, f"name_{lang}", tr(action.name, lang)[:40])
        for suffix, (src, marks) in sources.items():
            if getattr(action, f"phrase_{lang}{suffix}"):
                continue
            out = tr(src, lang)
            if all(m in out for m in marks):
                setattr(action, f"phrase_{lang}{suffix}", out[:120])


def _action_slug(action):
    from django.utils.text import slugify
    base = slugify(action.name_en or "")[:32] or "action"
    slug, n = base, 2
    while ChatAction.objects.filter(slug=slug).exclude(id=action.id).exists():
        slug, n = f"{base}-{n}", n + 1
    return slug


class ActionsView(APIView):
    """Каталог действий («подмигнуть», «обнять»…) для панели стикеров.
    Действия 18+ — только тем, кто подтвердил возраст (allow_adult).
    Админ: GET ?all=1 — весь каталог со скрытыми; POST — новое действие
    (пустые переводы заполнит переводчик)."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        me = _prof(request)
        if request.query_params.get("all") and me and is_admin_profile(me):
            return Response({"actions": ChatActionAdminSerializer(ChatAction.objects.all(), many=True).data})
        qs = ChatAction.objects.filter(is_active=True)
        if not (me and me.allow_adult):
            qs = qs.filter(adult=False)
        return Response({"actions": ChatActionSerializer(qs, many=True).data})

    def post(self, request):
        me = _prof(request)
        if not me or not is_admin_profile(me):
            return Response({"error": "Только для админа"}, status=403)
        ser = ChatActionAdminSerializer(data=request.data)
        if not ser.is_valid():
            return Response({"error": "Проверьте поля действия", "fields": ser.errors}, status=400)
        if not (ser.validated_data.get("name") or "").strip() or not (ser.validated_data.get("verb") or "").strip():
            return Response({"error": "Нужны кнопка и глагол"}, status=400)
        action = ChatAction(**ser.validated_data)
        # Новое — в конец списка.
        if "order" not in request.data:
            from django.db.models import Max
            action.order = (ChatAction.objects.aggregate(m=Max("order"))["m"] or 0) + 10
        _fill_action_translations(action)
        action.slug = _action_slug(action)
        action.save()
        return Response(ChatActionAdminSerializer(action).data, status=201)


class ActionDetailView(APIView):
    """PATCH actions/<id>/ (админ) — правка; пустые переводы снова заполнит
    переводчик. Удалять не даём — старые сообщения с действием потеряли бы
    текст; скрыть — is_active: false."""
    permission_classes = [permissions.IsAuthenticated]

    def patch(self, request, pk):
        me = _prof(request)
        if not me or not is_admin_profile(me):
            return Response({"error": "Только для админа"}, status=403)
        action = ChatAction.objects.filter(id=pk).first()
        if not action:
            return Response({"error": "Действие не найдено"}, status=404)
        ser = ChatActionAdminSerializer(action, data=request.data, partial=True)
        if not ser.is_valid():
            return Response({"error": "Проверьте поля действия", "fields": ser.errors}, status=400)
        for k, v in ser.validated_data.items():
            setattr(action, k, v)
        # Сменили кнопку или глагол — старые переводы не подходят, если их не прислали.
        for lang in ("en", "ko"):
            if "name" in request.data and f"name_{lang}" not in request.data:
                setattr(action, f"name_{lang}", "")
            if "verb" in request.data:
                for suffix in ("", "_self", "_you"):
                    if f"phrase_{lang}{suffix}" not in request.data:
                        setattr(action, f"phrase_{lang}{suffix}", "")
        _fill_action_translations(action)
        action.save()
        return Response(ChatActionAdminSerializer(action).data)


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


class TelegramChannelView(APIView):
    """POST {url} — подключить публичный Telegram-канал как канал WYX.

    Принимаем ссылку t.me/<канал>, @канал или просто имя. Канал создаётся в
    состоянии pending; воркер tg_mirror (отдельный контейнер с Telethon)
    вступает в него, забирает название, описание, аватар и последние посты,
    дальше пересылает новое в реальном времени. Постить в зеркало нельзя
    никому: владельца у него нет, реакции и комментарии — только наши."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        from .telegram_mirror import parse_channel_ref
        me = _prof(request)
        if not me:
            return Response({"error": "Нет профиля"}, status=403)
        username = parse_channel_ref(request.data.get("url") or "")
        if not username:
            return Response({"error": "Нужна ссылка на публичный канал или @имя"}, status=400)
        ch = Chat.objects.filter(tg_username__iexact=username).first()
        created = False
        if not ch:
            ch = Chat.objects.create(
                kind="channel", name=f"@{username}", description="", is_public=True,
                tg_username=username, tg_state="pending",
            )
            created = True
        cp, sub_created = ChatParticipant.objects.get_or_create(chat=ch, user=me, defaults={"role": "subscriber"})
        if sub_created:
            ch.subscribers_count = models.F("subscribers_count") + 1
            ch.save(update_fields=["subscribers_count"])
            ch.refresh_from_db(fields=["subscribers_count"])
        return Response({"channel": ChannelSerializer(ch, context={"request": request}).data}, status=201 if created else 200)


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


class ChannelByHandleView(APIView):
    """GET — канал по ссылке /c/<handle>: @username (без регистра) или uuid.
    Для «Поделиться каналом» — как /u/<ник> для профилей."""
    permission_classes = [permissions.IsAuthenticated]
    def get(self, request, handle):
        h = (handle or "").strip().lstrip("@")
        ch = None
        try:
            ch = _channel_or_none(uuid.UUID(h))
        except (ValueError, AttributeError):
            pass
        if not ch:
            ch = Chat.objects.filter(kind="channel", username__iexact=h).first()
        if not ch:
            return Response({"error": "Канал не найден"}, status=404)
        admins = ChatParticipant.objects.filter(chat=ch, role__in=("owner", "admin")).select_related("user")
        data = ChannelSerializer(ch, context={"request": request}).data
        data["admins"] = [{"id": str(a.user_id), "username": a.user.username, "role": a.role} for a in admins]
        return Response(data)


class ChatTranslateView(APIView):
    """GET/PATCH chats/<id>/translate/ — автоперевод в личке для меня:
    translate_out («переводить на язык собеседника»), translate_in («переводить
    сообщения на мой язык»). Отдаёт языки обоих, чтобы клиент показал, что
    переводить не на что, когда язык один."""
    permission_classes = [permissions.IsAuthenticated]

    def _part(self, request, pk):
        me = getattr(request.user, 'profile', None)
        chat = Chat.objects.filter(id=pk).first()
        if not me or not chat:
            return None, None, Response({"error": "Чат не найден"}, status=404)
        part = ChatParticipant.objects.filter(chat=chat, user=me).first()
        if not part:
            return None, None, Response({"error": "Вы не участник"}, status=403)
        return chat, part, None

    def _payload(self, chat, part):
        from .translate import provider, norm_lang, effective, translatable
        others = list(chat.participants.exclude(id=part.user_id).values_list("language", flat=True))
        peer = chat.participants.exclude(id=part.user_id).first()
        return {
            "translate_in": effective(part, "translate_in"), "translate_out": effective(part, "translate_out"),
            "explicit_in": part.translate_in is not None, "explicit_out": part.translate_out is not None,
            "my_language": norm_lang(part.user.language) or "ru",
            "peer_language": (norm_lang(peer.language) or "ru") if peer else None,
            "available": bool(provider()) and translatable(chat),
            "is_group": bool(chat.is_group),
            # Языки остальных участников — в группе их может быть несколько.
            "peer_languages": sorted({norm_lang(l) or "ru" for l in others}),
        }

    def get(self, request, pk):
        chat, part, err = self._part(request, pk)
        if err:
            return err
        return Response(self._payload(chat, part))

    def patch(self, request, pk):
        chat, part, err = self._part(request, pk)
        if err:
            return err
        for f in ("translate_in", "translate_out"):
            if f in request.data:
                setattr(part, f, bool(request.data.get(f)))
        part.save(update_fields=["translate_in", "translate_out"])
        return Response(self._payload(chat, part))


def _translate_voice(request, msg, me, to):
    """Перевод расшифровки голосового на язык to. Расшифровки ещё нет —
    запрашиваем её и переводим сразу после (в фоне); ответ — сообщение как
    есть, текст и перевод приедут через sync."""
    from .translate import translate_text, norm_lang, same_text, TranslateNotConfigured, provider
    from .transcribe import too_long, TOO_LONG_ERROR
    if msg.chat.kind == "secret":
        return Response({"error": "Голосовые секретного чата сервер не расшифрует"}, status=400)
    if too_long(msg) and not (msg.transcript_status == "done" and (msg.voice_transcript or "").strip()):
        return Response({"error": TOO_LONG_ERROR, "too_long": True}, status=422)
    if not provider():
        return Response({"error": "Перевод пока не настроен"}, status=503)
    text = (msg.voice_transcript or "").strip()
    if msg.transcript_status == "done" and text:
        if text == "(тишина)":
            return Response({"error": "Здесь переводить нечего"}, status=400)
        tr = dict(msg.transcript_translations or {})
        if to in tr and same_text(tr[to], text):
            tr.pop(to)
        if to not in tr:
            src = norm_lang(msg.transcript_lang) or (norm_lang(msg.sender.language) if msg.sender_id else "") or "ru"
            try:
                out = translate_text(text, to, src)
            except TranslateNotConfigured:
                return Response({"error": "Перевод пока не настроен"}, status=503)
            except Exception:
                logger.exception("translate voice on demand %s", msg.id)
                return Response({"error": "Не удалось перевести"}, status=502)
            if same_text(out, text):
                return Response({"error": "Сообщение уже на вашем языке"}, status=422)
            tr[to] = out
            msg.transcript_translations = tr
            msg.save(update_fields=["transcript_translations", "updated_at"])
        return Response(MessageSerializer(msg, context={'request': request}).data)
    me_id, update = str(me.id), []
    if me_id not in (msg.transcript_for or []):
        msg.transcript_for = [*(msg.transcript_for or []), me_id]
        update.append("transcript_for")
    start = msg.transcript_status not in ("done", "pending")
    if start:
        msg.transcript_status = "pending"
        update.append("transcript_status")
    if update:
        msg.save(update_fields=[*update, "updated_at"])
    import threading
    threading.Thread(target=_transcribe_then_translate, args=(str(msg.id), to, start), daemon=True).start()
    return Response(MessageSerializer(msg, context={'request': request}).data)


def _transcribe_then_translate(message_id, to, start):
    """Фон: расшифровать (или дождаться чужой расшифровки) и перевести на to."""
    import time
    from .transcribe import transcribe_message
    from .translate import translate_transcript_to
    try:
        if start:
            transcribe_message(message_id)
        else:
            for _ in range(90):
                st = Message.objects.filter(id=message_id).values_list("transcript_status", flat=True).first()
                if st != "pending":
                    break
                time.sleep(1)
        translate_transcript_to(message_id, to)
    except Exception:
        logger.exception("transcribe+translate %s", message_id)


class MessageTranslateView(APIView):
    """POST messages/<id>/translate/ {to} — перевод по запросу из меню
    сообщения (любой незашифрованный чат, где я участник или читатель)."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        from .translate import translate_text, norm_lang, same_text, TranslateNotConfigured
        me = getattr(request.user, 'profile', None)
        msg = Message.objects.filter(id=pk).select_related('chat', 'sender').first()
        if not me or not msg or not _can_see_chat(msg.chat, me):
            return Response({"error": "Сообщение не найдено"}, status=404)
        to = norm_lang(request.data.get("to")) or norm_lang(me.language) or "ru"
        # Голосовое — переводим расшифровку (из меню, если автоперевод не сработал).
        if not msg.cipher and msg.voice_url and not (msg.content or "").strip():
            return _translate_voice(request, msg, me, to)
        if msg.cipher or not (msg.content or "").strip():
            return Response({"error": "Здесь переводить нечего"}, status=400)
        tr = dict(msg.translations or {})
        if to in tr and same_text(tr[to], msg.content):
            tr.pop(to)  # старый «перевод», равный оригиналу, — переводим заново
        # Текст уже на этом языке (по письменности) — переводчик не зовём:
        # автоперевод Стены спрашивает про каждый видимый пост.
        from .translate import detect_lang
        if to not in tr and detect_lang(msg.content) == to:
            return Response({"error": "Сообщение уже на вашем языке"}, status=422)
        if to not in tr:
            try:
                src = norm_lang(msg.sender.language) if msg.sender_id else ""
                out = translate_text(msg.content, to, src)
                if same_text(out, msg.content):
                    return Response({"error": "Сообщение уже на вашем языке"}, status=422)
                tr[to] = out
            except TranslateNotConfigured:
                return Response({"error": "Перевод пока не настроен"}, status=503)
            except Exception:
                logger.exception("translate on demand %s", pk)
                return Response({"error": "Не удалось перевести"}, status=502)
            Message.objects.filter(id=pk).update(translations=tr)
            msg.translations = tr
        return Response(MessageSerializer(msg, context={'request': request}).data)


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
        if "comments_enabled" in request.data:
            ch.comments_enabled = str(request.data.get("comments_enabled")).lower() in ("1", "true", "yes"); fields.append("comments_enabled")
        if "notify_sound_id" in request.data:
            sid = request.data.get("notify_sound_id")
            ch.notify_sound = NotificationSound.objects.filter(id=sid, is_active=True).first() if sid else None
            fields.append("notify_sound")
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


class MyTracksView(APIView):
    """GET ?q= — вся моя музыка одним списком (по всем плейлистам, без
    повторов файла): выбор трека для отправки в чат."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        me = _prof(request)
        if not me:
            return Response({"error": "Нет профиля"}, status=403)
        q = (request.query_params.get("q") or "").strip()
        qs = PlaylistTrack.objects.filter(playlist__owner=me).select_related("playlist").order_by("-added_at")
        if q:
            qs = qs.filter(models.Q(title__icontains=q) | models.Q(artist__icontains=q))
        seen, out = set(), []
        for t in qs[:500]:
            if t.file_url in seen:
                continue
            seen.add(t.file_url)
            d = PlaylistTrackSerializer(t).data
            d["playlist_name"] = t.playlist.name
            out.append(d)
            if len(out) >= 200:
                break
        return Response({"tracks": out})


def _make_wallpaper(src_path, ext):
    """Обои из загруженного файла → (url, kind, poster_url).

    Картинки ужимаем до 1600 px по длинной стороне (jpg); gif и видео
    превращаем в беззвучный mp4 ≤720p, ≤30 с, 24 к/с — gif в браузере на весь
    экран ест процессор и память, mp4 в loop играет аппаратно. У видео делаем
    постер — его показывают те, кто выключил анимацию обоев.
    """
    import subprocess
    ext = (ext or "").lower()
    is_video = ext in ('.gif', '.mp4', '.mov', '.webm', '.m4v', '.mkv')
    key = f"wallpapers/{uuid.uuid4()}"
    out_rel = f"{key}.mp4" if is_video else f"{key}.jpg"
    out_full = os.path.join(settings.MEDIA_ROOT, out_rel)
    os.makedirs(os.path.dirname(out_full), exist_ok=True)
    if is_video:
        cmd = ["ffmpeg", "-y", "-t", "30", "-i", src_path, "-an",
               "-vf", "scale='trunc(min(720,iw)/2)*2:trunc(min(1280,ih)/2)*2:force_original_aspect_ratio=decrease',fps=24",
               "-c:v", "libx264", "-crf", "30", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out_full]
    else:
        cmd = ["ffmpeg", "-y", "-i", src_path, "-frames:v", "1", "-vf", "scale='trunc(min(1600,iw)/2)*2:-2'", "-q:v", "3", out_full]
    subprocess.run(cmd, check=True, timeout=240, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    poster = _make_poster(out_full, out_rel) if is_video else None
    # Анимированный WebP того же ролика (≤480 px, 15 к/с, ≤10 с): картинке
    # не нужен автозапуск — iOS в энергосбережении <video> без тапа не играет.
    anim = None
    if is_video:
        anim_rel = f"{key}.webp"
        anim_full = os.path.join(settings.MEDIA_ROOT, anim_rel)
        try:
            subprocess.run(["ffmpeg", "-y", "-t", "10", "-i", out_full, "-an",
                            "-vf", "scale='trunc(min(432,iw)/2)*2:-2',fps=24",
                            "-c:v", "libwebp_anim", "-lossless", "0", "-q:v", "60", "-compression_level", "4", "-loop", "0", anim_full],
                           check=True, timeout=240, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if s3_enabled():
                anim = s3_upload(anim_full, anim_rel, "image/webp")
                os.remove(anim_full)
            else:
                anim = f"/media/{anim_rel}"
        except Exception:
            logger.exception("wallpaper: webp не получился — останется только mp4")
    if s3_enabled():
        url = s3_upload(out_full, out_rel, "video/mp4" if is_video else "image/jpeg")
        os.remove(out_full)
    else:
        url = f"/media/{out_rel}"
    return url, ("video" if is_video else "image"), poster, anim


class ChatWallpaperView(APIView):
    """Обои чата. POST multipart {file, scope=chat|me}; DELETE ?scope=chat|me
    (scope=me при DELETE с ?hide=1 — «без обоев только у меня»).

    Общие обои видят оба собеседника; личные — только их владелец и поверх
    общих. В канале общие ставит только админ."""
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def _chat(self, request, pk):
        me = _prof(request)
        chat = Chat.objects.filter(pk=pk).first()
        if not me or not chat:
            return None, None, Response({"error": "Чат не найден"}, status=404)
        cp = ChatParticipant.objects.filter(chat=chat, user=me).first()
        if not cp:
            return None, None, Response({"error": "Вы не участник чата"}, status=403)
        return chat, cp, None

    def _notify(self, chat, request):
        """Собеседникам — событие: обои сменились, пусть перечитают чат."""
        try:
            from channels.layers import get_channel_layer
            from asgiref.sync import async_to_sync
            layer = get_channel_layer()
            if not layer:
                return
            for pid in chat.participants.values_list('id', flat=True):
                async_to_sync(layer.group_send)(f"user_{pid}", {"type": "notification", "data": {"type": "wallpaper", "chat_id": str(chat.id)}})
        except Exception:
            logger.exception("wallpaper: сокет не ответил")

    def post(self, request, pk):
        chat, cp, err = self._chat(request, pk)
        if err:
            return err
        scope = (request.data.get("scope") or "chat").lower()
        if scope == "chat" and chat.kind == "channel" and cp.role not in ("owner", "admin"):
            return Response({"error": "Обои канала меняет админ"}, status=403)
        f = request.FILES.get("file")
        if not f:
            return Response({"error": "Нет файла"}, status=400)
        if f.size > 60 * 1024 * 1024:
            return Response({"error": "Файл больше 60 МБ"}, status=400)
        import tempfile, shutil
        ext = os.path.splitext(f.name or "")[1].lower() or (".mp4" if (f.content_type or "").startswith("video/") else ".jpg")
        if ext not in ('.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.bmp', '.gif', '.mp4', '.mov', '.webm', '.m4v', '.mkv'):
            return Response({"error": "Нужна картинка, gif или видео"}, status=400)
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=ext)
        try:
            for chunk in f.chunks():
                tmp.write(chunk)
            tmp.close()
            url, kind, poster, anim = _make_wallpaper(tmp.name, ext)
        except Exception:
            logger.exception("wallpaper: конвертация не удалась")
            return Response({"error": "Не удалось обработать файл"}, status=400)
        finally:
            try:
                os.unlink(tmp.name)
            except Exception:
                pass
        if scope == "me":
            cp.wallpaper_url, cp.wallpaper_kind, cp.wallpaper_poster, cp.wallpaper_anim = url, kind, poster, anim
            cp.save(update_fields=["wallpaper_url", "wallpaper_kind", "wallpaper_poster", "wallpaper_anim"])
        else:
            chat.wallpaper_url, chat.wallpaper_kind, chat.wallpaper_poster, chat.wallpaper_anim = url, kind, poster, anim
            chat.save(update_fields=["wallpaper_url", "wallpaper_kind", "wallpaper_poster", "wallpaper_anim"])
            self._notify(chat, request)
        return Response({"url": url, "kind": kind, "poster": poster, "anim": anim, "scope": scope})

    def delete(self, request, pk):
        chat, cp, err = self._chat(request, pk)
        if err:
            return err
        scope = (request.query_params.get("scope") or "chat").lower()
        if scope == "me":
            # hide=1 — у меня без обоев, даже если у чата они есть; иначе — как у чата.
            hide = str(request.query_params.get("hide") or "").lower() in ("1", "true", "yes")
            cp.wallpaper_url, cp.wallpaper_kind, cp.wallpaper_poster, cp.wallpaper_anim = None, ("none" if hide else ""), None, None
            cp.save(update_fields=["wallpaper_url", "wallpaper_kind", "wallpaper_poster", "wallpaper_anim"])
            return Response({"ok": True, "scope": "me", "kind": cp.wallpaper_kind})
        if chat.kind == "channel" and cp.role not in ("owner", "admin"):
            return Response({"error": "Обои канала меняет админ"}, status=403)
        chat.wallpaper_url, chat.wallpaper_kind, chat.wallpaper_poster, chat.wallpaper_anim = None, "", None, None
        chat.save(update_fields=["wallpaper_url", "wallpaper_kind", "wallpaper_poster", "wallpaper_anim"])
        self._notify(chat, request)
        return Response({"ok": True, "scope": "chat"})


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


class ChannelMuteView(APIView):
    """POST {muted: bool} — выключить/включить пуши канала для себя. Посты
    приходят как прежде, только без уведомления и звука."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        ch = _channel_or_none(pk)
        if not ch:
            return Response({"error": "Канал не найден"}, status=404)
        cp = ChatParticipant.objects.filter(chat=ch, user=_prof(request)).first()
        if not cp:
            return Response({"error": "Вы не подписаны на канал"}, status=400)
        cp.muted = bool(request.data.get("muted", True))
        cp.save(update_fields=["muted"])
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
    """GET — лента канала со сводкой откликов, постранично и приращениями
    (как /messages/sync/ у чатов, чтобы клиент держал кэш и не тянул всё
    при каждом входе): limit ≤ 200 (50), before=<ISO> — страница старее,
    since=<ISO> — всё, что менялось после (новые/правленые; удалённые — в
    deleted). Ответ: {posts, deleted, has_more, now}."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk):
        from django.utils.dateparse import parse_datetime
        ch = _channel_or_none(pk)
        if not ch:
            return Response({"error": "Канал не найден"}, status=404)
        me = _prof(request)
        if not ch.is_public and _role_in(ch, me) is None:
            return Response({"error": "Канал приватный"}, status=403)
        try:
            limit = max(1, min(int(request.query_params.get('limit') or 50), 200))
        except ValueError:
            limit = 50
        now = timezone.now()
        base = Message.objects.filter(chat=ch).select_related("sender", "sound")
        since = parse_datetime(request.query_params.get('since') or '')
        if since:
            changed = list(base.filter(updated_at__gt=since).order_by('created_at'))
            return Response({
                "posts": [_post_payload(m, request) for m in changed if not m.deleted_for_all],
                "deleted": [str(m.id) for m in changed if m.deleted_for_all],
                "authors": _changed_authors(ch, since),
                "has_more": False, "now": now.isoformat(),
            })
        qs = base.filter(deleted_for_all=False)
        before = parse_datetime(request.query_params.get('before') or '')
        if before:
            qs = qs.filter(created_at__lt=before)
        page = list(qs.order_by("-created_at")[:limit + 1])
        has_more = len(page) > limit
        posts = page[:limit][::-1]
        return Response({"posts": [_post_payload(m, request) for m in posts], "deleted": [],
                         "has_more": has_more, "now": now.isoformat()})


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
        # Те же правила, что у сообщений: повторное нажатие снимает, разных
        # реакций — не больше предела профиля.
        if not PostReaction.objects.filter(post=msg, user=me, value=value[:64]).delete()[0]:
            limit = me.reaction_limit or 3
            if PostReaction.objects.filter(post=msg, user=me).count() >= limit:
                return Response({"error": "Больше реакций на этот пост поставить нельзя", "limit": limit}, status=409)
            PostReaction.objects.create(
                post=msg, user=me, value=value[:64],
                kind=(request.data.get("kind") or "emoji")[:10],
            )
        _touch_post(msg)
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
        if msg.chat.kind == "wall":
            from .wall import wall_ban, ban_payload
            ban = wall_ban(me)
            if ban:
                return Response({"error": "Вам запрещено писать на Стену", "wall_ban": ban_payload(ban)}, status=403)
        elif not ChatParticipant.objects.filter(chat=msg.chat, user=me).exists():
            return Response({"error": "Подпишитесь, чтобы комментировать"}, status=403)
        if msg.chat.kind == "channel" and not msg.chat.comments_enabled:
            return Response({"error": "В этом канале комментарии выключены"}, status=403)
        content = (request.data.get("content") or "").strip()
        if not content:
            return Response({"error": "Пустой комментарий"}, status=400)
        parent = None
        parent_id = request.data.get("parent")
        if parent_id:
            parent = PostComment.objects.filter(id=parent_id, post=msg).first()
        c = PostComment.objects.create(post=msg, author=me, parent=parent, content=content[:2000])
        _touch_post(msg)
        return Response(PostCommentSerializer(c).data, status=201)


class PostCommentDetailView(APIView):
    """DELETE — удалить коммент (автор или админ канала)."""
    permission_classes = [permissions.IsAuthenticated]

    def delete(self, request, pk):
        c = PostComment.objects.filter(pk=pk).select_related("post", "post__chat").first()
        if not c:
            return Response({"error": "Комментарий не найден"}, status=404)
        me = _prof(request)
        from .serializers import is_admin_profile
        wall_admin = c.post.chat.kind == "wall" and me and is_admin_profile(me)
        if c.author_id != (me.id if me else None) and _role_in(c.post.chat, me) not in ("owner", "admin") and not wall_admin:
            return Response({"error": "Нельзя удалить чужой комментарий"}, status=403)
        c.deleted = True
        c.save(update_fields=["deleted"])
        _touch_post(c.post)
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



class SavedImageVibeView(APIView):
    """POST /saved-images/<id>/vibe/ — поднять вайб владельцу за эту
    сохранёнку (двойной тап или сердечко в просмотре): +1 к его вайбометру,
    один раз от человека на картинку. Свои не считаются. Пуш владельцу — не
    чаще раза в 10 минут от одного человека: пролистал галерею двойными
    тапами — одно уведомление, а не двадцать."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk=None):
        from django.db import IntegrityError, transaction
        from datetime import timedelta
        from .moderation import can_see_saved
        from .ideabox import _notify_vibe
        me = getattr(request.user, 'profile', None)
        item = SavedImage.objects.filter(id=pk).select_related('owner').first()
        if me is None or not item or not can_see_saved(item.owner_id, me.id):
            return Response({"error": "Не найдено"}, status=404)
        owner = item.owner
        state = lambda: {"vibes": item.vibes.count(), "vibed": item.vibes.filter(voter=me).exists()}
        if owner.id == me.id:
            return Response({**state(), "error": "Свой вайб не поднять"}, status=400)
        if owner.is_bot:
            return Response({**state(), "error": "У ботов вайбометра нет"}, status=400)
        try:
            with transaction.atomic():
                vote = SavedImageVibe.objects.create(image=item, voter=me)
                Profile.objects.filter(id=owner.id).update(vibe=models.F('vibe') + 1)
        except IntegrityError:
            return Response({**state(), "error": "Вы уже подняли вайб за эту сохранёнку"}, status=409)
        owner.refresh_from_db(fields=['vibe'])
        recent = SavedImageVibe.objects.filter(
            voter=me, image__owner=owner, created_at__gte=timezone.now() - timedelta(minutes=10),
        ).exclude(id=vote.id).exists()
        _notify_vibe(owner, me, anonymous=False, saved=True, push=not recent)
        return Response({**state(), "vibe": owner.vibe})


class SavedImagesView(APIView):
    """Сохранёнки. GET — свои или чужие (?profile=<id>, ?limit=N); POST
    {message_id} — сохранить картинку из сообщения (нужен доступ к чату);
    DELETE /saved-images/<id>/ — удалить свою."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        profile = getattr(request.user, 'profile', None)
        if profile is None:
            return Response({"error": "Profile not found"}, status=400)
        owner_id = request.query_params.get('profile') or profile.id
        # Настройка владельца: «все», «избранные» или «никто» (см. can_see_saved).
        from .moderation import can_see_saved
        if not can_see_saved(owner_id, profile.id):
            return Response({"count": 0, "items": [], "hidden": True})
        qs = SavedImage.objects.filter(owner_id=owner_id)
        total = qs.count()
        try:
            limit = min(int(request.query_params.get('limit', 200)), 500)
        except ValueError:
            limit = 200
        # Вайб за каждую картинку: сколько подняли и поднимал ли я.
        qs = qs.annotate(
            _vibes=models.Count('vibes', distinct=True),
            _vibed=models.Exists(SavedImageVibe.objects.filter(image_id=models.OuterRef('pk'), voter=profile)),
        )
        return Response({"count": total, "items": SavedImageSerializer(qs[:limit], many=True).data})

    def post(self, request):
        profile = getattr(request.user, 'profile', None)
        if profile is None:
            return Response({"error": "Profile not found"}, status=400)
        msg = Message.objects.filter(id=request.data.get('message_id')).select_related('chat').first()
        if not msg or not msg.file_url:
            return Response({"error": "Сообщение с картинкой не найдено"}, status=404)
        if not _can_see_chat(msg.chat, profile):
            return Response({"error": "Нет доступа к сообщению"}, status=403)
        name = (msg.file_name or msg.file_url or '').lower()
        if not re.search(r'\.(jpe?g|png|gif|webp|heic|heif|bmp)$', name.split('?')[0]):
            return Response({"error": "Сохранять можно только картинки"}, status=400)
        item, created = SavedImage.objects.get_or_create(
            owner=profile, file_url=msg.file_url,
            defaults={"file_name": msg.file_name or "", "source_message": msg},
        )
        return Response(SavedImageSerializer(item).data, status=201 if created else 200)

    def delete(self, request, pk=None):
        profile = getattr(request.user, 'profile', None)
        item = SavedImage.objects.filter(id=pk, owner=profile).first()
        if not item:
            return Response({"error": "Не найдено"}, status=404)
        item.delete()
        return Response(status=204)



# ── Импорт стикерпака из Telegram ─────────────────────────────────────────────
# Ссылка t.me/addstickers/<name> → Bot API getStickerSet (нужен TG_BOT
# или TELEGRAM_BOT_TOKEN в .env) → файлы качаются в фоне в media/stickers: .webp (статика), .tgs
# (анимация Lottie, gzip) и .webm (видео). Прогресс — в памяти процесса.
IMPORT_PROGRESS = {}


def _tg_session():
    """Одна keep-alive сессия на весь импорт. До Telegram с сервера доходит
    только IPv6 через NAT66, и там теряется примерно каждый восьмой SYN:
    свежее соединение на каждый запрос давало ConnectTimeout по 30 с и
    дырявые паки (28/34). По одному соединению 16 запросов уходят за секунду;
    Retry с бэкоффом добивает те SYN, что всё же потерялись."""
    import requests
    from requests.adapters import HTTPAdapter
    from urllib3.util.retry import Retry
    s = requests.Session()
    retry = Retry(total=4, connect=4, read=2, backoff_factor=0.5,
                  status_forcelist=(429, 500, 502, 503, 504), allowed_methods=frozenset(['GET']))
    s.mount('https://', HTTPAdapter(max_retries=retry, pool_connections=1, pool_maxsize=2))
    return s


TG_TIMEOUT = (10, 60)  # connect, read


def _tg_pack_name(url):
    m = re.search(r'(?:addstickers/|addemoji/|set=)([A-Za-z0-9_]+)', url or '')
    return m.group(1) if m else None


def _webm_sticker_to_webp(src_path, size=160):
    """Видеостикер Telegram (.webm, VP9 с прозрачностью) → анимированный WebP.

    iPhone не показывает webm картинкой, а видео VP9 с прозрачностью не
    играет вовсе: набор из 120 таких стикеров грузился и оставался пустым.
    Анимированный WebP понимают и iOS, и Android, и десктоп, прозрачность
    сохраняется. Декодер libvpx-vp9 указан явно: встроенный vp9 теряет альфу.
    Возвращает путь к .webp или None, если сконвертировать не вышло.
    """
    import subprocess
    dst = os.path.splitext(src_path)[0] + '.webp'
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-c:v", "libvpx-vp9", "-i", src_path,
             # 160 px и 15 кадров в секунду: стикер в чате меньше этого, а вес
             # ~130 КБ вместо ~500 КБ при 256 px/24 к/с (набор из 120 стикеров —
             # 16 МБ вместо 61 МБ). Проверено на реальном наборе.
             "-vf", f"fps=15,scale='min({size},iw)':-2:flags=lanczos",
             "-loop", "0", "-an", "-c:v", "libwebp_anim",
             # compression_level 4: в 20 раз быстрее 6 (0,6 с против 11 с на
             # стикер) при файле тяжелее всего на ~7%.
             "-lossless", "0", "-q:v", "55", "-compression_level", "4", dst],
            check=True, timeout=60, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        if os.path.getsize(dst) > 0:
            return dst
    except Exception:
        logger.warning("Видеостикер не сконвертировался: %s", src_path)
    try:
        if os.path.exists(dst):
            os.remove(dst)
    except OSError:
        pass
    return None


def _tg_emoji_file(data, ext):
    """Эмодзи из Telegram → файл в media/emoji (оттуда сервер берёт картинки
    своих эмодзи, chat/formatting.py): .tgs (Lottie) — как есть, приложение
    его проигрывает; видео .webm — анимированный WebP 100 px; картинка — PNG
    100 px. Возвращает адрес или None."""
    import os as _os
    from django.conf import settings as _settings
    emoji_dir = _os.path.join(_settings.MEDIA_ROOT, 'emoji')
    _os.makedirs(emoji_dir, exist_ok=True)
    stem = str(uuid.uuid4())
    src = _os.path.join(emoji_dir, stem + ext)
    with open(src, 'wb') as out:
        out.write(data)
    if ext == '.tgs':
        return f'/media/emoji/{stem}.tgs'
    try:
        if ext == '.webm':
            webp = _webm_sticker_to_webp(src, size=100)
            return f'/media/emoji/{stem}.webp' if webp else None
        return _emoji_image(src)
    finally:
        try:
            _os.remove(src)
        except OSError:
            pass


def _tg_import_worker(pack_id, token, stickers, profile_id, kind='sticker'):
    import os as _os
    from django.conf import settings as _settings
    prog = IMPORT_PROGRESS[pack_id]
    http = _tg_session()
    stickers_dir = _os.path.join(_settings.MEDIA_ROOT, 'stickers')
    _os.makedirs(stickers_dir, exist_ok=True)
    order = 0
    for st in stickers:
        try:
            f = http.get(f'https://api.telegram.org/bot{token}/getFile', params={'file_id': st['file_id']}, timeout=TG_TIMEOUT).json()
            path = f.get('result', {}).get('file_path')
            if not path:
                prog['failed'] += 1; continue
            data = http.get(f'https://api.telegram.org/file/bot{token}/{path}', timeout=TG_TIMEOUT).content
            ext = _os.path.splitext(path)[1].lower() or ('.tgs' if st.get('is_animated') else '.webm' if st.get('is_video') else '.webp')
            if kind == 'emoji':
                url = _tg_emoji_file(data, ext)
                if not url:
                    prog['failed'] += 1; continue
                Sticker.objects.create(pack_id=pack_id, file_url=url, file_name=url.rsplit('/', 1)[-1],
                                       emoji=(st.get('emoji') or '')[:10], order=order,
                                       repaint=bool(st.get('needs_repainting')))
                order += 1
                prog['done'] += 1
                continue
            name = f'{uuid.uuid4()}{ext}'
            with open(_os.path.join(stickers_dir, name), 'wb') as out:
                out.write(data)
            if ext == '.webm':
                # Видеостикер — в анимированный WebP, иначе на iPhone пусто.
                webp = _webm_sticker_to_webp(_os.path.join(stickers_dir, name))
                if webp:
                    _os.remove(_os.path.join(stickers_dir, name))
                    name = _os.path.basename(webp)
            Sticker.objects.create(pack_id=pack_id, file_url=f'/media/stickers/{name}', file_name=name,
                                   emoji=(st.get('emoji') or '')[:10], order=order)
            order += 1
            prog['done'] += 1
        except Exception:
            logger.exception('telegram sticker import failed')
            prog['failed'] += 1
    prog['finished'] = True


class TelegramStickerImportView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        import threading
        profile = getattr(request.user, 'profile', None)
        if profile is None:
            return Response({"error": "Profile not found"}, status=400)
        token = (os.getenv('TELEGRAM_BOT_TOKEN') or os.getenv('TG_BOT') or '').strip()
        if not token:
            return Response({"error": "На сервере не задан токен бота (TG_BOT)"}, status=503)
        name = _tg_pack_name(request.data.get('url') or request.data.get('name'))
        if not name:
            return Response({"error": "Не похоже на ссылку на набор стикеров или эмодзи"}, status=400)
        try:
            r = _tg_session().get(f'https://api.telegram.org/bot{token}/getStickerSet', params={'name': name}, timeout=TG_TIMEOUT).json()
        except Exception:
            return Response({"error": "Сервис с набором не отвечает"}, status=502)
        if not r.get('ok'):
            return Response({"error": r.get('description') or "Пак не найден"}, status=404)
        s = r['result']
        stickers = [x for x in s.get('stickers', []) if x.get('file_id')][:200]
        # Набор эмодзи Telegram (t.me/addemoji/…) — набор своих эмодзи WYX.
        kind = 'emoji' if s.get('sticker_type') == 'custom_emoji' else 'sticker'
        pack = StickerPack.objects.create(name=(s.get('title') or name)[:100], description=f'Импорт по ссылке: {name}',
                                          author=profile, is_public=True, kind=kind)
        UserStickerPack.objects.get_or_create(user=profile, pack=pack)
        IMPORT_PROGRESS[str(pack.id)] = {'total': len(stickers), 'done': 0, 'failed': 0, 'finished': not stickers,
                                         'animated': sum(1 for x in stickers if x.get('is_animated')),
                                         'video': sum(1 for x in stickers if x.get('is_video')), 'kind': kind}
        threading.Thread(target=_tg_import_worker, args=(str(pack.id), token, stickers, str(profile.id), kind), daemon=True).start()
        return Response({"pack_id": str(pack.id), "name": pack.name, **IMPORT_PROGRESS[str(pack.id)]}, status=202)

    def get(self, request, pk=None):
        prog = IMPORT_PROGRESS.get(str(pk))
        if not prog:
            pack = StickerPack.objects.filter(id=pk).first()
            if not pack:
                return Response({"error": "not found"}, status=404)
            n = pack.stickers.count()
            return Response({'total': n, 'done': n, 'failed': 0, 'finished': True})
        return Response(prog)


# ── Музыка (Creative Space) ───────────────────────────────────────────────────
class MusicView(APIView):
    """Фонотека Creative Space. СЕЙЧАС НЕ ИСПОЛЬЗУЕТСЯ: музыку загружают
    сообщениями, а плеер в приложении собирает очередь из аудио переписки
    (sux-chat-app/src/lib/player.ts). Страница студии раздел «Музыка»
    больше не показывает; ручка и модель оставлены, пока не решено,
    удалять ли их вместе с миграцией.

    GET — общая библиотека (?mine=1 — только мои); POST — загрузить трек
    (multipart: file, title, artist); DELETE /music/<id>/ — своё."""
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def get(self, request):
        profile = getattr(request.user, 'profile', None)
        qs = MusicTrack.objects.select_related('owner')
        if request.query_params.get('mine'):
            qs = qs.filter(owner=profile)
        return Response({"items": MusicTrackSerializer(qs[:500], many=True).data})

    def post(self, request):
        import subprocess, tempfile, json as _json
        from django.core.files import File
        profile = getattr(request.user, 'profile', None)
        if profile is None:
            return Response({"error": "Profile not found"}, status=400)
        f = request.FILES.get('file')
        if not f:
            return Response({"error": "Нет файла"}, status=400)
        if f.size > 40 * 1024 * 1024:
            return Response({"error": "Файл больше 40 МБ"}, status=400)
        ext = os.path.splitext(f.name)[1].lower()
        if ext not in ('.mp3', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wav', '.flac'):
            return Response({"error": "Поддерживаются mp3, m4a, aac, ogg, opus, wav, flac"}, status=400)
        title = (request.data.get('title') or os.path.splitext(f.name)[0])[:120]
        artist = (request.data.get('artist') or '')[:120]
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=ext)
        for chunk in f.chunks():
            tmp.write(chunk)
        tmp.close()
        duration = 0
        try:
            out = subprocess.run(['ffprobe', '-v', 'quiet', '-print_format', 'json', '-show_format', tmp.name],
                                 capture_output=True, timeout=60).stdout
            info = _json.loads(out or b'{}').get('format', {})
            duration = int(float(info.get('duration', 0)))
            tags = info.get('tags', {}) or {}
            if not request.data.get('title') and tags.get('title'):
                title = tags['title'][:120]
            if not artist and tags.get('artist'):
                artist = tags['artist'][:120]
        except Exception:
            logger.exception('ffprobe failed')
        track = MusicTrack(owner=profile, title=title, artist=artist, duration=duration)
        with open(tmp.name, 'rb') as src:
            track.file.save(f'{uuid.uuid4()}{ext}', File(src), save=True)
        try:
            os.remove(tmp.name)
        except Exception:
            pass
        return Response(MusicTrackSerializer(track).data, status=201)

    def delete(self, request, pk=None):
        profile = getattr(request.user, 'profile', None)
        track = MusicTrack.objects.filter(id=pk, owner=profile).first()
        if not track:
            return Response({"error": "Не найдено"}, status=404)
        try:
            if track.file and os.path.exists(track.file.path):
                os.remove(track.file.path)
        except Exception:
            pass
        track.delete()
        return Response(status=204)


# ---- Жалобы и блокировки (App Store 1.2: контроль пользовательского контента) ----

def _report_snapshot(target_type, target_id):
    """Что именно вызвало жалобу — текстом, на момент подачи.

    Автор может удалить сообщение или переименовать пак сразу после жалобы;
    без снимка модератор увидел бы пустоту. Возвращает (текст, на кого жалоба).
    """
    if target_type == "message":
        m = Message.objects.filter(id=target_id).select_related("sender").first()
        if not m:
            return "", None
        parts = [f"«{(m.content or '')[:500]}»" if m.content else "(без текста)"]
        if m.file_url:
            parts.append(f"вложение: {m.file_name or m.file_url}")
        return " · ".join(parts), m.sender
    if target_type == "user":
        p = Profile.objects.filter(id=target_id).first()
        return (f"{p.username} — {(p.bio or '')[:200]}" if p else ""), p
    if target_type == "chat":
        c = Chat.objects.filter(id=target_id).first()
        return (f"{c.name or c.username or c.id} ({c.kind})" if c else ""), (c.creator if c else None)
    if target_type == "sound_pack":
        pack = SoundPack.objects.filter(id=target_id).first()
        if not pack:
            return "", None
        names = ", ".join(pack.sounds.values_list("name", flat=True)[:20])
        return f"пак «{pack.name}»: {names}", pack.creator
    if target_type == "sticker_pack":
        pack = StickerPack.objects.filter(id=target_id).first()
        return (f"пак «{pack.name}»" if pack else ""), getattr(pack, "author", None)
    if target_type == "theme":
        theme = Theme.objects.filter(id=target_id).first()
        return (f"тема «{theme.name}»" if theme else ""), (theme.author if theme else None)
    if target_type == "track":
        # Трек из чужого плейлиста или эфира. Файл — в снимке: по нему админ
        # снимает трек везде (MusicTakedownView), даже если плейлист удалят.
        t = PlaylistTrack.objects.filter(id=target_id).select_related("playlist__owner").first()
        if not t:
            return "", None
        name = f"{t.artist} — {t.title}" if t.artist else t.title
        return (f"трек «{name}» в плейлисте «{t.playlist.name}» · id {t.id} · файл {t.file_url}"), t.playlist.owner
    return "", None


class ReportView(APIView):
    """POST — пожаловаться на пользователя, сообщение, чат или пак.

    Жалоба сохраняется и тут же уходит сообщением в системный чат «Жалобы»
    (см. moderation.py): разбирают её там, а не в отдельной панели.
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        from .moderation import deliver

        me = getattr(request.user, "profile", None)
        if not me:
            return Response({"error": "Нет профиля"}, status=403)

        target_type = (request.data.get("target_type") or "").strip()
        target_id = str(request.data.get("target_id") or "").strip()
        reason = (request.data.get("reason") or "").strip()
        comment = (request.data.get("comment") or "").strip()[:2000]

        valid_targets = {t[0] for t in Report.TARGETS}
        valid_reasons = {r[0] for r in Report.REASONS}
        if target_type not in valid_targets:
            return Response({"error": "Неизвестный тип объекта"}, status=400)
        if reason not in valid_reasons:
            return Response({"error": "Не выбрана причина"}, status=400)
        if not target_id:
            return Response({"error": "Не указан объект"}, status=400)

        snapshot, target_profile = _report_snapshot(target_type, target_id)
        # На себя жаловаться незачем — обычно это промах по меню.
        if target_profile and target_profile.id == me.id:
            return Response({"error": "Это ваш собственный контент"}, status=400)

        report = Report.objects.create(
            reporter=me,
            target_type=target_type,
            target_id=target_id[:64],
            target_profile=target_profile,
            reason=reason,
            comment=comment,
            snapshot=snapshot[:4000],
        )
        deliver(report)
        # Жалоба снимает вайб тому, на кого жалуются (у ботов вайбометра нет).
        if target_profile and not target_profile.is_bot:
            from .models import VIBE_REPORT_PENALTY
            Profile.objects.filter(id=target_profile.id).update(vibe=models.F('vibe') - VIBE_REPORT_PENALTY)
        return Response({"ok": True, "id": str(report.id)}, status=201)


AUDIO_RE = re.compile(r"\.(mp3|m4a|aac|flac|wav|ogg|opus|weba|webm)$")


class MusicTakedownView(APIView):
    """POST {track_id} — админ снимает файл по жалобе правообладателя: из всех
    плейлистов и эфиров, а сообщения с этим файлом удаляются у всех. Подписанная
    ссылка на файл после этого никому не выдаётся (MediaSignView)."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        from .radio import before_track_removed
        me = _prof(request)
        if not me or not is_admin_profile(me):
            return Response({"error": "Только для админов"}, status=403)
        t = PlaylistTrack.objects.filter(id=request.data.get("track_id")).first()
        if not t:
            return Response({"error": "Трек не найден"}, status=404)
        url = t.file_url
        rows = list(PlaylistTrack.objects.filter(file_url=url))
        for row in rows:
            before_track_removed(row)
            row.delete()
        msgs = Message.objects.filter(file_url=url).exclude(deleted_for_all=True).update(deleted_for_all=True)
        logger.info("takedown %s: плейлистов %s, сообщений %s (админ %s)", url, len(rows), msgs, me.username)
        return Response({"ok": True, "tracks": len(rows), "messages": msgs})


def _default_playlist(profile):
    """«Моя музыка» — создаётся при первом обращении, как чат «Избранное»."""
    pl = Playlist.objects.filter(owner=profile, is_default=True).first()
    if not pl:
        pl = Playlist.objects.create(owner=profile, name="Моя музыка", is_default=True)
    return pl


class PlaylistsView(APIView):
    """GET — мои плейлисты (первый — «Моя музыка»). POST {name} — создать."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        me = _prof(request)
        if not me:
            return Response({"error": "Нет профиля"}, status=403)
        _default_playlist(me)
        rows = Playlist.objects.filter(owner=me).prefetch_related("tracks")
        return Response({"playlists": PlaylistSerializer(rows, many=True).data})

    def post(self, request):
        me = _prof(request)
        if not me:
            return Response({"error": "Нет профиля"}, status=403)
        name = (request.data.get("name") or "").strip()[:60]
        if not name:
            return Response({"error": "Название пустое"}, status=400)
        # «Моя музыка» должна существовать раньше остальных: иначе у того, кто
        # начал со своего плейлиста, её бы не было вовсе.
        _default_playlist(me)
        if Playlist.objects.filter(owner=me).count() >= 50:
            return Response({"error": "Слишком много плейлистов"}, status=409)
        pl = Playlist.objects.create(owner=me, name=name)
        return Response(PlaylistSerializer(pl).data, status=201)


class PlaylistView(APIView):
    """GET — треки. PATCH {name} — переименовать. DELETE — удалить
    (кроме «Моей музыки»: она одна и всегда есть)."""
    permission_classes = [permissions.IsAuthenticated]

    def _mine(self, request, pk):
        return Playlist.objects.filter(id=pk, owner=_prof(request)).first()

    def get(self, request, pk):
        pl = self._mine(request, pk)
        if not pl:
            return Response({"error": "Плейлист не найден"}, status=404)
        return Response({
            "playlist": PlaylistSerializer(pl).data,
            "tracks": PlaylistTrackSerializer(pl.tracks.all(), many=True).data,
        })

    def patch(self, request, pk):
        """{name?, is_public?} — переименовать и/или открыть собеседникам."""
        pl = self._mine(request, pk)
        if not pl:
            return Response({"error": "Плейлист не найден"}, status=404)
        fields = []
        if "name" in request.data:
            name = (request.data.get("name") or "").strip()[:60]
            if not name:
                return Response({"error": "Название пустое"}, status=400)
            pl.name = name
            fields.append("name")
        if "is_public" in request.data:
            pl.is_public = request.data.get("is_public") in (True, "true", "1", 1)
            fields.append("is_public")
        if not fields:
            return Response({"error": "Нечего менять"}, status=400)
        pl.save(update_fields=fields + ["updated_at"])
        return Response(PlaylistSerializer(pl).data)

    def delete(self, request, pk):
        pl = self._mine(request, pk)
        if not pl:
            return Response({"error": "Плейлист не найден"}, status=404)
        if pl.is_default:
            return Response({"error": "«Моя музыка» не удаляется"}, status=400)
        pl.delete()
        return Response(status=204)


class PlaylistShareView(APIView):
    """POST — открыть плейлист по ссылке (вернёт ключ). DELETE — закрыть доступ."""
    permission_classes = [permissions.IsAuthenticated]

    def _mine(self, request, pk):
        return Playlist.objects.filter(id=pk, owner=_prof(request)).first()

    def post(self, request, pk):
        import secrets
        pl = self._mine(request, pk)
        if not pl:
            return Response({"error": "Плейлист не найден"}, status=404)
        if not pl.share_token:
            pl.share_token = secrets.token_urlsafe(16)[:32]
            pl.save(update_fields=["share_token"])
        return Response({"share_token": pl.share_token})

    def delete(self, request, pk):
        pl = self._mine(request, pk)
        if not pl:
            return Response({"error": "Плейлист не найден"}, status=404)
        pl.share_token = ""
        pl.save(update_fields=["share_token"])
        return Response(status=204)


class SharedPlaylistView(APIView):
    """Плейлист по ссылке: GET — посмотреть и послушать, POST — забрать себе.

    Открывает любой, у кого есть ключ: плейлист становится общим только после
    того, как владелец сам нажал «Поделиться», и ссылку можно отозвать.
    """
    permission_classes = [permissions.IsAuthenticated]

    def _by_token(self, token):
        return Playlist.objects.filter(share_token=token).exclude(share_token="").first()

    def get(self, request, token):
        pl = self._by_token(token)
        if not pl:
            return Response({"error": "Плейлист не найден или ссылка отозвана"}, status=404)
        return Response({
            "playlist": PlaylistSerializer(pl).data,
            "owner": pl.owner.username,
            "tracks": PlaylistTrackSerializer(pl.tracks.all(), many=True).data,
        })

    def post(self, request, token):
        """Скопировать себе: треки те же, плейлист свой — чужой не меняется."""
        me = _prof(request)
        pl = self._by_token(token)
        if not me or not pl:
            return Response({"error": "Плейлист не найден"}, status=404)
        return _copy_playlist(pl, me)


def _copy_playlist(pl, me):
    """Сохранить чужой плейлист себе копией: треки те же (файлы не копируем),
    плейлист свой — владелец оригинала дальше меняет только свой. «Моя музыка»
    чужого человека приходит под его ником: иначе у меня их стало бы две, а
    ник читается одинаково на любом языке приложения."""
    if pl.owner_id == me.id:
        return Response({"error": "Это ваш плейлист"}, status=400)
    _default_playlist(me)
    if Playlist.objects.filter(owner=me).count() >= 50:
        return Response({"error": "Слишком много плейлистов"}, status=409)
    name = pl.owner.username if pl.is_default else pl.name
    copy = Playlist.objects.create(owner=me, name=name[:60])
    rows = [
        PlaylistTrack(playlist=copy, source=t.source, file_url=t.file_url,
                      title=t.title, artist=t.artist, duration=t.duration, position=t.position)
        for t in pl.tracks.all()
    ]
    PlaylistTrack.objects.bulk_create(rows)
    return Response({"playlist": PlaylistSerializer(copy).data}, status=201)


def _music_contacts(me):
    """Чьи открытые плейлисты мне видны: собеседники по личке (обычной и
    секретной), если переписка принята и нет блокировки ни в одну сторону.
    Группы и каналы не в счёт: там «собеседники» — сотни незнакомых людей.
    Ботам — ничего: иначе бот собирал бы плейлисты всех, кто ему написал."""
    from .moderation import blocked_ids
    if me.is_bot:
        return set()
    chats = Chat.objects.filter(participants=me, kind__in=("direct", "secret"), pending_for__isnull=True)
    ids = set(
        ChatParticipant.objects.filter(chat__in=chats, user__is_bot=False)
        .exclude(user=me).values_list("user_id", flat=True)
    )
    if ids:
        ids -= blocked_ids(me)
        ids -= set(Block.objects.filter(blocked=me, blocker_id__in=ids).values_list("blocker_id", flat=True))
    return ids


def _public_playlist(me, pk):
    """Открытый плейлист собеседника — или None, если он мне не виден."""
    pl = Playlist.objects.filter(id=pk, is_public=True).select_related("owner").first()
    if not pl or pl.owner_id == me.id or pl.owner_id not in _music_contacts(me):
        return None
    return pl


def _owner_brief(p):
    return {"id": str(p.id), "username": p.username, "avatar_url": p.avatar_url}


class PublicPlaylistsView(APIView):
    """GET — открытые плейлисты моих собеседников, сначала те, куда недавно
    добавляли музыку. Пустые не показываем: слушать там нечего."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        from django.db.models import Count, Max
        me = _prof(request)
        if not me:
            return Response({"error": "Нет профиля"}, status=403)
        owners = _music_contacts(me)
        if not owners:
            return Response({"playlists": []})
        rows = (
            Playlist.objects.filter(is_public=True, owner_id__in=owners)
            .select_related("owner")
            .annotate(n=Count("tracks"), last=Max("tracks__added_at"))
            .filter(n__gt=0)
            .order_by("-last")[:200]
        )
        return Response({"playlists": [
            {"id": str(pl.id), "name": pl.name, "is_default": pl.is_default,
             "tracks_count": pl.n, "updated_at": pl.last, "owner": _owner_brief(pl.owner)}
            for pl in rows
        ]})


class PublicPlaylistView(APIView):
    """Открытый плейлист собеседника: GET — послушать, POST — сохранить себе."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk):
        me = _prof(request)
        pl = _public_playlist(me, pk) if me else None
        if not pl:
            return Response({"error": "Плейлист не найден или закрыт"}, status=404)
        return Response({
            "playlist": PlaylistSerializer(pl).data,
            "owner": pl.owner.username,
            "owner_info": _owner_brief(pl.owner),
            "tracks": PlaylistTrackSerializer(pl.tracks.all(), many=True).data,
        })

    def post(self, request, pk):
        me = _prof(request)
        pl = _public_playlist(me, pk) if me else None
        if not pl:
            return Response({"error": "Плейлист не найден или закрыт"}, status=404)
        return _copy_playlist(pl, me)


class PlaylistTracksView(APIView):
    """POST {message_id} — добавить музыку из сообщения, {track_id} — из
    открытого плейлиста собеседника, эфира или плейлиста по ссылке ({token}).
    Без <pk> — в «Мою музыку».
    DELETE /playlists/<pk>/tracks/<track>/ — убрать трек."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk=None):
        me = _prof(request)
        if not me:
            return Response({"error": "Нет профиля"}, status=403)
        pl = (Playlist.objects.filter(id=pk, owner=me).first() if pk else _default_playlist(me))
        if not pl:
            return Response({"error": "Плейлист не найден"}, status=404)
        # Плейлист может быть в эфире: играющий трек закрепляем до правки,
        # чтобы у слушателей ничего не перескочило (chat/radio.py).
        from .radio import before_playlist_change, fill_track_duration, track_on_air_for, next_position
        before_playlist_change(pl.id)
        on_air = pl.stations.exists()
        # {next: true} — поставить сразу за тем, что сейчас в эфире (диджей).
        play_next = request.data.get("next") in (True, "true", "1", 1)
        # {track_id} — трек из открытого плейлиста собеседника или из эфира,
        # который мне виден: берём его файл и подписи, как при копировании.
        if request.data.get("track_id"):
            src = PlaylistTrack.objects.filter(id=request.data.get("track_id")).select_related("playlist").first()
            token = (request.data.get("token") or "").strip()
            if not src or not (
                (src.playlist.is_public and _public_playlist(me, src.playlist_id))
                or track_on_air_for(me, track_id=src.id)
                # Плейлист по ссылке (карточка в сообщении): ключ ссылки — и есть доступ.
                or (token and src.playlist.share_token and src.playlist.share_token == token)
            ):
                return Response({"error": "Трек не найден"}, status=404)
            exists = pl.tracks.filter(file_url=src.file_url).exists()
            pos = next_position(pl) if play_next and not exists else (
                (pl.tracks.order_by("-position").values_list("position", flat=True).first() or 0) + 1)
            track, created = PlaylistTrack.objects.get_or_create(
                playlist=pl, file_url=src.file_url,
                defaults={"source": src.source, "title": src.title, "artist": src.artist,
                          "duration": src.duration, "position": pos},
            )
            if created and on_air and not track.duration:
                fill_track_duration(track)
            return Response(
                {"track": PlaylistTrackSerializer(track).data, "playlist": PlaylistSerializer(pl).data,
                 "already": not created},
                status=201 if created else 200,
            )
        msg = Message.objects.filter(id=request.data.get("message_id")).select_related("chat").first()
        if not msg or not msg.file_url:
            return Response({"error": "Сообщение с музыкой не найдено"}, status=404)
        if not _can_see_chat(msg.chat, me):
            return Response({"error": "Нет доступа к сообщению"}, status=403)
        name = (msg.file_name or "").strip()
        if not AUDIO_RE.search((name or msg.file_url).lower().split("?")[0]):
            return Response({"error": "Это не музыка"}, status=400)
        title = re.sub(r"\.[^.]+$", "", name) or "Без названия"
        exists = pl.tracks.filter(file_url=msg.file_url).exists()
        pos = next_position(pl) if play_next and not exists else (
            (pl.tracks.order_by("-position").values_list("position", flat=True).first() or 0) + 1)
        track, created = PlaylistTrack.objects.get_or_create(
            playlist=pl, file_url=msg.file_url,
            defaults={"source": msg, "title": title[:200], "position": pos},
        )
        if created and on_air and not track.duration:
            fill_track_duration(track)
        return Response(
            {"track": PlaylistTrackSerializer(track).data, "playlist": PlaylistSerializer(pl).data,
             "already": not created},
            status=201 if created else 200,
        )

    def delete(self, request, pk=None, track=None):
        me = _prof(request)
        row = PlaylistTrack.objects.filter(id=track, playlist_id=pk, playlist__owner=me).first()
        if not row:
            return Response({"error": "Трек не найден"}, status=404)
        from .radio import before_track_removed
        before_track_removed(row)
        row.delete()
        return Response(status=204)


def _probe_audio(path):
    """Длительность и теги (название, исполнитель) загруженного файла."""
    import subprocess, json
    try:
        out = subprocess.run(
            ['ffprobe', '-v', 'quiet', '-print_format', 'json', '-show_entries',
             'format=duration:format_tags=title,artist', path],
            capture_output=True, text=True, timeout=30).stdout
        fmt = (json.loads(out or '{}').get('format') or {})
        tags = {k.lower(): v for k, v in (fmt.get('tags') or {}).items()}
        return float(fmt.get('duration') or 0) or None, (tags.get('title') or '').strip(), (tags.get('artist') or '').strip()
    except Exception:
        logger.exception('ffprobe audio failed')
        return None, '', ''


class PlaylistTrackUploadView(APIView):
    """POST multipart {file, title?, artist?, next?} — загрузить свой трек
    прямо в плейлист (без <pk> — в «Мою музыку»). Так свою музыку добавляют
    люди, и так боты-диджеи наполняют эфир: сообщение в чат для этого не нужно.

    Название и исполнитель — из формы, иначе из тегов файла, иначе из имени."""
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request, pk=None):
        from .radio import before_playlist_change, next_position
        me = _prof(request)
        if not me:
            return Response({"error": "Нет профиля"}, status=403)
        pl = (Playlist.objects.filter(id=pk, owner=me).first() if pk else _default_playlist(me))
        if not pl:
            return Response({"error": "Плейлист не найден"}, status=404)
        f = request.FILES.get("file")
        if not f:
            return Response({"error": "Нет файла"}, status=400)
        ext = os.path.splitext(f.name or "")[1].lower()
        if not AUDIO_RE.search(ext):
            return Response({"error": "Это не музыка"}, status=400)
        rel = os.path.join("music", f"{uuid.uuid4()}{ext}")
        full = os.path.join(settings.MEDIA_ROOT, rel)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "wb+") as dst:
            for chunk in f.chunks():
                dst.write(chunk)
        duration, tag_title, tag_artist = _probe_audio(full)
        if not duration:
            os.remove(full)
            return Response({"error": "Не удалось прочитать файл — это точно аудио?"}, status=400)
        url = f"/media/{rel}"
        if s3_enabled():
            try:
                url = s3_upload(full, rel)
                os.remove(full)
            except Exception:
                logger.exception("music upload: S3 не принял файл — оставляю локально")
        title = ((request.data.get("title") or "").strip() or tag_title
                 or re.sub(r"\.[^.]+$", "", f.name or "") or "Без названия")[:200]
        artist = ((request.data.get("artist") or "").strip() or tag_artist)[:200]
        before_playlist_change(pl.id)
        play_next = request.data.get("next") in (True, "true", "1", 1)
        pos = next_position(pl) if play_next else (
            (pl.tracks.order_by("-position").values_list("position", flat=True).first() or 0) + 1)
        track = PlaylistTrack.objects.create(playlist=pl, file_url=url, title=title, artist=artist,
                                             duration=round(duration, 2), position=pos)
        return Response({"track": PlaylistTrackSerializer(track).data, "playlist": PlaylistSerializer(pl).data}, status=201)


class SavedViewersView(APIView):
    """Кому открыты мои сохранёнки при настройке «избранные люди».
    GET — список, POST {profile_id} — добавить, DELETE {profile_id} — убрать."""
    permission_classes = [permissions.IsAuthenticated]

    def _me(self, request):
        return getattr(request.user, "profile", None)

    def get(self, request):
        me = self._me(request)
        if not me:
            return Response({"error": "Нет профиля"}, status=403)
        rows = SavedViewer.objects.filter(owner=me).select_related("viewer")
        return Response({"viewers": [
            {"id": str(r.viewer.id), "username": r.viewer.username, "avatar_url": r.viewer.avatar_url}
            for r in rows
        ]})

    def post(self, request):
        me = self._me(request)
        if not me:
            return Response({"error": "Нет профиля"}, status=403)
        other = Profile.objects.filter(id=str(request.data.get("profile_id") or "")).first()
        if not other:
            return Response({"error": "Пользователь не найден"}, status=404)
        if other.id == me.id:
            return Response({"error": "Свои сохранёнки и так видны"}, status=400)
        SavedViewer.objects.get_or_create(owner=me, viewer=other)
        return Response({"ok": True})

    def delete(self, request):
        me = self._me(request)
        if not me:
            return Response({"error": "Нет профиля"}, status=403)
        SavedViewer.objects.filter(owner=me, viewer_id=str(request.data.get("profile_id") or "")).delete()
        return Response({"ok": True})


class BlockView(APIView):
    """GET — кого я заблокировал. POST — заблокировать. DELETE — снять."""
    permission_classes = [permissions.IsAuthenticated]

    def _me(self, request):
        return getattr(request.user, "profile", None)

    def get(self, request):
        me = self._me(request)
        if not me:
            return Response({"error": "Нет профиля"}, status=403)
        rows = Block.objects.filter(blocker=me).select_related("blocked")
        return Response({"blocked": [
            {"id": str(b.blocked.id), "username": b.blocked.username, "avatar_url": b.blocked.avatar_url}
            for b in rows
        ]})

    def post(self, request):
        me = self._me(request)
        if not me:
            return Response({"error": "Нет профиля"}, status=403)
        other = Profile.objects.filter(id=str(request.data.get("profile_id") or "")).first()
        if not other:
            return Response({"error": "Пользователь не найден"}, status=404)
        if other.id == me.id:
            return Response({"error": "Нельзя заблокировать себя"}, status=400)
        Block.objects.get_or_create(blocker=me, blocked=other)
        return Response({"ok": True})

    def delete(self, request):
        me = self._me(request)
        if not me:
            return Response({"error": "Нет профиля"}, status=403)
        Block.objects.filter(blocker=me, blocked_id=str(request.data.get("profile_id") or "")).delete()
        return Response({"ok": True})



class BugReportView(APIView):
    """POST multipart — сообщение о проблеме: описание, скриншот, лог, meta.

    Файлы кладём в MEDIA_ROOT/bugreports/<id>/ — своей папкой на репорт, чтобы
    скриншот и лог лежали рядом и удалялись вместе. Лог принимаем текстом
    (поле log) и сами пишем в файл: клиенту незачем собирать Blob.
    """
    parser_classes = [MultiPartParser, FormParser]
    permission_classes = [permissions.IsAuthenticated]

    MAX_LOG = 2 * 1024 * 1024
    MAX_SHOT = 10 * 1024 * 1024

    def post(self, request):
        import json
        from .moderation import deliver_bug

        me = getattr(request.user, "profile", None)
        if not me:
            return Response({"error": "Нет профиля"}, status=403)

        description = (request.data.get("description") or "").strip()[:4000]
        log_text = request.data.get("log") or ""
        shot = request.FILES.get("screenshot")
        try:
            meta = json.loads(request.data.get("meta") or "{}")
            if not isinstance(meta, dict):
                meta = {}
        except ValueError:
            meta = {}

        if not description and not shot and not log_text:
            return Response({"error": "Пустой репорт: добавьте описание или скриншот"}, status=400)
        if shot and shot.size > self.MAX_SHOT:
            return Response({"error": "Скриншот больше 10 МБ"}, status=400)
        if shot and os.path.splitext(shot.name)[1].lower() not in ('.png', '.jpg', '.jpeg', '.webp', '.gif'):
            return Response({"error": "Скриншот должен быть картинкой"}, status=400)

        bug = BugReport(reporter=me, description=description, meta=meta)
        folder = os.path.join('bugreports', str(bug.id))
        os.makedirs(os.path.join(settings.MEDIA_ROOT, folder), exist_ok=True)

        if shot:
            name = f"screenshot{os.path.splitext(shot.name)[1].lower()}"
            with open(os.path.join(settings.MEDIA_ROOT, folder, name), 'wb+') as dst:
                for chunk in shot.chunks():
                    dst.write(chunk)
            bug.screenshot_url = f"/media/{folder}/{name}"

        if log_text:
            data = log_text.encode('utf-8', 'replace')[: self.MAX_LOG]
            with open(os.path.join(settings.MEDIA_ROOT, folder, 'app.log'), 'wb') as dst:
                dst.write(data)
            bug.log_url = f"/media/{folder}/app.log"

        bug.save()
        deliver_bug(bug, request.build_absolute_uri('/').rstrip('/'))
        return Response({"ok": True, "id": str(bug.id)}, status=201)



class SoundPackCoverView(APIView):
    """POST — обложка пака (multipart, поле file), DELETE — убрать.
    Только владелец пака; без обложки клиент рисует свою по теме."""
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def _owned(self, request, pk):
        me = _studio_profile(request)
        pack = SoundPack.objects.filter(pk=pk).first()
        if not pack:
            return None, Response({"error": "Пак не найден"}, status=404)
        if not me or pack.creator_id != me.id:
            return None, Response({"error": "Это не ваш пак"}, status=403)
        return pack, None

    def _drop_old(self, pack):
        if not pack.cover_url or not pack.cover_url.startswith('/media/'):
            return
        old = os.path.join(settings.MEDIA_ROOT, pack.cover_url[len('/media/'):])
        try:
            if os.path.isfile(old):
                os.remove(old)
        except OSError:
            logger.warning("Обложка пака: не удалился файл %s", old)

    def post(self, request, pk):
        pack, err = self._owned(request, pk)
        if err:
            return err
        f = request.FILES.get('file')
        if not f:
            return Response({"error": "Файл не передан"}, status=400)
        if f.size > 5 * 1024 * 1024:
            return Response({"error": "Файл больше 5 МБ"}, status=400)
        ext = os.path.splitext(f.name)[1].lower()
        if ext not in ('.png', '.jpg', '.jpeg', '.webp', '.gif'):
            return Response({"error": "Только картинки"}, status=400)
        target_dir = os.path.join(settings.MEDIA_ROOT, 'packs')
        os.makedirs(target_dir, exist_ok=True)
        self._drop_old(pack)
        # Случайный суффикс: обложка меняется целиком, при постоянном имени
        # клиенты продолжали бы показывать прежнюю из кеша.
        rel = os.path.join('packs', f"pack_{pack.id}_{uuid.uuid4().hex[:8]}{ext}")
        with open(os.path.join(settings.MEDIA_ROOT, rel), 'wb+') as dst:
            for chunk in f.chunks():
                dst.write(chunk)
        pack.cover_url = f'/media/{rel}'
        pack.save(update_fields=['cover_url'])
        return Response(_pack_payload(pack, _studio_profile(request)))

    def delete(self, request, pk):
        pack, err = self._owned(request, pk)
        if err:
            return err
        self._drop_old(pack)
        pack.cover_url = ""
        pack.save(update_fields=['cover_url'])
        return Response(_pack_payload(pack, _studio_profile(request)))


class SoundPackSubscribeView(APIView):
    """POST — добавить пак себе, DELETE — убрать. Свои и базовые добавлять незачем."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        me = _studio_profile(request)
        pack = SoundPack.objects.filter(pk=pk).first()
        if not me or not pack:
            return Response({"error": "Пак не найден"}, status=404)
        if not pack.is_public and pack.creator_id != me.id:
            return Response({"error": "Пак не найден"}, status=404)
        if pack.is_default or pack.creator_id == me.id:
            return Response({"ok": True, "already": True})
        if _adult_hidden(pack, me):
            return Response({"error": ADULT_LOCKED_ERROR, "adult_locked": True}, status=403)
        UserSoundPack.objects.get_or_create(user=me, pack=pack)
        return Response({"ok": True})

    def delete(self, request, pk):
        me = _studio_profile(request)
        if not me:
            return Response({"error": "Нет профиля"}, status=403)
        UserSoundPack.objects.filter(user=me, pack_id=pk).delete()
        return Response({"ok": True})


class AddedSoundPacksView(APIView):
    """GET — паки, которые я добавил по ссылке (без своих и базовых)."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        me = _studio_profile(request)
        if not me:
            return Response({"error": "Нет профиля"}, status=403)
        rows = UserSoundPack.objects.filter(user=me).select_related("pack__creator").prefetch_related("pack__sounds")
        if not me.allow_adult:
            rows = rows.exclude(pack__is_adult=True)
        return Response({"packs": [_pack_payload(r.pack, me) for r in rows]})



class AdminMetricsView(APIView):
    """GET /api/admin/metrics/?range=24h|7d|30d&tz=<минуты к UTC> — панель
    мониторинга. Только админам (роль «Администратор» или суперпользователь)."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from .serializers import is_admin_profile
        from .metrics import summary
        if not is_admin_profile(getattr(request.user, 'profile', None)):
            return Response({"error": "Только для администраторов"}, status=403)
        try:
            tz = max(-840, min(840, int(request.query_params.get('tz') or 0)))
        except ValueError:
            tz = 0
        return Response(summary(request.query_params.get('range') or '24h', tz))



class AdminRegistrationsView(APIView):
    """GET /api/admin/registrations/?from=YYYY-MM-DD&to=YYYY-MM-DD&tz=<минуты> —
    регистрации за период для мониторинга. Только админам."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from datetime import date, timedelta as td
        from .serializers import is_admin_profile
        from .metrics import registrations
        if not is_admin_profile(getattr(request.user, 'profile', None)):
            return Response({"error": "Только для администраторов"}, status=403)
        try:
            to = date.fromisoformat(request.query_params.get('to') or date.today().isoformat())
            frm = date.fromisoformat(request.query_params.get('from') or (to - td(days=6)).isoformat())
            tz = max(-840, min(840, int(request.query_params.get('tz') or 0)))
        except ValueError:
            return Response({"error": "Даты — в виде ГГГГ-ММ-ДД"}, status=400)
        if frm > to:
            frm, to = to, frm
        return Response(registrations(frm, to, tz))
