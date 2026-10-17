from django.contrib import admin
from django.utils import timezone

from django.utils.html import format_html

from django.db.models import Count, Q

from .models import (
    ChatAction,
    Block, BugReport, Channel, Chat, ChatParticipant, Friendship, Message, NotificationSound,
    Profile, Report, SoundPack, StickerPack, Theme,
)


@admin.register(Profile)
class ProfileAdmin(admin.ModelAdmin):
    """Профили и роли.

    Роль меняется прямо в списке. После сохранения состав системного чата
    «Жалобы» пересобирается: выдал роль support — человек сразу видит чат,
    забрал — чат у него пропадает, руками ничего делать не нужно.
    """
    list_display = ("username", "role", "is_bot", "status", "created_at")
    list_editable = ("role",)
    list_filter = ("role", "is_bot")
    search_fields = ("username", "user__username")
    ordering = ("-created_at",)
    actions = ("make_support", "make_user")

    def _resync(self):
        from .moderation import sync_staff_membership
        try:
            sync_staff_membership()
        except Exception:
            # Чат жалоб может ещё не существовать — это не повод ломать сохранение.
            pass

    def save_model(self, request, obj, form, change):
        super().save_model(request, obj, form, change)
        self._resync()

    def save_related(self, request, form, formsets, change):
        super().save_related(request, form, formsets, change)
        self._resync()

    @admin.action(description="Назначить роль «Поддержка»")
    def make_support(self, request, queryset):
        n = queryset.update(role=Profile.ROLE_SUPPORT)
        self._resync()
        self.message_user(request, f"Поддержка: {n}")

    @admin.action(description="Вернуть роль «Пользователь»")
    def make_user(self, request, queryset):
        n = queryset.update(role=Profile.ROLE_USER)
        self._resync()
        self.message_user(request, f"Пользователи: {n}")


@admin.register(Report)
class ReportAdmin(admin.ModelAdmin):
    """Жалобы. Разбирают их в чате «Жалобы», здесь — архив и статусы."""
    list_display = ("created_at", "reason", "target_type", "target_profile", "reporter", "status")
    list_editable = ("status",)
    list_filter = ("status", "reason", "target_type")
    search_fields = ("target_id", "comment", "snapshot", "reporter__username", "target_profile__username")
    readonly_fields = ("created_at", "reporter", "target_type", "target_id", "target_profile", "reason", "comment", "snapshot")
    ordering = ("-created_at",)
    actions = ("mark_actioned", "mark_rejected")

    @admin.action(description="Приняты меры")
    def mark_actioned(self, request, queryset):
        queryset.update(status="actioned", handled_at=timezone.now())

    @admin.action(description="Отклонить")
    def mark_rejected(self, request, queryset):
        queryset.update(status="rejected", handled_at=timezone.now())


@admin.register(BugReport)
class BugReportAdmin(admin.ModelAdmin):
    """Архив баг-репортов. Разбирают в чате «Баг-репорты», здесь — статусы
    и ссылки на скриншот и лог."""
    list_display = ("created_at", "reporter", "platform", "version", "short", "links", "status")
    list_editable = ("status",)
    list_filter = ("status",)
    search_fields = ("description", "reporter__username")
    readonly_fields = ("created_at", "reporter", "description", "screenshot_url", "log_url", "meta")
    ordering = ("-created_at",)

    @admin.display(description="Платформа")
    def platform(self, obj):
        return (obj.meta or {}).get("platform", "")

    @admin.display(description="Версия")
    def version(self, obj):
        m = obj.meta or {}
        return f"{m.get('app_version', '')} ({m.get('app_build', '')})"

    @admin.display(description="Описание")
    def short(self, obj):
        return (obj.description or "")[:80]

    @admin.display(description="Файлы")
    def links(self, obj):
        parts = []
        if obj.screenshot_url:
            parts.append(format_html('<a href="{}" target="_blank">скриншот</a>', obj.screenshot_url))
        if obj.log_url:
            parts.append(format_html('<a href="{}" target="_blank">лог</a>', obj.log_url))
        return format_html(" · ".join(["{}"] * len(parts)), *parts) if parts else "—"


@admin.register(Block)
class BlockAdmin(admin.ModelAdmin):
    list_display = ("blocker", "blocked", "created_at")
    search_fields = ("blocker__username", "blocked__username")
    ordering = ("-created_at",)


admin.site.register(Friendship)
@admin.register(Chat)
class ChatAdmin(admin.ModelAdmin):
    """Все чаты подряд: лички, группы, каналы, «Избранное», Стена. Каналы
    удобнее смотреть в своём разделе «Каналы»."""
    list_display = ("__str__", "kind", "created_at")
    list_filter = ("kind",)
    search_fields = ("name", "username")
    ordering = ("-created_at",)
    raw_id_fields = ("creator", "pending_for", "pinned_message", "default_sound", "notify_sound")


