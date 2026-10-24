from rest_framework import serializers, exceptions
from rest_framework.exceptions import ValidationError
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from .models import *


def is_admin_profile(profile):
    """Админ мессенджера: роль «Администратор» или суперпользователь Django."""
    if not profile:
        return False
    return getattr(profile, 'role', '') == 'admin' or bool(getattr(getattr(profile, 'user', None), 'is_superuser', False))

def notify_sound_payload(context, obj):
    """Звук уведомлений объекта (профиля или чата) в виде для клиента — один
    раз на запрос для каждого звука. В списке чатов звук у сотен участников
    повторяется, а сериализатор звука ходит в базу за паком."""
    sid = getattr(obj, 'notify_sound_id', None)
    if not sid:
        return None
    cache = context.setdefault('_sounds', {}) if isinstance(context, dict) else None
    if cache is not None and sid in cache:
        return cache[sid]
    data = NotificationSoundSerializer(obj.notify_sound).data
    if cache is not None:
        cache[sid] = data
    return data


class ProfileSerializer(serializers.ModelSerializer):
    # Владелец бота (id) — только у ботов: бот узнаёт, чьи команды слушать.
    bot_owner = serializers.SerializerMethodField()

    def get_bot_owner(self, obj):
        return str(obj.bot_owner_id) if getattr(obj, "is_bot", False) and obj.bot_owner_id else None

    # Свой звук уведомлений: читаем вложенным объектом (url для прослушивания),
    # пишем по id (notify_sound_id: null — сбросить).
    notify_sound = serializers.SerializerMethodField()
    notify_sound_id = serializers.PrimaryKeyRelatedField(
        source='notify_sound', queryset=NotificationSound.objects.filter(is_active=True),
        allow_null=True, required=False, write_only=True)

    # «В сети» — живой статус из presence; у «Скрыт» всегда False.
    is_online = serializers.SerializerMethodField()
    # Когда был на связи; None — показывать нельзя (скрыт или выключено).
    last_seen = serializers.SerializerMethodField()
    # Видны ли смотрящему сохранёнки этого человека (см. can_see_saved).
    saved_visible = serializers.SerializerMethodField()

    def get_saved_visible(self, obj):
        me = getattr(self.context.get('request'), 'user', None)
        me_profile = getattr(me, 'profile', None) if me else None
        if not me_profile:
            return False
        # Режим уже в объекте (участники приходят prefetch'ем): без этого в
        # списке чатов на каждого участника шёл отдельный запрос за ним.
        # Правило то же, что в moderation.can_see_saved.
        if str(obj.id) == str(me_profile.id):
            return True
        mode = getattr(obj, 'saved_visibility', None)
        if mode is None or mode == 'all':
            return True
        if mode == 'none':
            return False
        from .moderation import can_see_saved
        return can_see_saved(obj.id, me_profile.id)

    def get_notify_sound(self, obj):
        return notify_sound_payload(self.context, obj)

    def get_is_online(self, obj):
        # Список чатов кладёт в контекст заранее собранный набор «на экране»
        # (presence.active_set) — иначе по обращению в Redis на участника.
        active = self.context.get('presence_active')
        if active is not None:
            return not getattr(obj, 'hide_online', False) and str(obj.id) in active
        from .presence import shown_online
        return shown_online(obj)

    def get_last_seen(self, obj):
        from .presence import shown_last_seen
        when = shown_last_seen(obj)
        return when.isoformat() if when else None

    class Meta:
        model = Profile
        fields = ['id', 'username', 'avatar_url', 'cover_url', 'status', 'call_status', 'bio', 'created_at', 'is_bot', 'readonly_bot', 'bot_owner', 'push_preview', 'notify_silent', 'rov_enabled', 'notify_sound', 'notify_sound_id', 'is_online', 'saved_visible', 'last_seen', 'aura_color', 'aura_text', 'vibe', 'language', 'webapp_url', 'webapp_title']
        # username редактируем: это отображаемое имя (никнейм), логин остаётся
        # в User.username и не меняется. Уникальность проверяет DRF по unique
        # на поле модели.
        read_only_fields = ['id', 'created_at', 'is_bot', 'readonly_bot', 'bot_owner', 'vibe', 'webapp_url', 'webapp_title']

    def validate_aura_color(self, value):
        import re
        value = (value or "").strip()
        if value and not re.fullmatch(r"#[0-9a-fA-F]{6}", value):
            raise serializers.ValidationError("Цвет ауры — в виде #rrggbb")
        return value.lower()

    def validate_aura_text(self, value):
        return " ".join((value or "").split())[:60]

    def validate_username(self, value):
        value = (value or "").strip()
        if len(value) < 2:
            raise serializers.ValidationError("Никнейм короче 2 символов")
        if len(value) > 50:
            raise serializers.ValidationError("Никнейм длиннее 50 символов")
        # Свой ник без изменений — не проверяем: у старых аккаунтов остались
        # пары вроде EvilTree/eviltree, и правка «О себе» отбивалась как «занят».
        if self.instance is not None and value == self.instance.username:
            return value
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
    # Видит ли человек админские разделы (мониторинг). Только в своём
    # профиле: собеседникам это знать незачем.
    is_admin = serializers.SerializerMethodField()

    def validate_aura_presets(self, value):
        import re
        out = []
        for p in (value if isinstance(value, list) else [])[:12]:
            if not isinstance(p, dict):
                continue
            color = str(p.get("color") or "").strip().lower()
            if not re.fullmatch(r"#[0-9a-f]{6}", color):
                continue
            out.append({"color": color, "text": " ".join(str(p.get("text") or "").split())[:60]})
        return out

    def validate_quick_reaction(self, value):
        """Быстрая реакция: null — умолчание; иначе ключ реакции и, у своего
        эмодзи, двойник с картинкой — ровно то, что клиент хранит локально."""
        if value in (None, "", {}):
            return None
        if not isinstance(value, dict) or not isinstance(value.get("key"), str) or not value["key"].strip():
            raise serializers.ValidationError("Нужен ключ реакции")
        out = {"key": value["key"].strip()[:80]}
        if isinstance(value.get("emoji"), str) and value["emoji"].strip():
            out["emoji"] = value["emoji"].strip()[:16]
        custom = value.get("custom")
        if isinstance(custom, dict) and isinstance(custom.get("url"), str) and custom["url"].strip():
            out["custom"] = {"url": custom["url"].strip()[:500]}
            if custom.get("repaint"):
                out["custom"]["repaint"] = True
        return out

    def get_is_admin(self, obj):
        return is_admin_profile(obj)

    class Meta(ProfileSerializer.Meta):
        fields = ProfileSerializer.Meta.fields + ['is_admin', 'aura_presets', 'aura_anim', 'quick_reaction', 'identity_updated_at', 'email', 'email_verified', 'translate_in_default', 'translate_out_default', 'allow_adult', 'wall_enabled', 'ringtone', 'terms_accepted_at', 'active_theme', 'hide_online', 'saved_visibility', 'show_last_seen', 'confirm_chats', 'ideabox_enabled', 'hide_from_search', 'notify_wall']
        # terms_accepted_at ставит только сервер (регистрация, AcceptTermsView).
        read_only_fields = ProfileSerializer.Meta.read_only_fields + ['terms_accepted_at', 'identity_updated_at', 'email', 'email_verified']

    def update(self, instance, validated_data):
        was_hidden = instance.hide_online
        # Аура — тоже часть «подписи» у сообщений: сменил на одном устройстве —
        # у собеседников и на других своих устройствах подтянется через authors.
        was_identity = (instance.username, instance.avatar_url, instance.aura_color, instance.aura_text)
        # Звук входящих выключили — вайб в VIBE_SILENT (настоящий — в
        # vibe_saved), включили — возвращаем его вместе с тем, что набежало.
        if 'notify_silent' in validated_data and bool(validated_data['notify_silent']) != bool(instance.notify_silent):
            from .models import VIBE_SILENT
            if validated_data['notify_silent']:
                instance.vibe_saved = instance.vibe
                instance.vibe = VIBE_SILENT
            else:
                base = instance.vibe_saved if instance.vibe_saved is not None else 0
                instance.vibe = base + (instance.vibe - VIBE_SILENT)
                instance.vibe_saved = None
        instance = super().update(instance, validated_data)
        if (instance.username, instance.avatar_url, instance.aura_color, instance.aura_text) != was_identity:
            # Ник или аватар сменились — клиенты обновят подписи у старых сообщений.
            from django.utils import timezone as _tz
            instance.identity_updated_at = _tz.now()
            instance.save(update_fields=["identity_updated_at"])
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
        fields = ['id', 'username', 'avatar_url', 'cover_url', 'bio', 'is_bot', 'created_at', 'saved_visible', 'aura_color', 'aura_text', 'webapp_url', 'webapp_title']
        read_only_fields = fields


