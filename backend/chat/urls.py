from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import *
from .radio import StationsView, StationView, StationControlView, StationListenView
from .webapp import WebAppInitView, WebAppDataView, WebAppCatalogView, wyx_user_page, wyx_link_page
from .obs import ObsKeyView
from .account import AcceptTermsView, DeleteAccountView, EmailView, EmailConfirmView, PasswordForgotView, PasswordResetView
from .inline import InlineQueryView, InlineAnswerView, InlineChooseView, InlineFillView
from .themes import ThemesView, ThemeDetailView, ThemeInstallView
from .secret import SecretChatCreateView, SecretChatAcceptView, SecretChatDeclineView
from .keytransfer import KeyTransferCreateView, KeyTransferLookupView, KeyTransferBlobView
from .devices import DeviceTokenRefreshSerializer, DevicesView, DeviceRevokeView, DevicesRevokeOthersView
from .ideabox import IdeaboxView, IdeasListView, IdeaActionView, VibeView, VibeHistoryView, VibeLevelsView
from .polls import PollVoteView, PollVotersView
from .live import LiveSpeechView, LiveTextView
from .graffiti import GraffitiView
from .wall import WallView, WallSeenView, WallPostsView, WallPostsCheckView, WallMuteView, WallNotifyMuteView, WallRepostView, WallAdminPostView, WallAdminBansView
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
    path('admin/metrics/', AdminMetricsView.as_view(), name='admin-metrics'),
    path('admin/registrations/', AdminRegistrationsView.as_view(), name='admin-registrations'),
    path('secret-chats/', SecretChatCreateView.as_view(), name='secret-create'),
    path('ideabox/', IdeaboxView.as_view(), name='ideabox'),
    path('ideas/', IdeasListView.as_view(), name='ideas'),
    path('ideas/<uuid:idea_id>/<str:act>/', IdeaActionView.as_view(), name='idea-action'),
    path('vibe/history/', VibeHistoryView.as_view(), name='vibe-history'),
    path('vibe/<uuid:profile_id>/', VibeView.as_view(), name='vibe'),
    path('vibe-levels/', VibeLevelsView.as_view(), name='vibe-levels'),
    # Стена (chat/wall.py)
    path('wall/', WallView.as_view(), name='wall'),
    path('wall/seen/', WallSeenView.as_view(), name='wall-seen'),
    path('wall/posts/', WallPostsView.as_view(), name='wall-posts'),
    path('wall/posts/check/', WallPostsCheckView.as_view(), name='wall-posts-check'),
    path('wall/mute/', WallMuteView.as_view(), name='wall-mute'),
    path('wall/notify-mute/', WallNotifyMuteView.as_view(), name='wall-notify-mute'),
    path('wall/repost/', WallRepostView.as_view(), name='wall-repost'),
    path('wall/admin/posts/<uuid:pk>/', WallAdminPostView.as_view(), name='wall-admin-post'),
    path('wall/admin/bans/', WallAdminBansView.as_view(), name='wall-admin-bans'),
    path('secret-chats/<uuid:chat_id>/accept/', SecretChatAcceptView.as_view(), name='secret-accept'),
    path('secret-chats/<uuid:chat_id>/decline/', SecretChatDeclineView.as_view(), name='secret-decline'),
    path('secret-transfer/', KeyTransferCreateView.as_view(), name='keytransfer-create'),
    path('secret-transfer/<str:ref>/', KeyTransferLookupView.as_view(), name='keytransfer-lookup'),
    path('secret-transfer/<str:ref>/blob/', KeyTransferBlobView.as_view(), name='keytransfer-blob'),
    path('auth/register/', register_user, name='register'),
    path('auth/login/', login_user, name='login'),
    path('auth/logout/', logout_user, name='logout'),
    path('account/accept-terms/', AcceptTermsView.as_view(), name='account-accept-terms'),
    path('account/delete/', DeleteAccountView.as_view(), name='account-delete'),
    path('account/email/', EmailView.as_view(), name='account-email'),
    path('account/email/confirm/', EmailConfirmView.as_view(), name='account-email-confirm'),
    path('auth/password/forgot/', PasswordForgotView.as_view(), name='password-forgot'),
    path('auth/password/reset/', PasswordResetView.as_view(), name='password-reset'),
    path('themes/', ThemesView.as_view(), name='themes'),
    path('themes/<uuid:pk>/', ThemeDetailView.as_view(), name='theme-detail'),
    path('themes/<uuid:pk>/install/', ThemeInstallView.as_view(), name='theme-install'),
    path('token/', TokenObtainPairView.as_view(serializer_class=CustomTokenObtainPairSerializer), name='token_obtain_pair'),
    path('token/refresh/', TokenRefreshView.as_view(serializer_class=DeviceTokenRefreshSerializer), name='token_refresh'),
    path('account/devices/', DevicesView.as_view(), name='account-devices'),
    path('account/devices/revoke-others/', DevicesRevokeOthersView.as_view(), name='account-devices-revoke-others'),
    path('account/devices/<str:device_id>/revoke/', DeviceRevokeView.as_view(), name='account-device-revoke'),
    path('upload/', FileUploadView.as_view(), name='file-upload'),
    path('upload/chunk/', ChunkUploadView.as_view(), name='file-upload-chunk'),
    path('upload/chunk/<str:upload_id>/', ChunkUploadView.as_view(), name='file-upload-chunk-status'),
    path('stickers/upload/', StickerUploadView.as_view(), name='sticker-upload'),
    path('stickers/recent/', RecentStickersView.as_view(), name='stickers-recent'),
    path('graffiti/', GraffitiView.as_view(), name='graffiti'),
    path('voice/upload/', VoiceUploadView.as_view(), name='voice-upload'),
    path('avatar/upload/', AvatarUploadView.as_view(), name='avatar-upload'),
    path('avatar/animated/', AnimatedAvatarUploadView.as_view(), name='avatar-animated'),
    path('cover/upload/', CoverUploadView.as_view(), name='cover-upload'),
    path('reports/', ReportView.as_view(), name='reports'),
    path('blocks/', BlockView.as_view(), name='blocks'),
    path('saved-viewers/', SavedViewersView.as_view(), name='saved-viewers'),
    path('playlists/', PlaylistsView.as_view(), name='playlists'),
    path('playlists/<uuid:pk>/', PlaylistView.as_view(), name='playlist'),
    path('playlists/tracks/', PlaylistTracksView.as_view(), name='playlist-tracks-default'),
    path('playlists/all-tracks/', MyTracksView.as_view(), name='playlist-all-tracks'),
    path('playlists/<uuid:pk>/share/', PlaylistShareView.as_view(), name='playlist-share'),
    path('playlists/<uuid:pk>/play/', PlaylistPlayView.as_view(), name='playlist-play'),
    path('playlists/<uuid:pk>/like/', PlaylistLikeView.as_view(), name='playlist-like'),
    path('playlists/<uuid:pk>/progress/', PlaylistProgressView.as_view(), name='playlist-progress'),
    path('playlists/shared/<str:token>/', SharedPlaylistView.as_view(), name='playlist-shared'),
    path('playlists/public/', PublicPlaylistsView.as_view(), name='playlists-public'),
    path('playlists/public/<uuid:pk>/', PublicPlaylistView.as_view(), name='playlist-public'),
    path('music/takedown/', MusicTakedownView.as_view(), name='music-takedown'),
    path('radio/', StationsView.as_view(), name='radio'),
    path('radio/<uuid:pk>/', StationView.as_view(), name='radio-station'),
    path('radio/<uuid:pk>/control/', StationControlView.as_view(), name='radio-control'),
    path('radio/<uuid:pk>/listen/', StationListenView.as_view(), name='radio-listen'),
    path('playlists/tracks/upload/', PlaylistTrackUploadView.as_view(), name='playlist-upload-default'),
    path('playlists/<uuid:pk>/tracks/upload/', PlaylistTrackUploadView.as_view(), name='playlist-upload'),
    path('playlists/<uuid:pk>/tracks/', PlaylistTracksView.as_view(), name='playlist-tracks'),
    path('playlists/<uuid:pk>/tracks/<uuid:track>/', PlaylistTracksView.as_view(), name='playlist-track'),
    path('bugreports/', BugReportView.as_view(), name='bugreports'),
    path('push/register/', PushRegisterView.as_view(), name='push-register'),
    path('saved-images/', SavedImagesView.as_view(), name='saved-images'),
    path('sticker-packs/import-telegram/', TelegramStickerImportView.as_view(), name='sticker-import-telegram'),
    path('sticker-packs/import-telegram/<uuid:pk>/', TelegramStickerImportView.as_view(), name='sticker-import-telegram-status'),
    path('music/', MusicView.as_view(), name='music'),
    path('music/<uuid:pk>/', MusicView.as_view(), name='music-item'),
    path('saved-images/<uuid:pk>/', SavedImagesView.as_view(), name='saved-image'),
    path('saved-images/<uuid:pk>/vibe/', SavedImageVibeView.as_view(), name='saved-image-vibe'),
    path('ice-servers/', IceServersView.as_view(), name='ice-servers'),
    # Поиск людей по нику (с «Не показывать меня в поиске»).
    path('people/search/', PeopleSearchView.as_view(), name='people-search'),
    # Ключ трансляции звонка в OBS (chat/obs.py).
    path('obs/key/', ObsKeyView.as_view(), name='obs-key'),
    path('bots/', BotsView.as_view(), name='bots'),
    path('bots/<uuid:pk>/', BotDetailView.as_view(), name='bot-detail'),
    path('bots/<uuid:pk>/start/', BotStartView.as_view(), name='bot-start'),
    path('bots/<uuid:pk>/avatar/', BotAvatarView.as_view(), name='bot-avatar'),
    path('webapp/init/', WebAppInitView.as_view(), name='webapp-init'),
    path('webapp/data/', WebAppDataView.as_view(), name='webapp-data'),
    path('webapps/', WebAppCatalogView.as_view(), name='webapp-catalog'),
    # Страница https://wyx.su/u/<ник> (nginx wyx.conf проксирует /u/ сюда).
    path('wyx/u/<str:username>', wyx_user_page, name='wyx-user-page'),
    path('wyx/u/<str:username>/', wyx_user_page),
    # Каналы, паки, темы и плейлисты на wyx.su: /c/, /stp/, /sp/, /t/, /pl/.
    path('wyx/<str:kind>/<str:ref>', wyx_link_page, name='wyx-link-page'),
    path('wyx/<str:kind>/<str:ref>/', wyx_link_page),
    # Inline-боты (chat/inline.py): запрос → результаты → выбор → заполнение.
    path('bots/inline/query/', InlineQueryView.as_view(), name='inline-query'),
    path('bots/inline/<str:query_id>/answer/', InlineAnswerView.as_view(), name='inline-answer'),
    path('bots/inline/<str:query_id>/choose/', InlineChooseView.as_view(), name='inline-choose'),
    path('bots/inline/messages/<uuid:message_id>/', InlineFillView.as_view(), name='inline-fill'),
    # Каналы
    path('channels/', ChannelsView.as_view(), name='channels'),
    path('channels/discover/', ChannelDiscoverView.as_view(), name='channels-discover'),
    path('channels/from-telegram/', TelegramChannelView.as_view(), name='channels-from-telegram'),
    path('channels/by-handle/<str:handle>/', ChannelByHandleView.as_view(), name='channel-by-handle'),
    path('channels/<uuid:pk>/', ChannelDetailView.as_view(), name='channel-detail'),
    path('channels/<uuid:pk>/subscribe/', ChannelSubscribeView.as_view(), name='channel-subscribe'),
    path('channels/<uuid:pk>/leave/', ChannelLeaveView.as_view(), name='channel-leave'),
    path('channels/<uuid:pk>/mute/', ChannelMuteView.as_view(), name='channel-mute'),
    path('chats/<uuid:pk>/wallpaper/', ChatWallpaperView.as_view(), name='chat-wallpaper'),
    path('chats/<uuid:pk>/translate/', ChatTranslateView.as_view(), name='chat-translate'),
    path('messages/<uuid:pk>/translate/', MessageTranslateView.as_view(), name='message-translate'),
    # Живой перевод (chat/live.py): субтитры звонков и вставленный текст.
    path('live/speech/', LiveSpeechView.as_view(), name='live-speech'),
    path('live/text/', LiveTextView.as_view(), name='live-text'),
    path('channels/<uuid:pk>/admins/', ChannelAdminsView.as_view(), name='channel-admins'),
    path('channels/<uuid:pk>/posts/', ChannelPostsView.as_view(), name='channel-posts'),
    path('channels/<uuid:pk>/posts/check/', ChannelPostsCheckView.as_view(), name='channel-posts-check'),
    path('posts/<uuid:pk>/react/', PostReactView.as_view(), name='post-react'),
    # Опросы в постах Стены (chat/polls.py)
    path('posts/<uuid:pk>/poll/', PollVoteView.as_view(), name='post-poll'),
    path('posts/<uuid:pk>/poll/voters/', PollVotersView.as_view(), name='post-poll-voters'),
    path('posts/<uuid:pk>/comments/', PostCommentsView.as_view(), name='post-comments'),
    path('posts/<uuid:pk>/view/', PostViewMark.as_view(), name='post-view'),
    path('posts/comments/<uuid:pk>/', PostCommentDetailView.as_view(), name='post-comment-detail'),
    path('sounds/', NotificationSoundListView.as_view(), name='notification-sounds'),
    path('actions/', ActionsView.as_view(), name='chat-actions'),
    path('actions/<int:pk>/', ActionDetailView.as_view(), name='chat-action-detail'),
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