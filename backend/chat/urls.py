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

urlpatterns = [
    # Кастомные маршруты ДО роутера
    path('profiles/current/', get_current_user_profile, name='current-profile'),
    path('auth/register/', register_user, name='register'),
    path('auth/login/', login_user, name='login'),
    path('auth/logout/', logout_user, name='logout'),
    path('token/', TokenObtainPairView.as_view(serializer_class=CustomTokenObtainPairSerializer), name='token_obtain_pair'),
    path('token/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('upload/', FileUploadView.as_view(), name='file-upload'),
    # Роутер ПОСЛЕ кастомных маршрутов
    path('', include(router.urls)),
]