class FriendshipSerializer(serializers.ModelSerializer):
    class Meta:
        model = Friendship
        fields = ['id', 'user', 'friend', 'status', 'created_at']

class ChatSerializer(serializers.ModelSerializer):
    # Звук уведомлений чата: у канала — для подписчиков, у группы — для всех
    # участников (задаёт админ), пуш идёт с ним (views._notify_new_message).
    notify_sound = serializers.SerializerMethodField()

    def get_notify_sound(self, obj):
        return notify_sound_payload(self.context, obj)

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
    # Обои: общие у чата и моя личная замена (аннотации my_wp_* из get_queryset,
    # иначе — запрос по участнику).
    wallpaper = serializers.SerializerMethodField()
    my_wallpaper = serializers.SerializerMethodField()

    secret = serializers.SerializerMethodField()
    # Запрос на переписку: id того, кто должен принять (или null).
    pending_for = serializers.PrimaryKeyRelatedField(read_only=True)

    def get_secret(self, obj):
        """Секретный чат: состояние и открытые ключи сторон (chat/secret.py)."""
        if getattr(obj, 'kind', '') != 'secret':
            return None
        from .secret import secret_info
        return secret_info(obj)

    def get_wallpaper(self, obj):
        if not obj.wallpaper_url:
            return None
        return {"url": obj.wallpaper_url, "kind": obj.wallpaper_kind or "image", "poster": obj.wallpaper_poster, "anim": obj.wallpaper_anim}

    def get_my_wallpaper(self, obj):
        if hasattr(obj, 'my_wp_kind'):
            kind, url, poster, anim = obj.my_wp_kind, getattr(obj, 'my_wp_url', None), getattr(obj, 'my_wp_poster', None), getattr(obj, 'my_wp_anim', None)
        else:
            req = self.context.get('request')
            prof = getattr(getattr(req, 'user', None), 'profile', None) if req else None
            cp = ChatParticipant.objects.filter(chat=obj, user=prof).only('wallpaper_kind', 'wallpaper_url', 'wallpaper_poster', 'wallpaper_anim').first() if prof else None
            kind, url, poster, anim = (cp.wallpaper_kind, cp.wallpaper_url, cp.wallpaper_poster, cp.wallpaper_anim) if cp else ("", None, None, None)
        if not kind:
            return None
        return {"url": url, "kind": kind, "poster": poster, "anim": anim}

    class Meta:
        model = Chat
        fields = ['id', 'name', 'is_group', 'kind', 'username', 'subscribers_count', 'avatar_url', 'creator', 'created_at', 'updated_at', 'pinned_at', 'last_message_at', 'participants', 'last_message', 'pinned_message', 'wallpaper', 'my_wallpaper', 'secret', 'notify_sound', 'pending_for']

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
        # У постов зеркал Telegram отправителя нет — ориентируемся на id поста.
        if sender_id is None and getattr(obj, 'last_id_a', None) is None:
            return None
        from .formatting import mask_preview, utf16_len
        ents = getattr(obj, 'last_entities_a', None)
        masked = mask_preview(getattr(obj, 'last_text_a', '') or '', ents)
        text = masked.strip()
        lead = utf16_len(masked[:len(masked) - len(masked.lstrip())])
        if getattr(obj, 'last_geo_a', None) is not None:
            text = GEO_PREVIEW
        if not text:
            if getattr(obj, 'last_sticker_a', None) or getattr(obj, 'last_sticker_file_a', None):
                text = 'Стикер'
            elif getattr(obj, 'last_video_a', None):
                text = 'Видео-сообщение'
            elif getattr(obj, 'last_voice_a', None):
                text = 'Голосовое сообщение'
            elif getattr(obj, 'last_file_a', None):
                text = 'Файл'
            else:
                text = 'Сообщение'
        # read — прочитал ли кто-то кроме автора: вторая галка в списке чатов.
        out = {'text': text[:120], 'sender_id': str(sender_id) if sender_id else None, 'read': bool(getattr(obj, 'last_read_a', False))}
        # Свои эмодзи — и в списке чатов: где стоят в этом превью (UTF-16, как в JS).
        if text and isinstance(ents, list):
            limit = utf16_len(out['text'])
            emoji = []
            for e in ents:
                if not isinstance(e, dict) or e.get('type') != 'custom_emoji' or not e.get('url'):
                    continue
                try:
                    off, ln = int(e['offset']) - lead, int(e['length'])
                except (KeyError, TypeError, ValueError):
                    continue
                if off >= 0 and off + ln <= limit:
                    emoji.append({'offset': off, 'length': ln, 'url': e['url'], **({'repaint': True} if e.get('repaint') else {})})
            if emoji:
                out['emoji'] = emoji
        # Секретный чат: текста у сервера нет — превью расшифрует устройство с ключом.
        cipher = getattr(obj, 'last_cipher_a', None)
        if cipher:
            out['text'] = 'Зашифрованное сообщение'
            out['cipher'] = cipher
        return out