class ChannelStaffInline(admin.TabularInline):
    """Владелец и админы канала (подписчиков бывают тысячи — их здесь нет)."""
    model = ChatParticipant
    fk_name = "chat"
    fields = ("user", "role", "joined_at")
    readonly_fields = ("user", "joined_at")
    extra = 0
    can_delete = False
    verbose_name = "Владелец или админ"
    verbose_name_plural = "Владелец и админы"

    def get_queryset(self, request):
        return super().get_queryset(request).filter(role__in=("owner", "admin")).select_related("user")

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(Channel)
class ChannelAdmin(admin.ModelAdmin):
    """Каналы: поиск по названию, @нику, описанию и владельцу; сколько
    подписчиков и постов; ссылка, чтобы открыть канал. Создают каналы в
    приложении, здесь — посмотреть, поправить, удалить (вместе с постами)."""
    list_display = ("title", "handle", "subscribers_count", "posts", "is_public", "comments_enabled", "creator", "created_at", "link")
    list_filter = ("is_public", "comments_enabled", "sign_posts")
    search_fields = ("name", "username", "description", "creator__username")
    ordering = ("-subscribers_count", "-created_at")
    list_select_related = ("creator",)
    fields = ("name", "username", "description", "avatar_url", "is_public", "sign_posts", "comments_enabled",
              "creator", "subscribers_count", "id", "created_at", "updated_at")
    readonly_fields = ("id", "subscribers_count", "created_at", "updated_at")
    raw_id_fields = ("creator",)
    inlines = (ChannelStaffInline,)

    def get_queryset(self, request):
        return (super().get_queryset(request).filter(kind="channel")
                .annotate(_posts=Count("messages", filter=Q(messages__deleted_for_all=False))))

    def has_add_permission(self, request):
        return False

    @admin.display(description="Название", ordering="name")
    def title(self, obj):
        return obj.name or "—"

    @admin.display(description="Ник", ordering="username")
    def handle(self, obj):
        return f"@{obj.username}" if obj.username else "—"

    @admin.display(description="Постов", ordering="_posts")
    def posts(self, obj):
        return obj._posts

    @admin.display(description="Ссылка")
    def link(self, obj):
        return format_html('<a href="https://wyx.su/c/{}" target="_blank" rel="noopener">открыть</a>', obj.username or obj.id)
admin.site.register(ChatParticipant)
admin.site.register(Message)


@admin.register(SoundPack)
class SoundPackAdmin(admin.ModelAdmin):
    """Стандартный пак (галочка «По умолчанию») есть у всех без подписки;
    таких может быть несколько. Остальные — по ссылке."""
    list_display = ("name", "is_default", "is_adult", "creator", "is_public", "order", "created_at")
    list_editable = ("is_default", "is_adult", "is_public", "order")
    list_filter = ("is_default", "is_adult", "is_public")
    search_fields = ("name", "creator__username")


@admin.register(StickerPack)
class StickerPackAdmin(admin.ModelAdmin):
    """Пометка 18+ прячет пак от тех, кто не включил «Показывать 18+»."""
    list_display = ("name", "is_adult", "author", "is_public", "created_at")
    list_editable = ("is_adult", "is_public")
    list_filter = ("is_adult", "is_public")
    search_fields = ("name", "author__username")


@admin.register(NotificationSound)
class NotificationSoundAdmin(admin.ModelAdmin):
    list_display = ("name", "slug", "pack", "is_active", "order", "caf_url", "updated_at")
    list_editable = ("pack", "is_active", "order")
    list_filter = ("pack", "is_active")
    prepopulated_fields = {"slug": ("name",)}
    readonly_fields = ("caf_url", "updated_at")


@admin.register(Theme)
class ThemeAdmin(admin.ModelAdmin):
    """Темы пользователей. Снять галочку «is_public» — тема перестаёт открываться
    по ссылке; удалить — пропадёт и у установивших."""
    list_display = ("name", "author", "is_public", "updated_at")
    list_editable = ("is_public",)
    list_filter = ("is_public",)
    search_fields = ("name", "author__username")


@admin.register(ChatAction)
class ChatActionAdmin(admin.ModelAdmin):
    """Действия в чате («подмигнуть», «обнять»). Добавить новое — строкой здесь;
    verb — форма в сообщении: «<эмодзи> <ник> <verb> <ник адресата>»."""
    list_display = ("emoji", "name", "verb", "slug", "order", "is_active", "premium")
    list_editable = ("order", "is_active", "premium")
    prepopulated_fields = {"slug": ("name",)}
    ordering = ("order",)
