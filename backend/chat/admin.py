from django import forms
from django.contrib import admin
from django.utils import timezone

from django.urls import reverse
from django.utils.html import format_html, format_html_join

from django.db.models import Count, Q

from .models import (
    ChatAction,
    Block, BugReport, Channel, Chat, ChatParticipant, Friendship, Message, NotificationSound,
    Profile, Report, SoundPack, StickerPack, TgLeave, Theme,
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


class MirrorFilter(admin.SimpleListFilter):
    title = "Зеркало Telegram"
    parameter_name = "mirror"

    def lookups(self, request, model_admin):
        return (("yes", "Да"), ("no", "Нет"))

    def queryset(self, request, queryset):
        if self.value() == "yes":
            return queryset.exclude(tg_username=None)
        if self.value() == "no":
            return queryset.filter(tg_username=None)
        return queryset


@admin.register(Channel)
class ChannelAdmin(admin.ModelAdmin):
    """Каналы: поиск по названию, @нику, описанию и владельцу; сколько
    подписчиков и постов; ссылка, чтобы открыть канал. Создают каналы в
    приложении, здесь — посмотреть, поправить, удалить (вместе с постами)."""
    list_display = ("title", "handle", "members", "posts", "is_public", "comments_enabled", "creator", "mirror", "created_at", "link")
    list_filter = (MirrorFilter, "is_public", "comments_enabled", "sign_posts")
    search_fields = ("name", "username", "description", "creator__username", "tg_username")
    actions = ("leave_and_delete",)
    ordering = ("-subscribers_count", "-created_at")
    list_select_related = ("creator",)
    fields = ("name", "username", "description", "avatar_url", "is_public", "sign_posts", "comments_enabled",
              "creator", "subscribers_count", "members_list", "tg_username", "tg_state", "tg_error", "id", "created_at", "updated_at")
    readonly_fields = ("id", "subscribers_count", "members_list", "tg_username", "tg_state", "tg_error", "created_at", "updated_at")
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

    @admin.display(description="Подписчиков", ordering="subscribers_count")
    def members(self, obj):
        return format_html('<a href="{}?chat__id__exact={}">{}</a>',
                           reverse("admin:chat_chatparticipant_changelist"), obj.id, obj.subscribers_count)

    #: Сколько последних участников показывать прямо в карточке; остальные —
    #: по ссылке, в постраничном списке с поиском (каналы бывают на тысячи).
    PARTICIPANTS_SHOWN = 50

    # Не «participants»: так называется поле модели (M2M), и админка взяла бы его.
    @admin.display(description="Участники")
    def members_list(self, obj):
        if not obj.pk:
            return "—"
        qs = ChatParticipant.objects.filter(chat=obj).select_related("user")
        total = qs.count()
        rows = qs.order_by("-joined_at")[:self.PARTICIPANTS_SHOWN]
        roles = {"owner": "владелец", "admin": "админ", "subscriber": "подписчик", "member": "участник"}
        table = format_html_join("", '<tr><td><a href="{}">{}</a></td><td>{}</td><td>{}</td><td>{}</td></tr>', (
            (reverse("admin:chat_profile_change", args=[p.user_id]), p.user.username, roles.get(p.role, p.role),
             timezone.localtime(p.joined_at).strftime("%d.%m.%Y %H:%M"), "без уведомлений" if p.muted else "")
            for p in rows))
        more = reverse("admin:chat_chatparticipant_changelist")
        return format_html(
            '<p><a href="{}?chat__id__exact={}">Все участники ({}) — поиск, роли →</a></p>'
            '<table><thead><tr><th>Ник</th><th>Роль</th><th>Вступил</th><th></th></tr></thead><tbody>{}</tbody></table>'
            '<p class="help">{}</p>',
            more, obj.id, total, table,
            f"Последние {len(rows)} из {total}, новые сверху." if total > len(rows) else "Новые сверху.")

    @admin.display(description="Постов", ordering="_posts")
    def posts(self, obj):
        return obj._posts

    @admin.display(description="Telegram", ordering="tg_username")
    def mirror(self, obj):
        if not obj.tg_username:
            return ""
        return f"@{obj.tg_username} · {obj.tg_state or '—'}"

    # Удаление зеркала любым способом ставит отписку в очередь (chat/signals.py);
    # здесь — только подсказать, где за ней следить.
    def _leave_note(self, request, n):
        if n:
            self.message_user(request, f"Зеркал удалено: {n}. Аккаунт выйдет из каналов-источников в течение минуты — "
                                       "смотрите «Отписки в Telegram».")

    def delete_model(self, request, obj):
        mirror = bool(obj.tg_username)
        super().delete_model(request, obj)
        self._leave_note(request, int(mirror))

    def delete_queryset(self, request, queryset):
        n = queryset.exclude(tg_username=None).count()
        super().delete_queryset(request, queryset)
        self._leave_note(request, n)

    @admin.action(description="Отписаться в Telegram и удалить зеркала")
    def leave_and_delete(self, request, queryset):
        mirrors = queryset.exclude(tg_username=None)
        skipped = queryset.count() - mirrors.count()
        n = mirrors.count()
        for ch in mirrors:
            ch.delete()  # сигнал ставит отписку в очередь
        self._leave_note(request, n)
        if skipped:
            self.message_user(request, f"Не зеркал — пропущено: {skipped}. Обычные каналы удаляйте действием «Удалить».", level="warning")

    @admin.display(description="Ссылка")
    def link(self, obj):
        return format_html('<a href="https://wyx.su/c/{}" target="_blank" rel="noopener">открыть</a>', obj.username or obj.id)
class TgLeaveForm(forms.ModelForm):
    class Meta:
        model = TgLeave
        fields = ("tg_username", "title")

    def clean_tg_username(self):
        from .telegram_mirror import parse_channel_ref
        name = parse_channel_ref(self.cleaned_data.get("tg_username") or "")
        if not name:
            raise forms.ValidationError("Нужен ник канала, @ник или ссылка t.me/…")
        return name


@admin.register(TgLeave)
class TgLeaveAdmin(admin.ModelAdmin):
    form = TgLeaveForm
    """Очередь отписок нашего Telegram-аккаунта. Записи появляются сами при
    удалении зеркала; вручную — для канала, зеркала которого уже нет (ник,
    @ник или ссылка t.me/…). Выполняет воркер tg_mirror раз в ~15 секунд."""
    list_display = ("tg_username", "title", "created_at", "state", "attempts", "error")
    list_filter = (("done_at", admin.EmptyFieldListFilter),)
    search_fields = ("tg_username", "title")
    fields = ("tg_username", "title", "tg_peer_id", "created_at", "done_at", "attempts", "error")
    readonly_fields = ("tg_peer_id", "created_at", "done_at", "attempts", "error")
    actions = ("retry",)

    def get_readonly_fields(self, request, obj=None):
        # Ник задаётся при добавлении; у существующей записи его не правят.
        return self.readonly_fields + (("tg_username",) if obj else ())

    @admin.display(description="Состояние")
    def state(self, obj):
        if not obj.done_at:
            return "ждёт" if obj.attempts < obj.MAX_ATTEMPTS else "не вышло"
        return "не выполнено" if obj.error else "вышли"

    @admin.action(description="Повторить")
    def retry(self, request, queryset):
        n = queryset.update(done_at=None, attempts=0, error="")
        self.message_user(request, f"Снова в очереди: {n}")


@admin.register(ChatParticipant)
class ChatParticipantAdmin(admin.ModelAdmin):
    """Участники чатов. Список участников одного канала — из его карточки
    («Все участники») или фильтром ?chat__id__exact=<id>."""
    list_display = ("user", "chat", "role", "muted", "joined_at")
    list_filter = ("role", "chat__kind")
    search_fields = ("user__username", "chat__name", "chat__username")
    ordering = ("-joined_at",)
    list_select_related = ("user", "chat")
    raw_id_fields = ("user", "chat")
    list_per_page = 100


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
