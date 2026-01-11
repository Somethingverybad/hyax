import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import ChatSidebar from "@/components/chat/ChatSidebar";
import ChatWindow from "@/components/chat/ChatWindow";
import { api } from "@/api/client";
import { PushNotifications, Token, ActionPerformed, PushNotificationSchema } from '@capacitor/push-notifications';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';

interface ChatType {
  id: string;
  created_at: string;
  updated_at: string;
  last_message?: string;
  unread_count?: number;
}

interface ProfileType {
  id: string;
  username: string;
  avatar_url?: string;
  status?: string;
}

const Chat = () => {
  const [user, setUser] = useState<ProfileType | null>(null);
  const [chats, setChats] = useState<ChatType[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const navigate = useNavigate();

  // 🔔 Проверка аутентификации и получение профиля + инициализация уведомлений
  useEffect(() => {
    const initializeApp = async () => {
      try {
        const profile = await api.getProfile();
        setUser(profile);
        const userChats = await api.getChats();
        setChats(userChats);
        
        // 🔔 Инициализация push-уведомлений после успешной аутентификации
        if (Capacitor.isNativePlatform()) {
          await initPushNotifications(profile.id);
        }
      } catch (error) {
        navigate("/auth");
      }
    };
    
    initializeApp();
  }, [navigate]);

  // 🔔 Функция инициализации push-уведомлений
  const initPushNotifications = async (userId: string) => {
    try {
      console.log('Initializing push notifications...');
      
      // Запрашиваем разрешение на iOS
      let permission = await PushNotifications.requestPermissions();
      
      if (permission.receive === 'granted') {
        console.log('Push permission granted');
        
        // Регистрируем для получения push-токена
        await PushNotifications.register();
        
        // Настройка обработчиков
        setupPushHandlers(userId);
        
        console.log('Push notifications initialized successfully');
      } else {
        console.log('Push notifications permission denied');
      }
    } catch (error) {
      console.error('Error initializing push notifications:', error);
    }
  };

  // 🔔 Настройка обработчиков push-уведомлений
  const setupPushHandlers = (userId: string) => {
    // Срабатывает когда приложение получает push-токен
    PushNotifications.addListener('registration', (token: Token) => {
      console.log('Push registration success, token:', token.value);
      
      // Отправляем токен на ваш сервер
      sendPushTokenToServer(userId, token.value);
    });

    // Срабатывает при ошибке регистрации
    PushNotifications.addListener('registrationError', (error: any) => {
      console.error('Push registration error:', error);
    });

    // 🔔 Срабатывает когда приложение получает уведомление в FOREGROUND
    // ❌ УБРАНО: Не показываем toast, только логируем
    PushNotifications.addListener('pushNotificationReceived', (notification: PushNotificationSchema) => {
      console.log('Push received in foreground:', notification);
      
      // Обновляем список чатов при получении уведомления
      handleNewMessageNotification(notification);
    });

    // 🔔 Срабатывает когда пользователь ТАПАЕТ по уведомлению (приложение в BACKGROUND/CLOSED)
    PushNotifications.addListener('pushNotificationActionPerformed', (action: ActionPerformed) => {
      console.log('Push action performed (user tapped notification):', action);
      
      const data = action.notification.data;
      
      // Обрабатываем переход к конкретному чату при тапе на уведомление
      if (data?.chatId) {
        handleNotificationTap(data.chatId);
      }
    });
  };

  // 🔔 Функция отправки push-токена на сервер
  const sendPushTokenToServer = async (userId: string, token: string) => {
    try {
      await api.registerPushToken({
        userId: userId,
        token: token,
        platform: Capacitor.getPlatform(),
        deviceId: `device_${userId}_${Date.now()}`
      });
      
      console.log('Push token successfully sent to server');
      
    } catch (error) {
      console.error('Error sending push token to server:', error);
    }
  };

  // 🔔 Обработка нового сообщения из push-уведомления
  const handleNewMessageNotification = (notification: PushNotificationSchema) => {
    const { data } = notification;
    
    // ❌ УБРАНО: Не показываем toast уведомления
    
    // Всегда обновляем список чатов при новом сообщении
    refreshChats();
  };

  // 🔔 Обработка тапа по уведомлению
  const handleNotificationTap = (chatId: string) => {
    console.log('Opening chat from notification:', chatId);
    
    // Сворачиваем сайдбар и выбираем чат
    setIsSidebarCollapsed(true);
    setSelectedChatId(chatId);
    
    // Обновляем данные чата
    refreshChats();
  };

  // 🔔 Автообновление списка чатов
  useEffect(() => {
    if (!user) return;

    // Сразу загружаем чаты при загрузке компонента
    refreshChats();

    // Устанавливаем интервал для автообновления чатов
    const intervalId = setInterval(() => {
      refreshChats();
    }, 5000); // Обновляем каждые 5 секунд

    return () => {
      clearInterval(intervalId);
    };
  }, [user]);

  // 🔔 Обработчик состояния приложения (foreground/background)
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    // Слушаем переход приложения в foreground
    const appStateListener = App.addListener('appStateChange', ({ isActive }) => {
      console.log('App state changed, isActive:', isActive);
      
      if (isActive) {
        // При возвращении в приложение обновляем данные
        refreshChats();
      }
    });

    return () => {
      appStateListener.remove();
    };
  }, []);

  // 🔔 Функция обновления списка чатов
  const refreshChats = async () => {
    if (!user) return;
    
    try {
      const userChats = await api.getChats();
      
      // Обновляем состояние только если данные изменились
      if (JSON.stringify(userChats) !== JSON.stringify(chats)) {
        setChats(userChats);
        
        // Логируем обновление для отладки
        console.log('Chats updated:', userChats.length, 'chats');
      }
    } catch (error) {
      console.error('Error refreshing chats:', error);
    }
  };

  const handleLogout = async () => {
    try {
      // 🔔 Удаляем listeners при выходе
      if (Capacitor.isNativePlatform()) {
        PushNotifications.removeAllListeners();
      }
      
      await api.logout();
      navigate("/auth");
    } catch {
      console.error("Ошибка при выходе");
    }
  };

  const toggleSidebar = () => {
    setIsSidebarCollapsed(!isSidebarCollapsed);
  };

  // Обработчик удаления чата
  const handleChatDeleted = (deletedChatId: string) => {
    setChats(prev => prev.filter(chat => chat.id !== deletedChatId));
    if (selectedChatId === deletedChatId) {
      setSelectedChatId(null);
    }
  };

  // Обработчик создания чата - перезагружаем список
  const handleChatCreated = async () => {
    try {
      await refreshChats();
    } catch (error) {
      console.error("Error refreshing chats after creation:", error);
    }
  };

  if (!user) return null;

  return (
    <div className="h-screen flex bg-background">
      <ChatSidebar
        userId={user.id}
        chats={chats}
        onSelectChat={setSelectedChatId}
        selectedChatId={selectedChatId}
        onLogout={handleLogout}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={toggleSidebar}
        onChatDeleted={handleChatDeleted}
        onChatCreated={handleChatCreated}
      />
      
      {/* Показываем ChatWindow только когда сайдбар свернут И выбран чат */}
      {isSidebarCollapsed && selectedChatId && (
        <ChatWindow
          chatId={selectedChatId}
          userId={user.id}
        />
      )}
      
      {/* Сообщение когда сайдбар развернут */}
      {!isSidebarCollapsed}
      
      {/* Сообщение когда сайдбар свернут но чат не выбран */}
      {isSidebarCollapsed && !selectedChatId && (
        <div className="flex-1 flex items-center justify-center bg-gradient-to-br from-background to-primary/5">
          <div className="text-center p-8">
            <div className="w-24 h-24 bg-gradient-primary rounded-3xl mx-auto mb-6 flex items-center justify-center shadow-glow">
              <span className="text-4xl font-black text-primary-foreground">Х</span>
            </div>
            <h2 className="text-2xl font-bold text-foreground mb-4">
              Выберите чат
            </h2>
            <p className="text-muted-foreground max-w-md">
              Нажмите на иконку меню в свернутом сайдбаре чтобы развернуть список чатов и выбрать чат для общения.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default Chat;