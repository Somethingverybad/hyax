from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from .models import *

class ProfileSerializer(serializers.ModelSerializer):
    # Свой звук уведомлений: читаем вложенным объектом (url для прослушивания),
    # пишем по id (notify_sound_id: null — сбросить).
    notify_sound = serializers.SerializerMethodField()
    notify_sound_id = serializers.PrimaryKeyRelatedField(
        source='notify_sound', queryset=NotificationSound.objects.filter(is_active=True),
        allow_null=True, required=False, write_only=True)

    # «В сети» — живой статус из presence; у «Скрыт» всегда False.
    is_online = serializers.SerializerMethodField()
    # Видны ли смотрящему сохранёнки этого человека (см. can_see_saved).
    saved_visible = serializers.SerializerMethodField()

    def get_saved_visible(self, obj):
        from .moderation import can_see_saved
        me = getattr(self.context.get('request'), 'user', None)
        me_profile = getattr(me, 'profile', None) if me else None
        return bool(me_profile) and can_see_saved(obj.id, me_profile.id)

    def get_notify_sound(self, obj):
        return NotificationSoundSerializer(obj.notify_sound).data if obj.notify_sound_id else None

    def get_is_online(self, obj):
        from .presence import shown_online
        return shown_online(obj)

    class Meta:
        model = Profile
        fields = ['id', 'username', 'avatar_url', 'cover_url', 'status', 'call_status', 'bio', 'created_at', 'is_bot', 'push_preview', 'rov_enabled', 'notify_sound', 'notify_sound_id', 'is_online', 'saved_visible']
        # username редактируем: это отображаемое имя (никнейм), логин остаётся
        # в User.username и не меняется. Уникальность проверяет DRF по unique
        # на поле модели.
        read_only_fields = ['id', 'created_at', 'is_bot']

    def validate_username(self, value):
        value = (value or "").strip()
        if len(value) < 2:
            raise serializers.ValidationError("Никнейм короче 2 символов")
        if len(value) > 50:
            raise serializers.ValidationError("Никнейм длиннее 50 символов")
        # Занят ли ник с точностью до регистра: иначе появлялись пары вроде
        # EvilTree и eviltree, и ссылки на профиль вели не туда.
        taken = Profile.objects.filter(username__iexact=value)
        if self.instance is not None:
            taken = taken.exclude(pk=self.instance.pk)
        if taken.exists():
            raise serializers.ValidationError("Этот никнейм уже занят")
        return value

class OwnProfileSerializer(ProfileSerializer):
    """Свой профиль: то же плюс личные настройки, которые собеседникам знать
    незачем. Базовый сериализатор уходит в участников чата и отправителей
    сообщений, поэтому 18+ и отметка о принятии правил живут только здесь."""
    class Meta(ProfileSerializer.Meta):
        fields = ProfileSerializer.Meta.fields + ['allow_adult', 'terms_accepted_at', 'active_theme', 'hide_online', 'saved_visibility']
        # terms_accepted_at ставит только сервер (регистрация, AcceptTermsView).
        read_only_fields = ProfileSerializer.Meta.read_only_fields + ['terms_accepted_at']

    def update(self, instance, validated_data):
        was_hidden = instance.hide_online
        instance = super().update(instance, validated_data)
        if instance.hide_online != was_hidden:
            # Включил «Скрыт» — собеседники сразу видят «не в сети», и наоборот.
            from .presence import broadcast_presence_sync
            try:
                broadcast_presence_sync(instance)
            except Exception:
                pass
        return instance

    def validate_active_theme(self, value):
        from .themes import BUILTIN_IDS
        value = (value or "").strip()
        if value in BUILTIN_IDS or value == "":
            return value
        import uuid as _uuid
        try:
            _uuid.UUID(value)
        except ValueError:
            raise serializers.ValidationError("Неизвестная тема")
        return value


class PublicProfileSerializer(serializers.ModelSerializer):
    """Карточка по ссылке /u/<ник>: только то, что и так видно в чате.
    Без call_status, push_preview и прочих приватных настроек."""
    # Видны ли смотрящему сохранёнки владельца: клиент по этому флагу прячет
    # раздел целиком, не делая лишнего запроса.
    saved_visible = serializers.SerializerMethodField()

    def get_saved_visible(self, obj):
        from .moderation import can_see_saved
        me = getattr(self.context.get('request'), 'user', None)
        me_profile = getattr(me, 'profile', None) if me else None
        return bool(me_profile) and can_see_saved(obj.id, me_profile.id)

    class Meta:
        model = Profile
        fields = ['id', 'username', 'avatar_url', 'cover_url', 'bio', 'is_bot', 'created_at', 'saved_visible']
        read_only_fields = fields


