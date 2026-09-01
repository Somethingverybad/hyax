from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import *
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView
from .serializers import CustomTokenObtainPairSerializer

# urls.py
router = DefaultRouter()
router.register(r'profiles', ProfileViewSet)
router.register(r'friendships', FriendshipViewSet)
router.register(r'chats', ChatViewSet)
router.register(r'participants', ChatParticipantViewSet)
router.register(r'messages', MessageViewSet, basename='message')  # добавьте basename
router.register(r'sticker-packs', StickerPackViewSet, basename='stickerpack')
router.register(r'stickers', StickerViewSet, basename='sticker')

urlpatterns = [
    # Кастомные маршруты ДО роутера
    path('profiles/current/', get_current_user_profile, name='current-profile'),
    path('auth/register/', register_user, name='register'),
    path('auth/login/', login_user, name='login'),
    path('auth/logout/', logout_user, name='logout'),
    path('token/', TokenObtainPairView.as_view(serializer_class=CustomTokenObtainPairSerializer), name='token_obtain_pair'),
    path('token/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('upload/', FileUploadView.as_view(), name='file-upload'),
    path('stickers/upload/', StickerUploadView.as_view(), name='sticker-upload'),
    path('voice/upload/', VoiceUploadView.as_view(), name='voice-upload'),
    path('avatar/upload/', AvatarUploadView.as_view(), name='avatar-upload'),
    path('push/register/', PushRegisterView.as_view(), name='push-register'),
    path('ice-servers/', IceServersView.as_view(), name='ice-servers'),
    path('bots/', BotsView.as_view(), name='bots'),
    path('bots/<uuid:pk>/', BotDetailView.as_view(), name='bot-detail'),
    path('sounds/', NotificationSoundListView.as_view(), name='notification-sounds'),
    path('sounds/mine/', MySoundPacksView.as_view(), name='sound-packs-mine'),
    path('sounds/pack/', SoundPackStudioView.as_view(), name='sound-pack-studio'),
    path('sounds/pack/<uuid:pk>/', SoundPackDetailView.as_view(), name='sound-pack-detail'),
    path('sounds/pack/<uuid:pk>/sounds/', SoundPackAddSoundsView.as_view(), name='sound-pack-add'),
    path('sounds/sound/<uuid:pk>/', SoundDetailView.as_view(), name='sound-detail'),
    path('media/sign/', MediaSignView.as_view(), name='media-sign'),
    path('sticker-packs/import/', StickerPackViewSet.as_view({'post': 'import_pack'}), name='sticker-pack-import'),
    # Роутер ПОСЛЕ кастомных маршрутов
    path('', include(router.urls)),
]