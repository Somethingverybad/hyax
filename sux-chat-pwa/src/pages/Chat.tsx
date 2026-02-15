import { useEffect, useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import ChatSidebar from "@/components/chat/ChatSidebar";
import ChatWindow from "@/components/chat/ChatWindow";
import { api, WS_URL } from "@/api/client";
import { useNotifications } from "@/hooks/use-notifications";
import { WebSocketService } from "@/services/websocket";
import { OneToOneCallService, type IncomingCall } from "@/services/call-service";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Bell, BellOff, Phone, PhoneOff, PhoneIncoming } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

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
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const setIncomingCallRef = useRef(setIncomingCall);
  setIncomingCallRef.current = setIncomingCall;
  const clearIncomingCall = useCallback(() => {
    setIncomingCallRef.current(null);
  }, []);
  const ringtoneRef = useRef<HTMLAudioElement | null>(null);
  const navigate = useNavigate();
  const { requestPermission, showNotification, hasPermission, isSupported, permission } = useNotifications();
  const previousChatsRef = useRef<ChatType[]>([]);
  const lastNotificationTimeRef = useRef<number>(0);
  const selectedChatIdRef = useRef<string | null>(null);
  selectedChatIdRef.current = selectedChatId;

  // Глобальный WebSocket и Call Service для звонков
  const userWsServiceRef = useRef<WebSocketService | null>(null);
  const globalCallServiceRef = useRef<OneToOneCallService | null>(null);

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
        console.log('🚀 Инициализация приложения - получение профиля');
        const profile = await api.getProfile();
        console.log('👤 Профиль получен:', profile);
        console.log('👤 ID пользователя:', profile?.id, 'Тип:', typeof profile?.id);
        
        if (!profile || !profile.id) {
          console.error('❌ Профиль не содержит ID!', profile);
          toast.error("Ошибка: не удалось получить ID пользователя");
          navigate('/auth');
          return;
        }
        
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
    if (!user || !user.id) return;

    // Подключаемся к WebSocket для получения уведомлений И звонков
    const token = localStorage.getItem("access_token");
    
    console.log(`📞 [Chat] Инициализация глобального WebSocket для пользователя ${user.id}`);
    
    try {
      // Если WebSocket уже существует, переподключаем его
      if (wsServiceRef.current) {
        wsServiceRef.current.disconnect();
      }
      
      // Создаем персональный WebSocket канал
      userWsServiceRef.current = new WebSocketService(`${WS_URL}/user/${user.id}/`, {
        onMessage: (data) => {
          // Обработка входящих звонков через глобальный Call Service
          if (data.type === 'notification' && data.data?.type === 'incoming_call') {
            console.log('📞 [Chat] Получено уведомление о входящем звонке:', data.data);
            
            // Передаем в Call Service через callback
            globalCallServiceRef.current?.notifyIncomingCall({
              callId: data.data.call_id,
              chatId: data.data.chat_id || "",
              fromUserId: data.data.from_user_id,
              fromUsername: data.data.from_username || "Неизвестный",
              fromUserAvatar: data.data.from_user_avatar,
              callType: data.data.call_type || "audio",
            });
            return;
          }
          
          // Обработка call_signal для звонков
          if (data.type === 'call_signal' && data.signal_type) {
            console.log('📞 [Chat] Получен call_signal:', data.signal_type, data.data);
            // Передаем в глобальный Call Service
            void globalCallServiceRef.current?.handleSignal(data.signal_type, data.data || {});
            return;
          }
          
          if (data.type === 'notification' && data.data) {
            // Показываем уведомление если нужно
            if (data.data.type === 'new_message' && hasPermission()) {
              const chatId = data.data.chat_id;
              const message = data.data.message || {};
              const messageContent = message.content || 'Новое сообщение';
              const senderName = message.sender?.username || 'Кто-то';
              
              console.log('[Chat] WebSocket: новое сообщение', { chatId, senderName, message, hasPermission: hasPermission() });
              
              setChats(currentChats => {
                const chat = currentChats.find(c => c.id === chatId);
                const isAppVisible = document.visibilityState === 'visible';
                const isCurrentChat = chatId === selectedChatIdRef.current;
                
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
                    data: { 
                      chatId,
                      url: '/chat'
                    },
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

      userWsServiceRef.current.connect(token || undefined);
      wsServiceRef.current = userWsServiceRef.current;
      
      // Создаем глобальный Call Service который работает всегда
      console.log('📞 [Chat] Создание глобального Call Service');
      
      const ICE_SERVERS = [
        { urls: "stun:stun.l.google.com:19302" },
      ];
      
      globalCallServiceRef.current = new OneToOneCallService({
        wsService: userWsServiceRef.current,
        chatId: "", // Будет обновляться при звонках
        userId: user.id,
        iceServers: ICE_SERVERS,
        onStateChange: (state) => {
          console.log(`📞 [Chat] Глобальное состояние звонка:`, state);
        },
        onIncomingCall: (call) => {
          console.log(`📞 [Chat] Глобальный входящий звонок:`, call);
          setIncomingCall(call);
        },
        onRemoteStream: (stream) => {
          console.log(`📞 [Chat] Глобальный удаленный поток получен`);
        },
        onCallEnded: (reason) => {
          console.log(`📞 [Chat] Глобальный звонок завершен:`, reason);
          setIncomingCallRef.current(null);
        },
        onError: (message) => {
          console.error(`📞 [Chat] Глобальная ошибка звонка:`, message);
          toast.error(message);
        },
      });
    } catch (error) {
      console.error('Failed to create WebSocket connection:', error);
    }
    
    return () => {
      console.log('📞 [Chat] Cleanup: отключение глобального WebSocket и Call Service');
      if (userWsServiceRef.current) {
        userWsServiceRef.current.disconnect();
        userWsServiceRef.current = null;
      }
      if (globalCallServiceRef.current) {
        globalCallServiceRef.current = null;
      }
    };

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
  }, [user?.id]); // Без selectedChatId — WebSocket глобальный, не должен переподключаться при смене чата

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
      } else if (event.data && event.data.type === 'NOTIFICATION_CLICK') {
        // Обработка клика по уведомлению от Service Worker
        console.log('[Chat] Клик по уведомлению от Service Worker:', event.data.data);
        if (event.data.data && event.data.data.chatId) {
          setSelectedChatId(event.data.data.chatId);
          // Разворачиваем сайдбар, если он свернут
          if (isSidebarCollapsed) {
            setIsSidebarCollapsed(false);
          }
        }
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

  // Рингтон при входящем звонке (работает всегда, в любом экране)
  useEffect(() => {
    if (!ringtoneRef.current) return;
    if (incomingCall) {
      ringtoneRef.current.src = "/sounds/roundabout.ogg";
      ringtoneRef.current.volume = 0.5;
      ringtoneRef.current.loop = true;
      ringtoneRef.current.currentTime = 0;
      ringtoneRef.current.play().catch(() => {});
    } else {
      ringtoneRef.current.pause();
      ringtoneRef.current.currentTime = 0;
    }
  }, [incomingCall]);

  // Лог для отладки: проверяем, что incomingCall есть при рендере
  useEffect(() => {
    if (incomingCall) {
      console.log('📞 [Chat] incomingCall в state, показываем попап:', incomingCall.fromUsername);
    }
  }, [incomingCall]);

  const acceptIncomingCall = async () => {
    if (!incomingCall || !globalCallServiceRef.current) return;
    if (ringtoneRef.current) {
      ringtoneRef.current.pause();
      ringtoneRef.current.currentTime = 0;
    }
    // await — дождаться отправки call_accept до смены UI
    await globalCallServiceRef.current.acceptIncomingCall(incomingCall.callId, incomingCall.fromUserId);
    if (incomingCall.chatId) {
      setSelectedChatId(incomingCall.chatId);
      setIsSidebarCollapsed(true);
    }
    clearIncomingCall();
  };

  const rejectIncomingCall = () => {
    if (!incomingCall || !globalCallServiceRef.current) return;
    if (ringtoneRef.current) {
      ringtoneRef.current.pause();
      ringtoneRef.current.currentTime = 0;
    }
    globalCallServiceRef.current.rejectIncomingCall(incomingCall.callId, incomingCall.fromUserId);
    clearIncomingCall();
  };

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
                      url: '/chat'
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

  if (!user) {
    console.log('⏳ User еще не загружен, ждем...');
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-primary border-t-transparent mx-auto"></div>
          <p className="text-muted-foreground">Загрузка...</p>
        </div>
      </div>
    );
  }
  
  if (!user.id) {
    console.error('❌ User загружен, но ID отсутствует!', user);
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center space-y-4">
          <p className="text-destructive font-semibold">Ошибка: ID пользователя не определен</p>
          <Button onClick={() => navigate('/auth')}>Вернуться к входу</Button>
        </div>
      </div>
    );
  }

  console.log('📱 Chat страница загружена', { userId: user.id, user });

  return (
    <div className="flex bg-background overflow-hidden overflow-x-hidden w-full h-full min-w-0 min-h-0 max-w-[100vw]">
      {/* Модальное окно для запроса разрешения на уведомления */}
      <Dialog open={isSupported() && notificationPermission !== 'granted'} onOpenChange={(open) => {
        if (!open) {
          setNotificationPermission(Notification.permission);
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader className="text-center space-y-4">
            {/* Иконка */}
            <div className="mx-auto w-16 h-16 md:w-20 md:h-20 bg-gradient-primary rounded-2xl flex items-center justify-center shadow-glow">
              {notificationPermission === 'denied' ? (
                <BellOff className="w-8 h-8 md:w-10 md:h-10 text-primary-foreground" />
              ) : (
                <Bell className="w-8 h-8 md:w-10 md:h-10 text-primary-foreground" />
              )}
            </div>
            
            <DialogTitle className="text-xl md:text-2xl font-bold">
              {notificationPermission === 'default' 
                ? 'Включите уведомления'
                : 'Уведомления заблокированы'}
            </DialogTitle>
            
            <DialogDescription className="text-sm md:text-base text-muted-foreground">
              {notificationPermission === 'default' 
                ? 'Получайте мгновенные уведомления о новых сообщениях, даже когда приложение закрыто'
                : 'Уведомления заблокированы в настройках браузера. Разрешите их в настройках, чтобы получать уведомления о новых сообщениях'}
            </DialogDescription>
          </DialogHeader>
          
          <div className="flex flex-col gap-3 mt-4">
            {notificationPermission === 'default' && (
              <Button
                onClick={async () => {
                  const granted = await requestPermission();
                  if (granted) {
                    setNotificationPermission('granted');
                  }
                }}
                className="w-full bg-gradient-primary shadow-glow hover:shadow-glow-lg transition-all"
                size="lg"
              >
                <Bell className="w-4 h-4 mr-2" />
                Включить уведомления
              </Button>
            )}
            
            <Button
              onClick={() => setNotificationPermission(Notification.permission)}
              variant="ghost"
              className="w-full"
            >
              {notificationPermission === 'default' ? 'Может позже' : 'Закрыть'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      
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
      
      {/* Показываем ChatWindow только когда сайдбар свернут И выбран чат И пользователь загружен */}
      {isSidebarCollapsed && selectedChatId && user && user.id ? (
        <div className="flex-1 min-w-0 min-h-0 overflow-hidden overflow-x-hidden flex flex-col max-w-full">
        <ChatWindow
          chatId={selectedChatId}
          userId={user.id}
          globalCallService={globalCallServiceRef.current}
          onCallEnded={clearIncomingCall}
        />
        </div>
      ) : isSidebarCollapsed && selectedChatId && !user ? (
        <div className="flex-1 flex items-center justify-center bg-background">
          <div className="text-center space-y-4">
            <div className="animate-spin rounded-full h-12 w-12 border-4 border-primary border-t-transparent mx-auto"></div>
            <p className="text-muted-foreground">Загрузка профиля...</p>
          </div>
        </div>
      ) : null}
      
      {/* Сообщение когда сайдбар развернут */}
      {!isSidebarCollapsed}
      
      {/* Сообщение когда сайдбар свернут но чат не выбран */}
      {isSidebarCollapsed && !selectedChatId && (
        <div className="flex-1 flex items-center justify-center bg-gradient-to-br from-background to-primary/5">
          <div className="text-center p-4 md:p-8">
            <div className="w-16 h-16 md:w-24 md:h-24 bg-gradient-primary rounded-2xl md:rounded-3xl mx-auto mb-4 md:mb-6 flex items-center justify-center shadow-glow">
              <span className="text-2xl md:text-4xl font-black text-primary-foreground">Х</span>
            </div>
            <h2 className="text-xl md:text-2xl font-bold text-foreground mb-2 md:mb-4">
              Выберите чат
            </h2>
            <p className="text-sm md:text-base text-muted-foreground max-w-md px-4">
              Нажмите на иконку меню чтобы развернуть список чатов
            </p>
          </div>
        </div>
      )}

      {/* Рингтон для входящих звонков */}
      <audio ref={ringtoneRef} className="hidden" />

      {/* Входящий звонок — рендерим через Portal в body, чтобы всегда был поверх всего */}
      {incomingCall && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-md">
          <div className="bg-gradient-to-b from-card to-card/90 border-2 border-primary/50 rounded-3xl shadow-2xl max-w-sm w-[90vw] p-6 animate-in zoom-in-95 slide-in-from-bottom-4">
            <div className="flex justify-center mb-6">
              <div className="relative">
                <div className="absolute inset-0 rounded-full bg-primary/20 animate-ping" style={{ animationDuration: '1.5s' }} />
                <div className="absolute inset-0 rounded-full bg-primary/30 animate-ping" style={{ animationDuration: '2s', animationDelay: '0.3s' }} />
                <div className="relative z-10">
                  <Avatar className="w-24 h-24 border-4 border-primary shadow-glow">
                    {incomingCall.fromUserAvatar ? (
                      <AvatarImage src={incomingCall.fromUserAvatar} alt={incomingCall.fromUsername} />
                    ) : (
                      <AvatarFallback className="bg-gradient-primary text-white text-3xl">
                        {incomingCall.fromUsername?.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    )}
                  </Avatar>
                  <div className="absolute -bottom-2 -right-2 w-10 h-10 bg-primary rounded-full flex items-center justify-center shadow-lg animate-bounce">
                    <PhoneIncoming className="w-5 h-5 text-white" />
                  </div>
                </div>
              </div>
            </div>
            <div className="text-center mb-8">
              <h3 className="text-2xl font-bold mb-1">{incomingCall.fromUsername}</h3>
              <p className="text-sm text-muted-foreground animate-pulse">Входящий звонок...</p>
            </div>
            <div className="flex gap-4 justify-center">
              <button onClick={rejectIncomingCall} className="group flex flex-col items-center gap-2 transition-all hover:scale-105 active:scale-95">
                <div className="w-16 h-16 rounded-full bg-destructive hover:bg-destructive/90 flex items-center justify-center shadow-lg transition-colors">
                  <PhoneOff className="w-7 h-7 text-white" />
                </div>
                <span className="text-xs font-medium text-muted-foreground group-hover:text-destructive transition-colors">Отклонить</span>
              </button>
              <button onClick={acceptIncomingCall} className="group flex flex-col items-center gap-2 transition-all hover:scale-105 active:scale-95">
                <div className="w-16 h-16 rounded-full bg-green-500 hover:bg-green-600 flex items-center justify-center shadow-glow animate-pulse">
                  <Phone className="w-7 h-7 text-white" />
                </div>
                <span className="text-xs font-medium text-muted-foreground group-hover:text-green-500 transition-colors">Принять</span>
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default Chat;