class FriendshipSerializer(serializers.ModelSerializer):
    class Meta:
        model = Friendship
        fields = ['id', 'user', 'friend', 'status', 'created_at']

class ChatSerializer(serializers.ModelSerializer):
    # Участники отдаются вместе со списком чатов. Раньше клиент запрашивал их
    # отдельно на каждый чат: на экран из десяти чатов уходило одиннадцать
    # запросов, и до их ответа вместо имени показывался идентификатор.
    participants = ProfileSerializer(many=True, read_only=True)
    # Последнее сообщение для превью в списке. Данные приходят аннотациями из
    # get_queryset (Subquery) — метод ничего не дёргает из базы, N+1 нет.
    last_message = serializers.SerializerMethodField()

    creator = serializers.SerializerMethodField()
    pinned_message = serializers.SerializerMethodField()
    # Когда я закрепил этот чат (аннотация my_pinned_at из get_queryset).
    # null — не закреплён. Закрепление личное, у собеседника своё.
    pinned_at = serializers.SerializerMethodField()
    # Время последнего сообщения — по нему клиент сортирует список. updated_at
    # у чата меняется и от переименования, и от смены аватара.
    last_message_at = serializers.SerializerMethodField()

    class Meta:
        model = Chat
        fields = ['id', 'name', 'is_group', 'kind', 'username', 'subscribers_count', 'avatar_url', 'creator', 'created_at', 'updated_at', 'pinned_at', 'last_message_at', 'participants', 'last_message', 'pinned_message']

    def get_pinned_at(self, obj):
        v = getattr(obj, 'my_pinned_at', None)
        return v.isoformat() if v else None

    def get_last_message_at(self, obj):
        v = getattr(obj, 'last_at_a', None)
        return v.isoformat() if v else None

    def get_creator(self, obj):
        return str(obj.creator_id) if obj.creator_id else None

    def get_pinned_message(self, obj):
        return pinned_payload(obj.pinned_message)

    def get_last_message(self, obj):
        sender_id = getattr(obj, 'last_sender_id_a', None)
        if sender_id is None:
            return None
        text = (getattr(obj, 'last_text_a', '') or '').strip()
        if not text:
            if getattr(obj, 'last_sticker_a', None):
                text = 'Стикер'
            elif getattr(obj, 'last_video_a', None):
                text = 'Видео-сообщение'
            elif getattr(obj, 'last_voice_a', None):
                text = 'Голосовое сообщение'
            elif getattr(obj, 'last_file_a', None):
                text = 'Файл'
            else:
                text = 'Сообщение'
        return {'text': text[:120], 'sender_id': str(sender_id)}

def message_preview(m):
    """Короткое описание сообщения для цитат, закрепа и списка чатов."""
    text = (m.content or "").strip()
    if text:
        return text
    if m.sticker_id:
        return "Стикер"
    if m.video_url:
        return "Видео-сообщение"
    if m.voice_url:
        return "Голосовое сообщение"
    if m.file_url:
        return m.file_name or "Файл"
    return "Сообщение"


def pinned_payload(m):
    """Компактный закреп: id, автор и превью — лента подгружает полный текст сама."""
    if not m or m.deleted_for_all:
        return None
    return {
        "id": str(m.id),
        "sender_username": m.sender.username if m.sender else "",
        "preview": message_preview(m)[:120],
    }


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
    # Пак 18+ открыт без настройки «Показывать 18+»: карточку отдаём, стикеры — нет
    # (их режет StickerViewSet.get_queryset).
    adult_locked = serializers.SerializerMethodField()
    
    class Meta:
        model = StickerPack
        fields = ['id', 'name', 'description', 'author', 'is_public', 'is_adult', 'adult_locked', 'created_at', 'updated_at', 'stickers_count', 'is_saved']
        read_only_fields = ['author', 'created_at', 'updated_at']

    def get_adult_locked(self, obj):
        if not obj.is_adult:
            return False
        request = self.context.get('request')
        me = getattr(getattr(request, 'user', None), 'profile', None) if request else None
        if me is None:
            return True
        return not me.allow_adult and obj.author_id != me.id
    
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


