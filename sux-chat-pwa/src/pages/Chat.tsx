import { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import ChatSidebar from "@/components/chat/ChatSidebar";
import ChatWindow from "@/components/chat/ChatWindow";
import { api, WS_URL } from "@/api/client";
import { useNotifications } from "@/hooks/use-notifications";
import { WebSocketService } from "@/services/websocket";

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
  const { requestPermission, showNotification, hasPermission, isSupported, permission } = useNotifications();
  const previousChatsRef = useRef<ChatType[]>([]);
  const lastNotificationTimeRef = useRef<number>(0);

  // Проверка аутентификации и получение профиля
  useEffect(() => {
    const initializeApp = async () => {
      try {
        const profile = await api.getProfile();
        setUser(profile);
        
        // Загружаем чаты один раз при инициализации
        const userChats = await api.getChats();
        
        // Получаем количество непрочитанных для каждого чата
        let unreadByChat: Record<string, number> = {};
        try {
          const unreadData = await api.getUnreadCount();
          unreadByChat = unreadData.unread_by_chat || {};
        } catch (error) {
          console.error('Error getting unread count:', error);
        }

        // Добавляем unread_count к чатам
        const chatsWithUnread = userChats.map((chat) => ({
          ...chat,
          unread_count: unreadByChat[chat.id] || 0,
        }));
        
        setChats(chatsWithUnread);
        previousChatsRef.current = chatsWithUnread;
        
        // Не запрашиваем разрешение автоматически - пользователь может запросить его через кнопку в сайдбаре
      } catch (error) {
        navigate("/auth");
      }
    };
    
    initializeApp();
  }, [navigate]);

  // WebSocket соединение для получения уведомлений о новых сообщениях
  useEffect(() => {
    if (!user) return;

    console.log('[WebSocket] Подключаемся к WebSocket для уведомлений пользователя');
    const token = localStorage.getItem("access_token");
    
    const wsService = new WebSocketService(`${WS_URL}/user/${user.id}/`, {
      onMessage: (data) => {
        console.log('[WebSocket] Получено сообщение:', data);
        
        // Обрабатываем уведомления о новых сообщениях
        if (data.type === 'notification' || data.type === 'new_message') {
          const chatId = data.data?.chat_id || data.data?.chatId || data.chat_id || data.chatId || data.message?.chat;
          const message = data.message || data.data?.message;
          const senderUsername = message?.sender?.username || message?.sender_username;
          const messageContent = message?.content || data.data?.content;
          
          if (chatId && hasPermission()) {
            const shouldShow = chatId !== selectedChatId;
            const isAppInFocus = document.visibilityState === 'visible';
            
            if (shouldShow || !isAppInFocus) {
              // Обновляем unread_count
              setChats(prevChats => {
                const updatedChats = prevChats.map(c => 
                  c.id === chatId 
                    ? { ...c, unread_count: (c.unread_count || 0) + 1 }
                    : c
                );
                
                // Показываем уведомление через Service Worker для фоновых уведомлений
                if ('serviceWorker' in navigator && document.visibilityState !== 'visible') {
                  navigator.serviceWorker.ready.then(registration => {
                    registration.showNotification(
                      senderUsername ? `💬 ${senderUsername}` : '💬 Новое сообщение',
                      {
                        body: messageContent?.substring(0, 100) || 'Новое сообщение',
                        icon: '/favicon.ico',
                        badge: '/favicon.ico',
                        tag: `chat-${chatId}`,
                        data: {
                          chatId: chatId,
                          url: `/chat`,
                        },
                        requireInteraction: false,
                        vibrate: [200, 100, 200],
                      }
                    );
                  }).catch(err => {
                    console.error('[Notifications] Ошибка показа через SW, используем fallback:', err);
                    showNotification({
                      title: senderUsername ? `💬 ${senderUsername}` : '💬 Новое сообщение',
                      body: messageContent?.substring(0, 100) || 'Новое сообщение',
                      data: { chatId },
                      tag: `chat-${chatId}-${Date.now()}`,
                      requireInteraction: false,
                    }).catch(error => {
                      console.error('[WebSocket] Ошибка при показе уведомления:', error);
                    });
                  });
                } else {
                  showNotification({
                    title: senderUsername ? `💬 ${senderUsername}` : '💬 Новое сообщение',
                    body: messageContent?.substring(0, 100) || 'Новое сообщение',
                    data: { chatId },
                    tag: `chat-${chatId}-${Date.now()}`,
                    requireInteraction: false,
                  }).catch(error => {
                    console.error('[WebSocket] Ошибка при показе уведомления:', error);
                  });
                }
                
                return updatedChats;
              });
            }
          }
        }
      },
      onError: (error) => {
        console.error('[WebSocket] ❌ Ошибка:', error);
      },
      onOpen: () => {
        console.log('[WebSocket] ✅ ПОДКЛЮЧЕНО для уведомлений пользователя:', user.id);
      },
      onClose: () => {
        console.warn('[WebSocket] ⚠️ ОТКЛЮЧЕНО для уведомлений пользователя');
      },
    });

    wsService.connect(token || undefined);
    
    // Обработчик для переподключения при возвращении в приложение
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && wsService) {
        // Проверяем, что WebSocket подключен
        const ws = (wsService as any).ws;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          console.log('[WebSocket] Переподключаемся после возвращения в приложение');
          wsService.connect(token || undefined);
        }
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      wsService.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, selectedChatId]);

  // Регистрация Background Sync для периодической проверки сообщений
  useEffect(() => {
    if (!user) return;
    
    // Регистрируем Background Sync для периодической проверки сообщений
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(registration => {
        // Регистрируем периодическую синхронизацию (если поддерживается)
        if ('sync' in registration) {
          registration.sync.register('check-messages').then(() => {
            console.log('[Background Sync] ✅ Зарегистрирован для проверки сообщений');
          }).catch(err => {
            console.warn('[Background Sync] Ошибка регистрации:', err);
          });
        }
        
        // Регистрируем Periodic Background Sync (если поддерживается)
        // @ts-ignore - Periodic Background Sync может быть не в типах
        if ('periodicSync' in registration) {
          // @ts-ignore
          registration.periodicSync.register('check-messages-periodic', {
            minInterval: 60000, // Минимум 1 минута между проверками
          }).then(() => {
            console.log('[Periodic Background Sync] ✅ Зарегистрирован');
          }).catch((err: any) => {
            console.warn('[Periodic Background Sync] Ошибка регистрации:', err);
          });
        }
      }).catch(err => {
        console.warn('[Background Sync] Service Worker не готов:', err);
      });
    }
    
    // Обработчик сообщений от Service Worker
    const handleServiceWorkerMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'CHECK_MESSAGES') {
        console.log('[Background Sync] Получен запрос на проверку сообщений');
        refreshChats();
      }
    };
    
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);
    }
    
    return () => {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', handleServiceWorkerMessage);
      }
    };
  }, [user, refreshChats]);

  // Обработчик состояния приложения (visibility change для PWA)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // При возвращении видимости обновляем данные (но не слишком часто)
        const now = Date.now();
        const lastRefresh = (window as any).__lastChatsRefresh || 0;
        // Обновляем только если прошло больше 60 секунд с последнего обновления
        if (now - lastRefresh > 60000) {
          refreshChats();
          (window as any).__lastChatsRefresh = now;
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Убираем refreshChats из зависимостей

  // Функция обновления списка чатов (мемоизирована)
  const refreshChats = useCallback(async () => {
    if (!user) return;
    
    // Защита от слишком частых вызовов
    const now = Date.now();
    const lastRefresh = (refreshChats as any).__lastRefresh || 0;
    if (now - lastRefresh < 5000) { // Минимум 5 секунд между вызовами
      console.log('Skipping refreshChats - too soon since last refresh');
      return;
    }
    (refreshChats as any).__lastRefresh = now;
    
    try {
      const userChats = await api.getChats();
      const previousChats = previousChatsRef.current;
      
      // Получаем количество непрочитанных для каждого чата
      let unreadByChat: Record<string, number> = {};
      try {
        const unreadData = await api.getUnreadCount();
        unreadByChat = unreadData.unread_by_chat || {};
      } catch (error) {
        console.error('Error getting unread count:', error);
      }

      // Добавляем unread_count к чатам
      const chatsWithUnread = userChats.map((chat) => ({
        ...chat,
        unread_count: unreadByChat[chat.id] || 0,
      }));

      // Проверяем наличие новых сообщений для уведомлений
      if (previousChats.length > 0 && isSupported() && hasPermission()) {
        chatsWithUnread.forEach(async (chat) => {
          const previousChat = previousChats.find((c) => c.id === chat.id);
          const previousUnread = previousChat?.unread_count || 0;
          const currentUnread = chat.unread_count || 0;
          
          // Если количество непрочитанных увеличилось
          if (currentUnread > previousUnread) {
            // Показываем уведомление только если чат не выбран или приложение не в фокусе
            const isAppInFocus = document.visibilityState === 'visible';
            const isCurrentChat = selectedChatId === chat.id;
            
            if (!isAppInFocus || !isCurrentChat) {
              // Получаем название чата (будет улучшено позже)
              const chatTitle = `Чат ${chat.id.slice(0, 8)}...`;
              const newMessagesCount = currentUnread - previousUnread;
              
              // Показываем уведомление только если прошло достаточно времени (избегаем спама)
              const notificationNow = Date.now();
              if (notificationNow - lastNotificationTimeRef.current > 3000) { // Минимум 3 секунды между уведомлениями
                await showNotification({
                  title: `Новое сообщение${newMessagesCount > 1 ? ` (${newMessagesCount})` : ''}`,
                  body: chatTitle,
                  data: {
                    chatId: chat.id,
                    url: `/chat`,
                  },
                  tag: `chat-${chat.id}`,
                  requireInteraction: false,
                });
                lastNotificationTimeRef.current = notificationNow;
              }
            }
          }
        });
      }

      previousChatsRef.current = chatsWithUnread;
      
      // Обновляем состояние только если данные изменились
      setChats(prevChats => {
        if (JSON.stringify(chatsWithUnread) !== JSON.stringify(prevChats)) {
          console.log('Chats updated:', chatsWithUnread.length, 'chats');
          return chatsWithUnread;
        }
        return prevChats;
      });
    } catch (error) {
      console.error('Error refreshing chats:', error);
    }
  }, [user, selectedChatId, hasPermission, isSupported, showNotification]);

  const handleLogout = async () => {
    try {
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

  // Проверяем статус разрешения на уведомления
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>('default');
  
  useEffect(() => {
    if ('Notification' in window) {
      setNotificationPermission(Notification.permission);
      
      // Слушаем изменения разрешения (если пользователь изменил в настройках браузера)
      const checkPermission = () => {
        setNotificationPermission(Notification.permission);
      };
      
      // Проверяем периодически (раз в 5 секунд) для отслеживания изменений
      const intervalId = setInterval(checkPermission, 5000);
      
      return () => clearInterval(intervalId);
    }
  }, []);

  if (!user) return null;

  return (
    <div className="h-screen flex bg-background">
      {/* Баннер для запроса разрешения на уведомления (только если разрешение не получено) */}
      {isSupported() && notificationPermission !== 'granted' && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-primary text-primary-foreground p-3 shadow-lg">
          <div className="container mx-auto flex items-center justify-between gap-4">
            <div className="flex-1">
              <p className="text-sm font-medium">
                {notificationPermission === 'default' 
                  ? 'Включите уведомления, чтобы не пропустить новые сообщения'
                  : 'Уведомления заблокированы. Разрешите их в настройках браузера'}
              </p>
            </div>
            {notificationPermission === 'default' && (
              <button
                onClick={async () => {
                  const granted = await requestPermission();
                  if (granted) {
                    setNotificationPermission('granted');
                  }
                }}
                className="px-4 py-2 bg-background text-foreground rounded-md text-sm font-medium hover:bg-background/80 transition-colors"
              >
                Включить
              </button>
            )}
            <button
              onClick={() => setNotificationPermission(Notification.permission)}
              className="text-sm opacity-80 hover:opacity-100"
            >
              ✕
            </button>
          </div>
        </div>
      )}
      
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
        onRequestNotificationPermission={async () => {
          const granted = await requestPermission();
          if (granted) {
            setNotificationPermission('granted');
          } else {
            setNotificationPermission(Notification.permission);
          }
        }}
        notificationPermission={notificationPermission}
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
