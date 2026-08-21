from django.contrib import admin
from .models import Profile, Friendship, Chat, ChatParticipant, Message, NotificationSound

admin.site.register(Profile)
admin.site.register(Friendship)
admin.site.register(Chat)
admin.site.register(ChatParticipant)
admin.site.register(Message)


@admin.register(NotificationSound)
class NotificationSoundAdmin(admin.ModelAdmin):
    list_display = ("name", "slug", "is_active", "order", "caf_url", "updated_at")
    list_editable = ("is_active", "order")
    prepopulated_fields = {"slug": ("name",)}
    readonly_fields = ("caf_url", "updated_at")
