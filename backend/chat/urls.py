from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import *
from .account import AcceptTermsView, DeleteAccountView
from .themes import ThemesView, ThemeDetailView, ThemeInstallView
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
    path('account/accept-terms/', AcceptTermsView.as_view(), name='account-accept-terms'),
    path('account/delete/', DeleteAccountView.as_view(), name='account-delete'),
    path('themes/', ThemesView.as_view(), name='themes'),
    path('themes/<uuid:pk>/', ThemeDetailView.as_view(), name='theme-detail'),
    path('themes/<uuid:pk>/install/', ThemeInstallView.as_view(), name='theme-install'),
    path('token/', TokenObtainPairView.as_view(serializer_class=CustomTokenObtainPairSerializer), name='token_obtain_pair'),
    path('token/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('upload/', FileUploadView.as_view(), name='file-upload'),
    path('upload/chunk/', ChunkUploadView.as_view(), name='file-upload-chunk'),
    path('upload/chunk/<str:upload_id>/', ChunkUploadView.as_view(), name='file-upload-chunk-status'),
    path('stickers/upload/', StickerUploadView.as_view(), name='sticker-upload'),
    path('voice/upload/', VoiceUploadView.as_view(), name='voice-upload'),
    path('avatar/upload/', AvatarUploadView.as_view(), name='avatar-upload'),
    path('cover/upload/', CoverUploadView.as_view(), name='cover-upload'),
    path('reports/', ReportView.as_view(), name='reports'),
    path('blocks/', BlockView.as_view(), name='blocks'),
    path('saved-viewers/', SavedViewersView.as_view(), name='saved-viewers'),
    path('bugreports/', BugReportView.as_view(), name='bugreports'),
    path('push/register/', PushRegisterView.as_view(), name='push-register'),
    path('saved-images/', SavedImagesView.as_view(), name='saved-images'),
    path('sticker-packs/import-telegram/', TelegramStickerImportView.as_view(), name='sticker-import-telegram'),
    path('sticker-packs/import-telegram/<uuid:pk>/', TelegramStickerImportView.as_view(), name='sticker-import-telegram-status'),
    path('music/', MusicView.as_view(), name='music'),
    path('music/<uuid:pk>/', MusicView.as_view(), name='music-item'),
    path('saved-images/<uuid:pk>/', SavedImagesView.as_view(), name='saved-image'),
    path('ice-servers/', IceServersView.as_view(), name='ice-servers'),
    path('bots/', BotsView.as_view(), name='bots'),
    path('bots/<uuid:pk>/', BotDetailView.as_view(), name='bot-detail'),
    # Каналы
    path('channels/', ChannelsView.as_view(), name='channels'),
    path('channels/discover/', ChannelDiscoverView.as_view(), name='channels-discover'),
    path('channels/by-handle/<str:handle>/', ChannelByHandleView.as_view(), name='channel-by-handle'),
    path('channels/<uuid:pk>/', ChannelDetailView.as_view(), name='channel-detail'),
    path('channels/<uuid:pk>/subscribe/', ChannelSubscribeView.as_view(), name='channel-subscribe'),
    path('channels/<uuid:pk>/leave/', ChannelLeaveView.as_view(), name='channel-leave'),
    path('channels/<uuid:pk>/admins/', ChannelAdminsView.as_view(), name='channel-admins'),
    path('channels/<uuid:pk>/posts/', ChannelPostsView.as_view(), name='channel-posts'),
    path('posts/<uuid:pk>/react/', PostReactView.as_view(), name='post-react'),
    path('posts/<uuid:pk>/comments/', PostCommentsView.as_view(), name='post-comments'),
    path('posts/<uuid:pk>/view/', PostViewMark.as_view(), name='post-view'),
    path('posts/comments/<uuid:pk>/', PostCommentDetailView.as_view(), name='post-comment-detail'),
    path('sounds/', NotificationSoundListView.as_view(), name='notification-sounds'),
    path('sounds/mine/', MySoundPacksView.as_view(), name='sound-packs-mine'),
    path('sounds/pack/', SoundPackStudioView.as_view(), name='sound-pack-studio'),
    path('sounds/pack/<uuid:pk>/', SoundPackDetailView.as_view(), name='sound-pack-detail'),
    path('sounds/pack/<uuid:pk>/sounds/', SoundPackAddSoundsView.as_view(), name='sound-pack-add'),
    path('sounds/pack/<uuid:pk>/cover/', SoundPackCoverView.as_view(), name='sound-pack-cover'),
    path('sounds/pack/<uuid:pk>/subscribe/', SoundPackSubscribeView.as_view(), name='sound-pack-subscribe'),
    path('sounds/added/', AddedSoundPacksView.as_view(), name='sound-packs-added'),
    path('sounds/sound/<uuid:pk>/', SoundDetailView.as_view(), name='sound-detail'),
    path('media/sign/', MediaSignView.as_view(), name='media-sign'),
    path('sticker-packs/import/', StickerPackViewSet.as_view({'post': 'import_pack'}), name='sticker-pack-import'),
    # Роутер ПОСЛЕ кастомных маршрутов
    path('', include(router.urls)),
]