class NotificationSoundSerializer(serializers.ModelSerializer):
    """Каталог звуков уведомлений: url — исходник для проигрывания в
    приложении, caf_url — файл для докачки в Library/Sounds на iOS."""
    url = serializers.SerializerMethodField()
    pack = serializers.SerializerMethodField()
    pack_name = serializers.SerializerMethodField()

    class Meta:
        model = NotificationSound
        fields = ['id', 'slug', 'name', 'url', 'caf_url', 'pack', 'pack_name', 'updated_at']

    def get_url(self, obj):
        return obj.file.url if obj.file else ""

    def get_pack(self, obj):
        return str(obj.pack_id) if obj.pack_id else None

    def get_pack_name(self, obj):
        return obj.pack.name if obj.pack_id else "Разное"


class PlaylistTrackSerializer(serializers.ModelSerializer):
    class Meta:
        model = PlaylistTrack
        fields = ["id", "file_url", "title", "artist", "duration", "position", "added_at", "source"]
        read_only_fields = fields


class PlaylistSerializer(serializers.ModelSerializer):
    tracks_count = serializers.SerializerMethodField()

    def get_tracks_count(self, obj):
        return obj.tracks.count()

    class Meta:
        model = Playlist
        fields = ["id", "name", "is_default", "created_at", "tracks_count"]
        read_only_fields = ["id", "is_default", "created_at", "tracks_count"]


class MessageSenderSerializer(serializers.ModelSerializer):
    """Автор сообщения: только то, что рисует лента. Полный профиль на каждое
    сообщение раздувал ответ (60 сообщений — 139 КБ) и тянул звук уведомлений
    отдельным запросом на каждого автора."""
    notify_sound = serializers.SerializerMethodField()

    class Meta:
        model = Profile
        fields = ['id', 'username', 'avatar_url', 'status', 'is_bot', 'notify_sound']

    def get_notify_sound(self, obj):
        # Нужен только url: по нему проигрывается «мой звук» у собеседника.
        s = obj.notify_sound
        return {"id": str(s.id), "url": s.file.url if s.file else ""} if s else None


def reactions_payload(message, me_id=None):
    """Сводка реакций сообщения: [{emoji, count, mine}] в порядке тайллиста.

    Клиенту не нужен поимённый список — он рисует таблетку «эмодзи + число» и
    подсвечивает свои. Поимённо это была бы лишняя выдача на каждое сообщение.
    """
    from .reactions import ALL
    order = {emoji: i for i, (emoji, _) in enumerate(ALL)}
    counts, mine = {}, set()
    for r in message.reactions.all():
        counts[r.value] = counts.get(r.value, 0) + 1
        if me_id and str(r.user_id) == str(me_id):
            mine.add(r.value)
    return [
        {"emoji": e, "count": c, "mine": e in mine}
        for e, c in sorted(counts.items(), key=lambda kv: (order.get(kv[0], 99), kv[0]))
    ]