GEO_PREVIEW = "📍 Геопозиция"


def message_preview(m):
    """Короткое описание сообщения для цитат, закрепа и списка чатов."""
    from .formatting import mask_preview
    if getattr(m, "geo_lat", None) is not None:
        return GEO_PREVIEW
    text = mask_preview(m.content or "", getattr(m, "entities", None)).strip()
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
    # Первые стикеры пака — обложка-мозаика папки в студии.
    preview = serializers.SerializerMethodField()
    
    def validate_kind(self, value):
        """sticker | emoji; тип набора задаётся при создании и потом не меняется."""
        if value not in ("sticker", "emoji"):
            raise serializers.ValidationError("Тип набора — sticker или emoji")
        if self.instance is not None and value != self.instance.kind:
            raise serializers.ValidationError("Тип набора не меняется")
        return value

    class Meta:
        model = StickerPack
        fields = ['id', 'name', 'description', 'author', 'is_public', 'is_adult', 'adult_locked', 'open_add', 'kind', 'is_graffiti', 'created_at', 'updated_at', 'stickers_count', 'is_saved', 'preview']
        read_only_fields = ['author', 'created_at', 'updated_at', 'is_graffiti']

    def get_preview(self, obj):
        if self.get_adult_locked(obj):
            return []
        # Из prefetch, если он был (my_packs), иначе — один короткий запрос.
        if 'stickers' in getattr(obj, '_prefetched_objects_cache', {}):
            return [s.file_url for s in list(obj.stickers.all())[:4]]
        return list(obj.stickers.values_list('file_url', flat=True)[:4])

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
        fields = ['id', 'pack', 'pack_name', 'file_url', 'file_name', 'emoji', 'keyword', 'repaint', 'order', 'created_at']
        read_only_fields = ['created_at', 'repaint']


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
    # Можно ли поставить этот звук себе: вне пака, стандартный пак, свой или
    # добавленный. Остальные публичные паки в каталоге — только чтобы сыграть
    # входящее от того, у кого такой звук стоит (NotificationSoundListView).
    pack_mine = serializers.SerializerMethodField()
    pack_adult = serializers.SerializerMethodField()

    class Meta:
        model = NotificationSound
        fields = ['id', 'slug', 'name', 'url', 'caf_url', 'pack', 'pack_name', 'pack_mine', 'pack_adult', 'updated_at']

    def get_pack_mine(self, obj):
        if not obj.pack_id or obj.pack.is_default:
            return True
        mine = self.context.get("my_packs")
        return bool(mine is not None and obj.pack_id in mine)

    def get_pack_adult(self, obj):
        return bool(obj.pack_id and obj.pack.is_adult)

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
    likes = serializers.SerializerMethodField()
    liked = serializers.SerializerMethodField()
    resume = serializers.SerializerMethodField()

    def get_tracks_count(self, obj):
        return obj.tracks.count()

    def get_likes(self, obj):
        return obj.likes.count()

    def get_liked(self, obj):
        # Лайкнул ли смотрящий — его передают в context["me"].
        me = self.context.get("me")
        return bool(me) and obj.likes.filter(profile=me).exists()

    def get_resume(self, obj):
        """Где смотрящий остановился в этом плейлисте: {track_id, position} или None."""
        from .models import PlaylistProgress
        me = self.context.get("me")
        if not me:
            return None
        p = PlaylistProgress.objects.filter(playlist=obj, profile=me, track__isnull=False).first()
        return {"track_id": str(p.track_id), "position": p.position} if p else None

    class Meta:
        model = Playlist
        fields = ["id", "name", "is_default", "created_at", "tracks_count", "share_token", "is_public", "plays", "likes", "liked", "resume"]
        read_only_fields = ["id", "is_default", "created_at", "tracks_count", "share_token", "is_public", "plays", "likes", "liked", "resume"]


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
    Свой эмодзи — ещё key и custom (chat/reactions.describe).
    """
    from .reactions import describe, grouped
    me = str(me_id) if me_id else None
    return [
        {**describe(v, custom), "count": len(users), "mine": me in users}
        for v, custom, users in grouped(message.reactions.all(), lambda r: str(r.user_id))
    ]


class MessageSerializer(serializers.ModelSerializer):
    sender = MessageSenderSerializer(read_only=True)
    reactions = serializers.SerializerMethodField()
    # Подписанные ссылки на вложения (s3://… → https://…), чтобы клиент не ходил
    # за подписью отдельно (chat/s3.py presigned_get_cached). Только для своих
    # полей сообщения: читать его может лишь участник чата, лишней проверки нет.
    signed = serializers.SerializerMethodField()

    def get_signed(self, obj):
        from .s3 import s3_enabled, presigned_get_cached
        if not s3_enabled():
            return None
        out = {}
        for raw in (obj.file_url, obj.poster_url, obj.voice_url, obj.video_url):
            if raw and isinstance(raw, str) and raw.startswith("s3://") and raw not in out:
                try:
                    out[raw] = presigned_get_cached(raw[5:])
                except Exception:
                    continue
        return out or None
    # Опрос (chat/polls.py) — только чтение: создаётся вместе с постом.
    poll = serializers.SerializerMethodField()

    # Расшифровку голосового видят все участники чата: аудио у них и так есть.
    # transcript_for — только кто её запрашивал. (Раньше здесь стоял второй
    # to_representation со «скрыть от остальных», но его молча перекрывал
    # метод ниже — правило никогда не действовало, и все к этому привыкли.)

    def validate(self, attrs):
        # Оформление проверяем по тексту этого же запроса (или текущему при
        # частичном обновлении): чужие типы и выход за границы отбрасываются.
        if 'entities' in attrs:
            from .formatting import clean_entities
            text = attrs.get('content')
            if text is None and self.instance is not None:
                text = self.instance.content
            from .formatting import resolve_custom_emoji
            attrs['entities'] = resolve_custom_emoji(clean_entities(attrs.get('entities'), text or ''))
        return super().validate(attrs)

    def validate_file_preview(self, value):
        """Только маленькая картинка данными: иначе в ленту можно было бы
        подсунуть что угодно под видом превью."""
        v = (value or "").strip()
        if not v:
            return ""
        if len(v) > 4000 or not v.startswith("data:image/"):
            raise serializers.ValidationError("Превью слишком большое или не картинка")
        return v

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
                # Кнопка мини-приложения: {text, web_app: {url}} — открывает
                # страницу внутри WYX (chat/webapp.py), боту ничего не шлёт.
                web_app = btn.get("web_app")
                if web_app is not None:
                    from .webapp import valid_app_url
                    url = (web_app.get("url") if isinstance(web_app, dict) else web_app) or ""
                    url = str(url).strip()
                    if not text or not valid_app_url(url):
                        raise serializers.ValidationError("У кнопки мини-приложения нужны text и web_app.url (https)")
                    out.append({"text": text, "web_app": {"url": url[:1024]}})
                    continue
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

    def get_poll(self, obj):
        if not obj.poll_id:
            return None
        from .polls import poll_payload
        me = getattr(getattr(self.context.get("request"), "user", None), "profile", None)
        return poll_payload(obj.poll, me.id if me else None, obj.sender_id)
    is_read = serializers.SerializerMethodField()
    read_by = serializers.SerializerMethodField()
    effect_seen = serializers.SerializerMethodField()
    sticker = serializers.SerializerMethodField()
    action = serializers.SerializerMethodField()
    action_target = serializers.SerializerMethodField()
    sound = NotificationSoundSerializer(read_only=True)
    reply_to = serializers.SerializerMethodField()
    forwarded_from = serializers.SerializerMethodField()
    forwarded_chat = serializers.SerializerMethodField()
    via_bot = serializers.SerializerMethodField()

    class Meta:
        model = Message
        fields = ['id', 'chat', 'sender', 'content', 'entities', 'translations', 'mentions', 'geo_lat', 'geo_lng', 'cipher', 'file_url', 'file_name', 'file_size', 'poster_url', 'file_width', 'file_height', 'album_id', 'created_at', 'is_read', 'read_by', 'sticker', 'voice_url', 'voice_duration', 'voice_transcript', 'transcript_status', 'transcript_translations', 'video_url', 'video_duration', 'sound', 'reply_to', 'download_only', 'video_mirror', 'video_flip', 'is_edited', 'forwarded_from', 'forwarded_title', 'forwarded_chat', 'via_bot', 'reactions', 'buttons', 'effect', 'effect_seen', 'wall_safe', 'wall_hidden', 'action', 'action_target', 'poll', 'signed', 'file_preview']
        read_only_fields = ['sender', 'created_at', 'file_size', 'mentions', 'geo_lat', 'geo_lng', 'forwarded_from', 'forwarded_title', 'forwarded_chat', 'via_bot', 'wall_safe', 'wall_hidden', 'action', 'action_target']

    def get_action(self, obj):
        """Действие («подмигивает»): клиент рисует сообщение-жест по центру."""
        a = obj.action
        # solo — «про себя», без адресата; фразы для отправителя/адресата — те,
        # что админ поправил руками (иначе клиент собирает их сам, lib/actionText).
        return {"id": a.id, "slug": a.slug, "name": a.name, "verb": a.verb, "emoji": a.emoji, "solo": a.solo,
                "phrase_en": a.phrase_en, "phrase_ko": a.phrase_ko,
                "phrase_ru_self": a.phrase_ru_self, "phrase_ru_you": a.phrase_ru_you,
                "phrase_en_self": a.phrase_en_self, "phrase_en_you": a.phrase_en_you,
                "phrase_ko_self": a.phrase_ko_self, "phrase_ko_you": a.phrase_ko_you} if a else None

    def get_action_target(self, obj):
        t = obj.action_target
        return {"id": str(t.id), "username": t.username} if t else None

    def get_sticker(self, obj):
        """Стикер сообщения. Если автор удалил его (или весь набор), отдаём
        сохранённый при отправке файл в том же виде — клиенты, и старые тоже,
        рисуют стикер по file_url и не замечают разницы."""
        if obj.sticker_id and obj.sticker:
            return StickerSerializer(obj.sticker).data
        if getattr(obj, 'sticker_file', ''):
            return {"id": None, "pack": None, "pack_name": "", "file_url": obj.sticker_file, "file_name": "",
                    "emoji": None, "keyword": "", "order": 0, "created_at": None, "deleted": True}
        return None

    def get_forwarded_from(self, obj):
        """От кого переслано: профиль, если он есть, — клиент может открыть его."""
        f = obj.forwarded_from
        if not f:
            return None
        return {"id": str(f.id), "username": f.username, "avatar_url": f.avatar_url}

    def get_via_bot(self, obj):
        """Бот, через которого отправлено (inline): подпись «через @бот» у пузыря."""
        b = obj.via_bot
        return {"id": str(b.id), "username": b.username} if b else None

    def get_forwarded_chat(self, obj):
        """Канал-первоисточник пересланного поста — клиент открывает его по тапу."""
        c = obj.forwarded_chat
        if not c:
            return None
        return {"id": str(c.id), "name": c.name, "username": c.username, "avatar_url": c.avatar_url}

    def get_reply_to(self, obj):
        """Компактная цитата: id, автор и короткое превью — без рекурсии по
        всей цепочке ответов."""
        r = obj.reply_to
        if not r:
            return None
        from .formatting import mask_preview
        preview = mask_preview(r.content or "", getattr(r, "entities", None)).strip()
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
        out = {
            "id": str(r.id),
            "sender_username": r.sender.username if r.sender else "",
            "preview": preview[:120],
        }
        # Ответ на выделенный кусок — показываем его вместо начала сообщения.
        if obj.reply_quote:
            out["quote"] = obj.reply_quote
        return out
    
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

    def get_effect_seen(self, obj):
        """Эффект получения уже разыгран у меня (MessageEffectSeen) — тогда
        клиент его не повторяет ни на этом устройстве, ни на других."""
        if not obj.effect:
            return False
        seen = getattr(obj, '_effect_seen', None)
        if seen is not None:
            return bool(seen)
        request = self.context.get('request')
        me = getattr(getattr(request, 'user', None), 'profile', None)
        if me is None:
            return False
        return MessageEffectSeen.objects.filter(message_id=obj.id, user_id=me.id).exists()

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
    """Вход по нику или по привязанной почте; ошибка — по-русски, а не
    «No active account found with the given credentials»."""
    def validate(self, attrs):
        username = (attrs.get('username') or '').strip().lstrip('@')
        if '@' in username:
            # Почта вместо ника: подставляем ник владельца подтверждённой почты.
            p = Profile.objects.filter(email__iexact=username, email_verified_at__isnull=False).select_related('user').first()
            if p:
                username = p.user.username
        else:
            # Ник без учёта регистра: точное совпадение важнее.
            p = Profile.objects.filter(username=username).first() or Profile.objects.filter(username__iexact=username).first()
            if p:
                username = p.user.username
        attrs['username'] = username
        logger.info(f"[JWT] Попытка аутентификации с username: {username}")
        try:
            data = super().validate(attrs)
            # Устройство входа → claim did в обоих токенах (chat/devices.py).
            from .devices import attach_device
            did = attach_device(self.user, self.initial_data if isinstance(self.initial_data, dict) else {})
            if did:
                refresh = self.get_token(self.user)
                refresh["did"] = did
                data["refresh"] = str(refresh)
                data["access"] = str(refresh.access_token)
            logger.info(f"[JWT] Аутентификация успешна для username: {username}")
            return data
        except exceptions.AuthenticationFailed:
            logger.warning(f"[JWT] Неверные данные для {username}")
            raise exceptions.AuthenticationFailed("Неверный ник, почта или пароль", code="no_active_account")
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

    # Пуши канала выключены у текущего пользователя (POST channels/<id>/mute/).
    muted = serializers.SerializerMethodField()

    def get_notify_sound(self, obj):
        return notify_sound_payload(self.context, obj)

    class Meta:
        model = Chat
        fields = ['id', 'kind', 'name', 'username', 'description', 'avatar_url',
                  'is_public', 'sign_posts', 'comments_enabled', 'subscribers_count', 'creator',
                  'my_role', 'muted', 'notify_sound', 'created_at', 'tg_username', 'tg_state']

    def _my_cp(self, obj):
        req = self.context.get('request')
        prof = getattr(getattr(req, 'user', None), 'profile', None) if req else None
        if not prof:
            return None
        return ChatParticipant.objects.filter(chat=obj, user=prof).first()

    def get_my_role(self, obj):
        cp = self._my_cp(obj)
        return cp.role if cp else None

    def get_muted(self, obj):
        cp = self._my_cp(obj)
        return bool(cp and cp.muted)


class PostCommentSerializer(serializers.ModelSerializer):
    """Комментарий; parent — на какой отвечает (ветки). Удалённый приходит,
    только если на него есть ответы, — заглушкой без текста и автора."""
    author = ProfileSerializer(read_only=True)

    class Meta:
        model = PostComment
        fields = ['id', 'post', 'author', 'parent', 'content', 'created_at', 'deleted',
                  'file_url', 'file_name', 'file_kind', 'file_size', 'file_width', 'file_height']
        read_only_fields = fields

    def to_representation(self, obj):
        data = super().to_representation(obj)
        if obj.deleted:
            data.update(content="", author=None, file_url="", file_name="", file_kind="", file_size=None, file_width=None, file_height=None)
        return data


class SavedImageSerializer(serializers.ModelSerializer):
    # Вайб за картинку: сколько раз подняли и поднимал ли я (SavedImageVibe).
    # Список отдаёт их аннотацией (SavedImagesView), одиночный — запросом.
    vibes = serializers.SerializerMethodField()
    vibed = serializers.SerializerMethodField()

    class Meta:
        model = SavedImage
        fields = ['id', 'file_url', 'file_name', 'created_at', 'vibes', 'vibed']
        read_only_fields = fields

    def get_vibes(self, obj):
        v = getattr(obj, '_vibes', None)
        return v if v is not None else obj.vibes.count()

    def get_vibed(self, obj):
        v = getattr(obj, '_vibed', None)
        if v is not None:
            return bool(v)
        me = self.context.get('me')
        return bool(me) and obj.vibes.filter(voter=me).exists()


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


class ChatActionSerializer(serializers.ModelSerializer):
    class Meta:
        model = ChatAction
        fields = ['id', 'slug', 'name', 'verb', 'emoji', 'premium', 'adult', 'solo', 'name_en', 'name_ko', 'phrase_en', 'phrase_ko',
                  'phrase_ru_self', 'phrase_ru_you', 'phrase_en_self', 'phrase_en_you', 'phrase_ko_self', 'phrase_ko_you']


class ChatActionAdminSerializer(serializers.ModelSerializer):
    """Правка каталога действий админом (ActionsView ?all=1, POST, PATCH)."""
    class Meta:
        model = ChatAction
        fields = ['id', 'slug', 'name', 'verb', 'emoji', 'order', 'is_active', 'premium', 'adult', 'solo',
                  'name_en', 'name_ko', 'phrase_en', 'phrase_ko',
                  'phrase_ru_self', 'phrase_ru_you', 'phrase_en_self', 'phrase_en_you', 'phrase_ko_self', 'phrase_ko_you']
        read_only_fields = ['id', 'slug']
