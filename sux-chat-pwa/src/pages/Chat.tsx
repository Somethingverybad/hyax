import { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import ChatSidebar from "@/components/chat/ChatSidebar";
import ChatWindow from "@/components/chat/ChatWindow";
import { api, WS_URL } from "@/api/client";
import { useNotifications } from "@/hooks/use-notifications";
import { WebSocketService } from "@/services/websocket";

interface ChatType {
  id: string;
  created_at?: string;
  updated_at?: string;
  last_message?: string;
  unread_count?: number;
  participants?: ProfileType[];
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

  // Функция для получения названия чата из участников
  const getChatTitle = (chat: ChatType): string => {
    if (!chat.participants || chat.participants.length === 0) {
      return `Чат ${chat.id.slice(0, 8)}...`;
    }
    
    // Исключаем текущего пользователя из списка участников
    const otherParticipants = chat.participants.filter(p => p.id !== user?.id);
    const displayParticipants = otherParticipants.length > 0 ? otherParticipants : chat.participants;
    
    if (displayParticipants.length > 0) {
      const names = displayParticipants.map(p => p.username).filter(Boolean);
      return names.join(", ") || "Без названия";
    }
    
    return "Без названия";
  };

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
          created_at: chat.created_at || new Date().toISOString(),
          updated_at: (chat as any).updated_at || chat.created_at || new Date().toISOString(),
        }));
        
        setChats(chatsWithUnread);
        previousChatsRef.current = chatsWithUnread;
        
        // Регистрируем Background Sync и Periodic Background Sync для работы в фоне
        if ('serviceWorker' in navigator && 'sync' in window.ServiceWorkerRegistration.prototype) {
          try {
            const registration = await navigator.serviceWorker.ready;
            
            // Background Sync для синхронизации сообщений при возврате онлайн
            // Это позволяет синхронизировать сообщения даже когда браузер был закрыт
            if ('sync' in registration) {
              try {
                await (registration as any).sync.register('sync-messages');
                console.log('[Chat] Background Sync зарегистрирован');
              } catch (syncError) {
                console.warn('[Chat] Background Sync не поддерживается:', syncError);
              }
            }
            
            // Periodic Background Sync для периодической проверки новых сообщений
            // Это позволяет проверять сообщения даже когда браузер закрыт
            if ('periodicSync' in registration) {
              try {
                const status = await (navigator as any).permissions.query({ name: 'periodic-background-sync' as PermissionName });
                if (status.state === 'granted') {
                  await (registration as any).periodicSync.register('check-messages', {
                    minInterval: 1 * 60 * 1000, // 1 минута - минимальный интервал для частой проверки
                  });
                  console.log('[Chat] Periodic Background Sync зарегистрирован (интервал: 1 минута)');
                } else {
                  console.log('[Chat] Periodic Background Sync не разрешен, запрашиваем разрешение...');
                  // Пытаемся запросить разрешение
                  try {
                    await (navigator as any).permissions.request({ name: 'periodic-background-sync' as PermissionName });
                    const newStatus = await (navigator as any).permissions.query({ name: 'periodic-background-sync' as PermissionName });
                    if (newStatus.state === 'granted') {
                      await (registration as any).periodicSync.register('check-messages', {
                        minInterval: 1 * 60 * 1000,
                      });
                      console.log('[Chat] Periodic Background Sync разрешен и зарегистрирован');
                    }
                  } catch (requestError) {
                    console.warn('[Chat] Не удалось запросить разрешение на Periodic Background Sync:', requestError);
                  }
                }
              } catch (periodicError) {
                console.warn('[Chat] Periodic Background Sync не поддерживается:', periodicError);
              }
            }
          } catch (swError) {
            console.warn('[Chat] Ошибка регистрации Background Sync:', swError);
          }
        }
        
        // Не запрашиваем разрешение автоматически - пользователь может запросить его через кнопку в сайдбаре
      } catch (error) {
        navigate("/auth");
      }
    };
    
    initializeApp();
  }, [navigate]);

  // WebSocket соединение для получения уведомлений о новых сообщениях
  const wsServiceRef = useRef<WebSocketService | null>(null);
  
  useEffect(() => {
    if (!user) return;

    // Подключаемся к WebSocket для получения уведомлений
    const token = localStorage.getItem("access_token");
    
    try {
      // Если WebSocket уже существует, переподключаем его
      if (wsServiceRef.current) {
        wsServiceRef.current.disconnect();
      }
      
      wsServiceRef.current = new WebSocketService(`${WS_URL}/user/${user.id}/`, {
        onMessage: (data) => {
          if (data.type === 'notification' && data.data) {
            // Показываем уведомление если нужно
            if (data.data.type === 'new_message' && hasPermission()) {
              const chatId = data.data.chat_id;
              const messageContent = data.data.content || 'Новое сообщение';
              const senderName = data.data.sender?.username || 'Кто-то';
              
              console.log('[Chat] WebSocket: новое сообщение', { chatId, senderName, hasPermission: hasPermission() });
              
              setChats(currentChats => {
                const chat = currentChats.find(c => c.id === chatId);
                const isAppVisible = document.visibilityState === 'visible';
                const isCurrentChat = chatId === selectedChatId;
                
                // Показываем уведомление если:
                // 1. Чат не выбран (даже если приложение в фокусе)
                // 2. ИЛИ приложение не в фокусе
                // 3. И прошло достаточно времени с последнего уведомления (анти-спам)
                const notificationNow = Date.now();
                const timeSinceLastNotification = notificationNow - lastNotificationTimeRef.current;
                const shouldNotify = (!isCurrentChat || !isAppVisible) && 
                                     (timeSinceLastNotification > 3000);
                
                console.log('[Chat] WebSocket: проверка уведомления', {
                  chat: chat ? 'найден' : 'не найден',
                  isAppVisible,
                  isCurrentChat,
                  shouldNotify,
                  timeSinceLastNotification,
                  hasPermission: hasPermission()
                });
                
                if (chat && shouldNotify) {
                  const chatTitle = getChatTitle(chat);
                  const notificationTitle = chatTitle;
                  const notificationBody = `${senderName}: ${messageContent.length > 50 ? messageContent.substring(0, 50) + '...' : messageContent}`;
                  
                  console.log('[Chat] WebSocket: показываем уведомление', { title: notificationTitle, body: notificationBody });
                  
                  showNotification({
                    title: notificationTitle,
                    body: notificationBody,
                    data: { chatId },
                    tag: `chat-${chatId}`,
                    icon: chat.participants?.[0]?.avatar_url || '/favicon.ico',
                  }).catch(error => {
                    console.error('[Chat] Ошибка при показе уведомления:', error);
                  });
                  lastNotificationTimeRef.current = notificationNow;
                } else if (chat && !shouldNotify) {
                  console.log('[Chat] WebSocket: уведомление не показано', {
                    reason: !chat ? 'чат не найден' : 
                           isAppVisible && isCurrentChat ? 'приложение в фокусе и чат выбран' :
                           timeSinceLastNotification <= 3000 ? 'слишком рано после последнего' : 'неизвестная причина'
                  });
                }
                
                // Обновляем unread_count для чата без полного refreshChats
                return currentChats.map(c => 
                  c.id === chatId 
                    ? { ...c, unread_count: (c.unread_count || 0) + 1 }
                    : c
                );
              });
            }
          }
        },
        onError: (error) => {
          console.error('WebSocket error:', error);
        },
        onOpen: () => {
          console.log('WebSocket connected for user notifications');
        },
        onClose: () => {
          console.log('WebSocket disconnected for user notifications');
        },
      });

      wsServiceRef.current.connect(token || undefined);
    } catch (error) {
      console.error('Failed to create WebSocket connection:', error);
    }

    // Периодическое обновление как подстраховка для iOS (когда приложение в фоне)
    // На iOS WebSocket разрывается в фоне, поэтому используем polling
    // Увеличено до 30 секунд для более частой проверки
    const intervalId = setInterval(() => {
      // Проверяем, подключен ли WebSocket
      if (!wsServiceRef.current || !wsServiceRef.current.isConnected()) {
        console.log('[Chat] WebSocket не подключен, используем polling fallback');
        refreshChats();
      }
    }, 30000); // Обновляем каждые 30 секунд для более частой проверки

    return () => {
      if (wsServiceRef.current) {
        wsServiceRef.current.disconnect();
        wsServiceRef.current = null;
      }
      clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, selectedChatId]); // Убираем refreshChats и другие функции из зависимостей

  // Обработчик состояния приложения (visibility change для PWA)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // При возвращении видимости обновляем данные и переподключаем WebSocket
        console.log('[Chat] Приложение вернулось в фокус');
        const now = Date.now();
        const lastRefresh = (window as any).__lastChatsRefresh || 0;
        
        // Обновляем данные
        if (now - lastRefresh > 10000) { // Минимум 10 секунд между обновлениями
          refreshChats();
          (window as any).__lastChatsRefresh = now;
        }
        
        // Переподключаем WebSocket (особенно важно для iOS)
        if (user && wsServiceRef.current) {
          const token = localStorage.getItem("access_token");
          if (!wsServiceRef.current.isConnected()) {
            console.log('[Chat] Переподключение WebSocket после возврата из фона');
            wsServiceRef.current.connect(token || undefined);
          }
        }
      } else {
        // Когда приложение уходит в фон
        console.log('[Chat] Приложение ушло в фон');
        // На iOS WebSocket разрывается в фоне, но это нормально
        // Уведомления будут приходить через polling fallback
      }
    };

    // Обработчик клика по уведомлению
    const handleNotificationClick = (event: CustomEvent) => {
      if (event.detail && event.detail.chatId) {
        setSelectedChatId(event.detail.chatId);
        window.focus();
      }
    };

    // Обработчик сообщений от Service Worker
    const handleServiceWorkerMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'CHECK_MESSAGES_REQUEST') {
        // Service Worker запрашивает проверку сообщений
        // Выполняем обновление чатов
        refreshChats();
      } else if (event.data && event.data.type === 'NEW_MESSAGES') {
        // Service Worker сообщает о новых сообщениях
        console.log('[Chat] Новые сообщения от Service Worker');
        refreshChats();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('notificationclick', handleNotificationClick as EventListener);
    
    // Слушаем сообщения от Service Worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('notificationclick', handleNotificationClick as EventListener);
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', handleServiceWorkerMessage);
      }
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
        console.log('[Chat] refreshChats: проверка уведомлений', {
          previousChatsCount: previousChats.length,
          currentChatsCount: chatsWithUnread.length,
          hasPermission: hasPermission(),
          isSupported: isSupported()
        });
        
        // Используем Promise.all вместо forEach для правильной обработки async
        const notificationPromises = chatsWithUnread.map(async (chat) => {
          const previousChat = previousChats.find((c) => c.id === chat.id);
          const previousUnread = previousChat?.unread_count || 0;
          const currentUnread = chat.unread_count || 0;
          
          // Если количество непрочитанных увеличилось
          if (currentUnread > previousUnread) {
            // Показываем уведомление только если чат не выбран или приложение не в фокусе
            const isAppInFocus = document.visibilityState === 'visible';
            const isCurrentChat = selectedChatId === chat.id;
            
            // На iOS показываем уведомления даже если приложение в фокусе, но чат не выбран
            // Это важно, так как WebSocket может не работать в фоне
            const shouldNotify = !isCurrentChat || !isAppInFocus;
            
            console.log('[Chat] refreshChats: проверка чата', {
              chatId: chat.id,
              previousUnread,
              currentUnread,
              isAppInFocus,
              isCurrentChat,
              shouldNotify
            });
            
            if (shouldNotify) {
              // Получаем название чата
              const chatTitle = getChatTitle(chat);
              const newMessagesCount = currentUnread - previousUnread;
              
              // Получаем информацию о последнем сообщении для отображения в уведомлении
              // Пытаемся получить последнее сообщение из чата (если доступно)
              let lastMessagePreview = '';
              try {
                const messages = await api.getMessages(chat.id);
                if (messages && messages.length > 0) {
                  const lastMessage = messages[messages.length - 1];
                  const lastSenderName = lastMessage.sender?.username || 'Кто-то';
                  const lastMessageContent = lastMessage.content || (lastMessage.file_name ? `📎 ${lastMessage.file_name}` : 'Новое сообщение');
                  lastMessagePreview = `${lastSenderName}: ${lastMessageContent.length > 40 ? lastMessageContent.substring(0, 40) + '...' : lastMessageContent}`;
                }
              } catch (error) {
                console.warn('[Chat] Не удалось получить последнее сообщение для уведомления:', error);
                lastMessagePreview = 'Новое сообщение';
              }
              
              // Показываем уведомление только если прошло достаточно времени (избегаем спама)
              const notificationNow = Date.now();
              const timeSinceLastNotification = notificationNow - lastNotificationTimeRef.current;
              if (timeSinceLastNotification > 3000) { // Минимум 3 секунды между уведомлениями
                console.log('[Chat] refreshChats: показываем уведомление', {
                  chatId: chat.id,
                  title: chatTitle,
                  newMessagesCount,
                  timeSinceLastNotification
                });
                
                try {
                  await showNotification({
                    title: chatTitle,
                    body: newMessagesCount > 1 
                      ? `${newMessagesCount} новых сообщений${lastMessagePreview ? `\n${lastMessagePreview}` : ''}`
                      : lastMessagePreview || 'Новое сообщение',
                    data: {
                      chatId: chat.id,
                      url: `/chat`,
                    },
                    tag: `chat-${chat.id}`,
                    requireInteraction: false,
                  });
                  lastNotificationTimeRef.current = notificationNow;
                  console.log('[Chat] refreshChats: уведомление показано успешно');
                } catch (error) {
                  console.error('[Chat] refreshChats: ошибка при показе уведомления:', error);
                }
              } else {
                console.log('[Chat] refreshChats: уведомление пропущено (слишком рано)', {
                  timeSinceLastNotification,
                  required: 3000
                });
              }
            }
          }
        });
        
        // Ждем выполнения всех проверок уведомлений
        await Promise.all(notificationPromises);
      } else {
        console.log('[Chat] refreshChats: уведомления пропущены', {
          previousChatsCount: previousChats.length,
          isSupported: isSupported(),
          hasPermission: hasPermission()
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
      const currentPermission = Notification.permission;
      console.log('[Chat] Текущее разрешение на уведомления:', currentPermission);
      setNotificationPermission(currentPermission);
      
      // Слушаем изменения разрешения (если пользователь изменил в настройках браузера)
      const checkPermission = () => {
        const newPermission = Notification.permission;
        if (newPermission !== notificationPermission) {
          console.log('[Chat] Разрешение изменилось:', newPermission);
          setNotificationPermission(newPermission);
        }
      };
      
      // Проверяем периодически (раз в 5 секунд) для отслеживания изменений
      const intervalId = setInterval(checkPermission, 5000);
      
      return () => clearInterval(intervalId);
    }
  }, [notificationPermission]);

  // Функция для тестового уведомления
  const handleTestNotification = async () => {
    console.log('[Chat] Тестовое уведомление запрошено');
    console.log('[Chat] Разрешение:', Notification.permission);
    console.log('[Chat] hasPermission():', hasPermission());
    
    try {
      await showNotification({
        title: '🔔 Тестовое уведомление',
        body: 'Если вы видите это уведомление, значит система работает!',
        icon: '/favicon.ico',
        badge: '/favicon.ico',
        tag: 'test-notification',
        data: { test: true },
        requireInteraction: false,
      });
      console.log('[Chat] ✅ Уведомление показано');
    } catch (error) {
      console.error('[Chat] ❌ Ошибка при показе уведомления:', error);
      alert(`Ошибка: ${error instanceof Error ? error.message : 'Неизвестная ошибка'}`);
    }
  };

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
          return granted;
        }}
        notificationPermission={notificationPermission}
        onTestNotification={handleTestNotification}
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