class MessageSerializer(serializers.ModelSerializer):
    sender = MessageSenderSerializer(read_only=True)
    reactions = serializers.SerializerMethodField()

    def validate_buttons(self, value):
        """Кнопки ставит только бот и только в допустимом виде.

        Иначе любой мог бы прислать сообщение, неотличимое от бота, и увести
        человека по чужому действию. Форма: строки рядов, в ряду — кнопки
        {text, data}; data уходит обратно боту при нажатии.
        """
        me = getattr(getattr(self.context.get("request"), "user", None), "profile", None)
        if not value:
            return []
        if not me or not me.is_bot:
            raise serializers.ValidationError("Кнопки может ставить только бот")
        if not isinstance(value, list) or len(value) > 8:
            raise serializers.ValidationError("Не больше восьми рядов кнопок")
        rows = []
        for row in value:
            if not isinstance(row, list) or len(row) > 4:
                raise serializers.ValidationError("В ряду не больше четырёх кнопок")
            out = []
            for btn in row:
                if not isinstance(btn, dict):
                    raise serializers.ValidationError("Кнопка — это объект")
                text = str(btn.get("text") or "").strip()[:64]
                data = str(btn.get("data") or "").strip()[:128]
                if not text or not data:
                    raise serializers.ValidationError("У кнопки нужны text и data")
                out.append({"text": text, "data": data})
            if out:
                rows.append(out)
        return rows

    def get_reactions(self, obj):
        me = getattr(getattr(self.context.get("request"), "user", None), "profile", None)
        return reactions_payload(obj, me.id if me else None)
    is_read = serializers.SerializerMethodField()
    read_by = serializers.SerializerMethodField()
    sticker = StickerSerializer(read_only=True)
    sound = NotificationSoundSerializer(read_only=True)
    reply_to = serializers.SerializerMethodField()
    forwarded_from = serializers.SerializerMethodField()

    class Meta:
        model = Message
        fields = ['id', 'chat', 'sender', 'content', 'file_url', 'file_name', 'file_width', 'file_height', 'album_id', 'created_at', 'is_read', 'read_by', 'sticker', 'voice_url', 'voice_duration', 'voice_transcript', 'transcript_status', 'video_url', 'video_duration', 'sound', 'reply_to', 'download_only', 'video_mirror', 'is_edited', 'forwarded_from', 'forwarded_title', 'reactions', 'buttons']
        read_only_fields = ['sender', 'created_at', 'file_size', 'forwarded_from', 'forwarded_title']

    def get_forwarded_from(self, obj):
        """От кого переслано: профиль, если он есть, — клиент может открыть его."""
        f = obj.forwarded_from
        if not f:
            return None
        return {"id": str(f.id), "username": f.username, "avatar_url": f.avatar_url}

    def get_reply_to(self, obj):
        """Компактная цитата: id, автор и короткое превью — без рекурсии по
        всей цепочке ответов."""
        r = obj.reply_to
        if not r:
            return None
        preview = (r.content or "").strip()
        if not preview:
            if r.sticker_id:
                preview = "Стикер"
            elif r.video_url:
                preview = "Видео-сообщение"
            elif r.voice_url:
                preview = "Голосовое сообщение"
            elif r.file_url:
                preview = "Файл"
            else:
                preview = "Сообщение"
        return {
            "id": str(r.id),
            "sender_username": r.sender.username if r.sender else "",
            "preview": preview[:120],
        }
    
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
        """Прочитано ли сообщение мной. Считаем по уже загруженным отметкам:
        запрос .filter(...).exists() выполнялся на каждое сообщение, и окно из
        шестидесяти сообщений собиралось полсекунды."""
        request = self.context.get('request')
        me = getattr(getattr(request, 'user', None), 'profile', None)
        if me is None:
            return False
        return any(rs.user_id == me.id for rs in obj.read_statuses.all())

    def get_read_by(self, obj):
        """Кто прочитал — коротко: id, ник и время. Полный профиль на каждую
        отметку занимал больше места, чем само сообщение."""
        return [
            {"id": str(rs.user_id), "username": rs.user.username if rs.user_id else "", "read_at": rs.read_at.isoformat()}
            for rs in list(obj.read_statuses.all())[:10]
        ]


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

class ChannelSerializer(serializers.ModelSerializer):
    """Инфо о канале для клиента. my_role — роль текущего пользователя в канале
    (owner/admin/subscriber) или None, если не подписан."""
    my_role = serializers.SerializerMethodField()
    # Звук уведомлений канала: наружу — объектом (есть url для прослушивания),
    # меняется через PATCH channels/<id>/ полем notify_sound_id.
    notify_sound = serializers.SerializerMethodField()

    def get_notify_sound(self, obj):
        return NotificationSoundSerializer(obj.notify_sound).data if obj.notify_sound_id else None

    class Meta:
        model = Chat
        fields = ['id', 'kind', 'name', 'username', 'description', 'avatar_url',
                  'is_public', 'sign_posts', 'subscribers_count', 'creator',
                  'my_role', 'notify_sound', 'created_at']

    def get_my_role(self, obj):
        req = self.context.get('request')
        prof = getattr(getattr(req, 'user', None), 'profile', None) if req else None
        if not prof:
            return None
        cp = ChatParticipant.objects.filter(chat=obj, user=prof).first()
        return cp.role if cp else None


class PostCommentSerializer(serializers.ModelSerializer):
    author = ProfileSerializer(read_only=True)

    class Meta:
        model = PostComment
        fields = ['id', 'post', 'author', 'parent', 'content', 'created_at']
        read_only_fields = ['id', 'author', 'created_at']


class SavedImageSerializer(serializers.ModelSerializer):
    class Meta:
        model = SavedImage
        fields = ['id', 'file_url', 'file_name', 'created_at']
        read_only_fields = fields


class MusicTrackSerializer(serializers.ModelSerializer):
    owner_username = serializers.CharField(source='owner.username', read_only=True)
    owner_id = serializers.UUIDField(source='owner.id', read_only=True)
    url = serializers.SerializerMethodField()

    class Meta:
        model = MusicTrack
        fields = ['id', 'title', 'artist', 'url', 'duration', 'owner_id', 'owner_username', 'created_at']
        read_only_fields = fields

    def get_url(self, obj):
        return obj.file.url if obj.file else ''
