from django.contrib import admin
from .models import Profile, Friendship, Chat, ChatParticipant, Message, NotificationSound, SoundPack

admin.site.register(Profile)
admin.site.register(Friendship)
admin.site.register(Chat)
admin.site.register(ChatParticipant)
admin.site.register(Message)


@admin.register(SoundPack)
class SoundPackAdmin(admin.ModelAdmin):
    list_display = ("name", "order", "created_at")
    list_editable = ("order",)


@admin.register(NotificationSound)
class NotificationSoundAdmin(admin.ModelAdmin):
    list_display = ("name", "slug", "pack", "is_active", "order", "caf_url", "updated_at")
    list_editable = ("pack", "is_active", "order")
    list_filter = ("pack", "is_active")
    prepopulated_fields = {"slug": ("name",)}
    readonly_fields = ("caf_url", "updated_at")
