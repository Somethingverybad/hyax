from django.contrib import admin
from django.utils import timezone

from django.utils.html import format_html

from .models import (
    Block, BugReport, Chat, ChatParticipant, Friendship, Message, NotificationSound,
    Profile, Report, SoundPack,
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
admin.site.register(Chat)
admin.site.register(ChatParticipant)
admin.site.register(Message)


@admin.register(SoundPack)
class SoundPackAdmin(admin.ModelAdmin):
    """Стандартный пак (галочка «По умолчанию») есть у всех без подписки;
    таких может быть несколько. Остальные — по ссылке."""
    list_display = ("name", "is_default", "creator", "is_public", "order", "created_at")
    list_editable = ("is_default", "is_public", "order")
    list_filter = ("is_default", "is_public")
    search_fields = ("name", "creator__username")


@admin.register(NotificationSound)
class NotificationSoundAdmin(admin.ModelAdmin):
    list_display = ("name", "slug", "pack", "is_active", "order", "caf_url", "updated_at")
    list_editable = ("pack", "is_active", "order")
    list_filter = ("pack", "is_active")
    prepopulated_fields = {"slug": ("name",)}
    readonly_fields = ("caf_url", "updated_at")
