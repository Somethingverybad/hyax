from django.contrib import admin
from .models import Profile, Friendship, Chat, ChatParticipant, Message

admin.site.register(Profile)
admin.site.register(Friendship)
admin.site.register(Chat)
admin.site.register(ChatParticipant)
admin.site.register(Message)
