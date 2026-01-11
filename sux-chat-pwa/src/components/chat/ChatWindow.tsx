import { useEffect, useState, useRef } from "react";
import { WebSocketService } from "@/services/websocket";
import { WS_URL } from "@/api/client";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, Paperclip, X, Check, CheckCheck, Download, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { api } from "@/api/client";
import { cn } from "@/lib/utils";
import { useNotifications } from "@/hooks/use-notifications";

interface Profile {
  id: string;
  username: string;
  avatar_url?: string;
}

interface Message {
  id: string;
  content: string | null;
  file_url: string | null;
  file_name: string | null;
  sender_id: string;
  sender?: Profile;
  created_at: string;
  is_read?: boolean;
}

interface ChatWindowProps {
  chatId: string | null;
  userId: string;
}

const ChatWindow = ({ chatId, userId }: ChatWindowProps) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [imageLoadErrors, setImageLoadErrors] = useState<Set<string>>(new Set());
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { showNotification, hasPermission, requestPermission, permission } = useNotifications();
  
  // Рефы для аудио
  const sendSoundRef = useRef<HTMLAudioElement | null>(null);
  const receiveSoundRef = useRef<HTMLAudioElement | null>(null);
  
  // Рефы для отслеживания состояния
  const previousMessagesRef = useRef<Message[]>([]);
  const lastSendTimeRef = useRef<number>(0);
  const shouldScrollRef = useRef<boolean>(true); // По умолчанию true для первоначальной прокрутки

  // Инициализация аудио
  useEffect(() => {
    sendSoundRef.current = new Audio('/sounds/send.mp3');
    receiveSoundRef.current = new Audio('/sounds/receive.mp3');
    
    if (sendSoundRef.current) {
      sendSoundRef.current.volume = 0.3;
    }
    if (receiveSoundRef.current) {
      receiveSoundRef.current.volume = 0.3;
    }

    return () => {
      if (sendSoundRef.current) {
        sendSoundRef.current.pause();
        sendSoundRef.current = null;
      }
      if (receiveSoundRef.current) {
        receiveSoundRef.current.pause();
        receiveSoundRef.current = null;
      }
    };
  }, []);

  // Загружаем количество непрочитанных сообщений
  const fetchUnreadCount = async () => {
    if (!chatId) return;
    try {
      const unreadData = await api.getUnreadCount();
      const count = unreadData.unread_by_chat[chatId] || 0;
      setUnreadCount(count);
    } catch (error) {
      console.error('Error fetching unread count:', error);
    }
  };

  // Отмечаем чат как прочитанный при открытии
  useEffect(() => {
    if (!chatId) return;
    
    const markAsRead = async () => {
      try {
        await api.markChatAsRead(chatId);
        setUnreadCount(0);
        // Обновляем сообщения, чтобы они отображались как прочитанные
        setMessages(prev => prev.map(msg => ({ ...msg, is_read: true })));
      } catch (error) {
        console.error('Error marking chat as read:', error);
      }
    };
    
    markAsRead();
  }, [chatId]);

  // WebSocket соединение для получения новых сообщений
  useEffect(() => {
    if (!chatId) {
      setMessages([]);
      setUnreadCount(0);
      return;
    }

    // Загружаем количество непрочитанных
    fetchUnreadCount();
    
    // Сначала загружаем существующие сообщения
    fetchMessages();

    // Подключаемся к WebSocket для получения новых сообщений в реальном времени
    const token = localStorage.getItem("access_token");
    const wsService = new WebSocketService(`${WS_URL}/chat/${chatId}/`, {
      onMessage: (data) => {
        console.log('[WebSocket] Получено сообщение для чата:', data);
        
        if (data.type === 'new_message' && data.message) {
          // Добавляем новое сообщение в список
          setMessages(prev => {
            // Проверяем, нет ли уже такого сообщения
            if (prev.some(msg => msg.id === data.message.id)) {
              return prev;
            }
            console.log('[WebSocket] Добавляем новое сообщение:', data.message.id);
            return [...prev, data.message];
          });
        }
      },
      onError: (error) => {
        console.error('[WebSocket] Ошибка:', error);
      },
      onOpen: () => {
        console.log('[WebSocket] ✅ ПОДКЛЮЧЕНО для чата:', chatId);
      },
      onClose: () => {
        console.log('[WebSocket] ⚠️ ОТКЛЮЧЕНО для чата:', chatId);
      },
    });

    wsService.connect(token || undefined);

    return () => {
      wsService.disconnect();
    };
  }, [chatId]);

  // Эффект для обработки новых сообщений и звуков
  useEffect(() => {
    // Пропускаем первоначальную загрузку
    if (previousMessagesRef.current.length === 0 && messages.length > 0) {
      previousMessagesRef.current = [...messages];
      // При первоначальной загрузке прокручиваем вниз
      setTimeout(() => scrollToBottom(), 100);
      return;
    }

    // Если сообщений стало больше - значит пришли новые сообщения
    if (messages.length > previousMessagesRef.current.length) {
      const newMessages = messages.slice(previousMessagesRef.current.length);
      
      // Проверяем, есть ли среди новых сообщений входящие (не от текущего пользователя)
      const hasIncomingMessages = newMessages.some(msg => 
        msg.sender?.id !== userId
      );

      // Проверяем, есть ли среди новых сообщений исходящие (от текущего пользователя)
      const hasOutgoingMessages = newMessages.some(msg => 
        msg.sender?.id === userId
      );
      
      // Игрорируем звук получения, если сообщение было отправлено недавно
      const timeSinceLastSend = Date.now() - lastSendTimeRef.current;
      
      if (hasIncomingMessages && receiveSoundRef.current && timeSinceLastSend > 2000) {
        receiveSoundRef.current.currentTime = 0;
        receiveSoundRef.current.play().catch(error => {
          console.log("Ошибка воспроизведения звука получения:", error);
        });
      }

      // Прокручиваем вниз при любых новых сообщениях
      if (newMessages.length > 0) {
        setTimeout(() => scrollToBottom(), 100);
      }
    }
    
    // Обновляем предыдущие сообщения
    previousMessagesRef.current = [...messages];
  }, [messages, userId]);

  const fetchMessages = async () => {
    if (!chatId) return;
    try {
      const data = await api.getMessages(chatId);
      console.log("Fetched messages:", data);
      
      // Сравниваем с предыдущими сообщениями
      const previousMessages = previousMessagesRef.current;
      
      // Обновляем состояние только если сообщения изменились
      if (JSON.stringify(data) !== JSON.stringify(previousMessages)) {
        setMessages(data);
      }
    } catch {
      console.log("Не удалось загрузить сообщения (автообновление)");
    }
  };

  const scrollToBottom = () => {
    setTimeout(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
      
      if (messagesEndRef.current) {
        messagesEndRef.current.scrollIntoView({ 
          behavior: 'smooth',
          block: 'end'
        });
      }
    }, 100);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        toast.error("Файл слишком большой (макс. 10MB)");
        return;
      }
      setSelectedFile(file);
    }
  };

  // Функция для тестирования уведомлений
  const testNotification = async () => {
    console.log('[TEST] ========== ТЕСТ УВЕДОМЛЕНИЯ ==========');
    console.log('[TEST] Платформа:', navigator.platform);
    console.log('[TEST] User Agent:', navigator.userAgent);
    console.log('[TEST] Текущее разрешение (хук):', permission);
    console.log('[TEST] Notification.permission (прямая проверка):', typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'N/A');
    console.log('[TEST] Notification API доступен:', 'Notification' in window);
    console.log('[TEST] Service Worker доступен:', 'serviceWorker' in navigator);
    
    // Проверяем базовую поддержку
    if (!('Notification' in window)) {
      toast.error('Ваш браузер не поддерживает уведомления');
      console.error('[TEST] ❌ Браузер не поддерживает Notification API');
      return;
    }

    // Проверяем разрешение
    let currentPermission = Notification.permission;
    console.log('[TEST] Текущее разрешение:', currentPermission);
    
    if (currentPermission !== 'granted') {
      console.log('[TEST] Разрешение не получено, запрашиваем...');
      try {
        const granted = await requestPermission();
        console.log('[TEST] Результат запроса разрешения:', granted);
        currentPermission = Notification.permission;
        console.log('[TEST] Новое разрешение:', currentPermission);
        
        if (!granted || currentPermission !== 'granted') {
          toast.error('Разрешение на уведомления не получено. Проверьте настройки браузера и macOS.');
          console.error('[TEST] ❌ Не удалось получить разрешение');
          console.error('[TEST] Инструкция: Системные настройки → Уведомления → [Ваш браузер] → Включить уведомления');
          return;
        }
      } catch (error) {
        console.error('[TEST] ❌ Ошибка при запросе разрешения:', error);
        toast.error('Ошибка при запросе разрешения: ' + (error instanceof Error ? error.message : String(error)));
        return;
      }
    }

    console.log('[TEST] ✅ Разрешение получено, пробуем показать уведомление...');
    const testTime = new Date().toLocaleTimeString();
    
    // Пробуем ПРЯМОЙ способ через Notification API (самый простой)
    console.log('[TEST] Способ 1: Прямой Notification API');
    try {
      const directNotification = new Notification('🔔 Тест 1: Прямое уведомление', {
        body: `Время: ${testTime}\nПрямой способ через Notification API`,
        icon: '/favicon.ico',
        tag: `test-direct-${Date.now()}`,
        requireInteraction: false,
      });
      
      console.log('[TEST] ✅ Прямое уведомление создано:', directNotification);
      
      directNotification.onclick = () => {
        console.log('[TEST] Прямое уведомление кликнуто');
        directNotification.close();
      };
      
      directNotification.onerror = (error) => {
        console.error('[TEST] ❌ Ошибка прямого уведомления:', error);
      };
      
      directNotification.onshow = () => {
        console.log('[TEST] ✅ Прямое уведомление показано!');
        toast.success('Прямое уведомление показано!');
      };
      
      directNotification.onclose = () => {
        console.log('[TEST] Прямое уведомление закрыто');
      };
      
    } catch (directError) {
      console.error('[TEST] ❌ Ошибка прямого уведомления:', directError);
    }
    
    // Пробуем через Service Worker
    if ('serviceWorker' in navigator) {
      console.log('[TEST] Способ 2: Через Service Worker');
      try {
        const registration = await navigator.serviceWorker.ready;
        console.log('[TEST] Service Worker ready:', registration);
        
        if (registration && 'showNotification' in registration) {
          await registration.showNotification('🔔 Тест 2: Через Service Worker', {
            body: `Время: ${testTime}\nЧерез Service Worker`,
            icon: '/favicon.ico',
            tag: `test-sw-${Date.now()}`,
            requireInteraction: false,
          });
          console.log('[TEST] ✅ Service Worker уведомление отправлено');
        } else {
          console.warn('[TEST] Service Worker не поддерживает showNotification');
        }
      } catch (swError) {
        console.error('[TEST] ❌ Ошибка Service Worker уведомления:', swError);
      }
    }
    
    // Пробуем через хук
    console.log('[TEST] Способ 3: Через хук useNotifications');
    try {
      await showNotification({
        title: '🔔 Тест 3: Через хук',
        body: `Время: ${testTime}\nЧерез хук useNotifications`,
        icon: '/favicon.ico',
        tag: `test-hook-${Date.now()}`,
        data: { 
          chatId: chatId || 'test',
          url: '/chat',
          test: true 
        },
        requireInteraction: false,
      });
      console.log('[TEST] ✅ Уведомление через хук отправлено');
    } catch (hookError) {
      console.error('[TEST] ❌ Ошибка уведомления через хук:', hookError);
    }
    
    console.log('[TEST] ========================================');
    console.log('[TEST] Если уведомления не появились:');
    console.log('[TEST] 1. Проверьте настройки macOS: Системные настройки → Уведомления → [Ваш браузер]');
    console.log('[TEST] 2. Убедитесь, что уведомления включены для браузера');
    console.log('[TEST] 3. Перезапустите браузер');
    console.log('[TEST] 4. Проверьте, не включен ли режим "Не беспокоить" в macOS');
  };

  const sendMessage = async () => {
    if (!chatId || (!newMessage.trim() && !selectedFile)) return;

    setUploading(true);

    try {
      let fileUrl: string | null = null;
      let fileName: string | null = null;
      let fileSize: number | null = null;

      if (selectedFile) {
        try {
          // Загружаем файл на сервер
          const uploadResult = await api.uploadFile(selectedFile);
          fileUrl = uploadResult.file_url;
          fileName = uploadResult.file_name;
          fileSize = uploadResult.file_size;
        } catch (error: any) {
          console.error("Error uploading file:", error);
          toast.error("Ошибка загрузки файла: " + (error.message || "Неизвестная ошибка"));
          setUploading(false);
          return;
        }
      }

      // Воспроизводим звук отправки
      if (sendSoundRef.current) {
        sendSoundRef.current.currentTime = 0;
        sendSoundRef.current.play().catch(error => {
          console.log("Ошибка воспроизведения звука отправки:", error);
        });
      }

      // Запоминаем время отправки
      lastSendTimeRef.current = Date.now();

      // Отправляем сообщение с файлом или без
      if (fileUrl && fileName && fileSize) {
        await api.sendMessageWithFile(chatId, {
          file_url: fileUrl,
          file_name: fileName,
          file_size: fileSize
        }, newMessage.trim() || undefined);
      } else {
        await api.sendMessage(chatId, newMessage.trim() || null);
      }
      
      setNewMessage("");
      setSelectedFile(null);

      // Прокручиваем вниз сразу после отправки
      setTimeout(() => {
        scrollToBottom();
      }, 50);

      // WebSocket автоматически обновит сообщения, поэтому не нужно вызывать fetchMessages()
    } catch (error: any) {
      console.error("Error sending message:", error);
      toast.error("Ошибка отправки: " + (error.message || "Неизвестная ошибка"));
    } finally {
      setUploading(false);
    }
  };

  // Функция для форматирования времени
  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString("ru-RU", { 
      hour: "2-digit", 
      minute: "2-digit" 
    });
  };

  // Функция для проверки, нужно ли показывать дату между сообщениями
  const shouldShowDate = (currentMsg: Message, previousMsg: Message | null) => {
    if (!previousMsg) return true;
    
    const currentDate = new Date(currentMsg.created_at).toDateString();
    const previousDate = new Date(previousMsg.created_at).toDateString();
    
    return currentDate !== previousDate;
  };

  // Функция для проверки, является ли файл изображением
  const isImageFile = (fileName: string | null, fileUrl: string | null): boolean => {
    if (!fileName && !fileUrl) return false;
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'];
    const checkString = fileName || fileUrl || '';
    return imageExtensions.some(ext => checkString.toLowerCase().endsWith(ext));
  };

  // Функция для нормализации URL изображения (обработка localhost и относительных путей)
  const normalizeImageUrl = (url: string | null): string => {
    if (!url) return '';
    // Если это относительный путь, оставляем как есть
    if (url.startsWith('/')) return url;
    // Если это localhost, заменяем на относительный путь
    if (url.includes('localhost') || url.includes('127.0.0.1')) {
      const relativePath = url.replace(/^https?:\/\/[^/]+/, '');
      return relativePath;
    }
    return url;
  };

  // Функция для сохранения файла локально (для PWA)
  const handleSaveFile = async (fileUrl: string, fileName: string) => {
    try {
      // Используем стандартный способ скачивания файлов
      const response = await fetch(fileUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // Освобождаем память
      window.URL.revokeObjectURL(url);
      
      toast.success('Файл сохранен');
    } catch (error) {
      console.error('Error saving file:', error);
      toast.error('Ошибка сохранения файла');
      
      // Fallback: открываем файл в новой вкладке
      window.open(fileUrl, '_blank');
    }
  };

  // Функция для форматирования даты
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return "Сегодня";
    } else if (date.toDateString() === yesterday.toDateString()) {
      return "Вчера";
    } else {
      return date.toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "long",
        year: "numeric"
      });
    }
  };

  if (!chatId) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="w-20 h-20 bg-gradient-primary rounded-3xl mx-auto mb-4 flex items-center justify-center shadow-glow">
            <Send className="w-10 h-10 text-primary-foreground" />
          </div>
          <h3 className="text-xl font-semibold mb-2">Выберите чат</h3>
          <p className="text-muted-foreground">
            Выберите существующий чат или создайте новый
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Модальное окно для просмотра изображений */}
      <Dialog open={!!selectedImageUrl} onOpenChange={(open) => !open && setSelectedImageUrl(null)}>
        <DialogContent className="max-w-[95vw] max-h-[95vh] p-0 bg-background/95 backdrop-blur-sm">
          {selectedImageUrl && (
            <div className="relative w-full h-full flex items-center justify-center">
              <img
                src={selectedImageUrl}
                alt="Просмотр изображения"
                className="max-w-full max-h-[90vh] object-contain rounded-lg"
              />
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-2 right-2 bg-background/80 hover:bg-background"
                onClick={() => setSelectedImageUrl(null)}
              >
                <X className="w-5 h-5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="absolute bottom-2 right-2 bg-background/80 hover:bg-background"
                onClick={() => {
                  if (selectedImageUrl) {
                    handleSaveFile(selectedImageUrl, 'image');
                  }
                }}
              >
                <Download className="w-5 h-5" />
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Заголовок чата с индикатором непрочитанных */}
      {chatId && unreadCount > 0 && (
        <div className="bg-primary/10 border-b border-primary/20 px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-primary rounded-full animate-pulse" />
            <span className="text-sm font-medium text-primary">
              {unreadCount} {unreadCount === 1 ? 'непрочитанное сообщение' : unreadCount < 5 ? 'непрочитанных сообщения' : 'непрочитанных сообщений'}
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              try {
                await api.markChatAsRead(chatId);
                setUnreadCount(0);
                setMessages(prev => prev.map(msg => ({ ...msg, is_read: true })));
              } catch (error) {
                console.error('Error marking chat as read:', error);
              }
            }}
            className="text-xs h-7"
          >
            Отметить как прочитанное
          </Button>
        </div>
      )}

      <div className="flex-1 flex flex-col bg-background">
      <ScrollArea className="flex-1 px-4 py-6" ref={scrollRef as any}>
        <div className="max-w-4xl mx-auto space-y-6">
          {messages.map((message, index) => {
            const isOwn = message.sender?.id === userId;
            const previousMessage = index > 0 ? messages[index - 1] : null;
            const showDate = shouldShowDate(message, previousMessage);
            const username = message.sender?.username || "Неизвестный";
            const avatarLetter = username.charAt(0).toUpperCase();
            const isUnread = !isOwn && !message.is_read;

            return (
              <div key={message.id} className="space-y-2">
                {/* Разделитель с датой */}
                {showDate && (
                  <div className="flex justify-center">
                    <div className="bg-muted/50 px-3 py-1 rounded-full text-xs text-muted-foreground">
                      {formatDate(message.created_at)}
                    </div>
                  </div>
                )}

                {/* Сообщение */}
                <div className={cn(
                  "flex gap-3 group transition-all",
                  isOwn && "flex-row-reverse",
                  isUnread && !isOwn && "bg-primary/5 border-l-2 border-primary rounded-r-lg pl-2 -ml-2"
                )}>
                  {/* Аватар (только для чужих сообщений) */}
                  {!isOwn && (
                    <Avatar className="w-8 h-8 flex-shrink-0">
                      {message.sender?.avatar_url ? (
                        <AvatarImage 
                          src={message.sender.avatar_url} 
                          alt={username}
                        />
                      ) : (
                        <AvatarFallback className="bg-gradient-to-br from-blue-500 to-purple-600 text-white text-xs">
                          {avatarLetter}
                        </AvatarFallback>
                      )}
                    </Avatar>
                  )}

                  {/* Контент сообщения */}
                  <div className={cn(
                    "flex flex-col max-w-[70%]",
                    isOwn ? "items-end" : "items-start"
                  )}>
                    {/* Имя отправителя (только для чужих сообщений) */}
                    {!isOwn && (
                      <div className="flex items-center gap-2 mb-1 ml-1">
                        <span className="text-xs font-medium text-foreground">
                          {username}
                        </span>
                      </div>
                    )}

                    {/* Буббл сообщения */}
                    <div className={cn(
                      "rounded-2xl px-4 py-2 relative",
                      "transition-all duration-200",
                      isOwn 
                        ? cn(
                            "bg-gradient-primary text-primary-foreground shadow-glow",
                            "rounded-br-md"
                          )
                        : cn(
                            isUnread 
                              ? "bg-card border-2 border-primary/40 shadow-md"
                              : "bg-card border border-border/50 shadow-sm",
                            "rounded-bl-md"
                          )
                    )}>
                      {/* Индикатор непрочитанного сообщения */}
                      {isUnread && (
                        <div className="absolute -left-1 top-1/2 -translate-y-1/2 w-2 h-2 bg-primary rounded-full animate-pulse" />
                      )}
                      {/* Текст сообщения */}
                      {message.content && (
                        <p className="break-words leading-relaxed whitespace-pre-wrap">
                          {message.content}
                        </p>
                      )}

                      {/* Файл */}
                      {message.file_url && (
                        <div className={cn("mt-2", isImageFile(message.file_name, message.file_url) && !imageLoadErrors.has(message.id) && "max-w-[400px]")}>
                          {isImageFile(message.file_name, message.file_url) && !imageLoadErrors.has(message.id) ? (
                            // Отображение изображения
                            <div className="relative group">
                              <img 
                                src={normalizeImageUrl(message.file_url)} 
                                alt={message.file_name || "Изображение"}
                                className={cn(
                                  "rounded-lg max-w-full h-auto cursor-pointer",
                                  "border-2 transition-transform hover:scale-[1.02]",
                                  isOwn ? "border-primary/30" : "border-border"
                                )}
                                onClick={() => setSelectedImageUrl(normalizeImageUrl(message.file_url))}
                                onError={() => {
                                  // Если изображение не загрузилось, добавляем в список ошибок
                                  setImageLoadErrors(prev => new Set(prev).add(message.id));
                                }}
                              />
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const normalizedUrl = normalizeImageUrl(message.file_url);
                                  handleSaveFile(normalizedUrl, message.file_name || 'image');
                                }}
                                className={cn(
                                  "absolute top-2 right-2 p-2 rounded-full backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity z-10",
                                  isOwn 
                                    ? "bg-primary/80 text-primary-foreground hover:bg-primary"
                                    : "bg-background/80 text-foreground hover:bg-background"
                                )}
                                title="Сохранить изображение"
                              >
                                <Download className="w-4 h-4" />
                              </button>
                            </div>
                          ) : (
                            // Отображение обычного файла
                            <div className={cn(
                              "flex items-center gap-2 p-2 rounded-lg border transition-colors",
                              isOwn
                                ? "bg-primary/20 border-primary/30 hover:bg-primary/30"
                                : "bg-muted border-border hover:bg-muted/80"
                            )}>
                              <Paperclip className="w-4 h-4 flex-shrink-0" />
                              <a
                                href={normalizeImageUrl(message.file_url)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex-1 text-sm truncate hover:underline"
                              >
                                {message.file_name || "Файл"}
                              </a>
                              <button
                                onClick={(e) => {
                                  e.preventDefault();
                                  const normalizedUrl = normalizeImageUrl(message.file_url);
                                  handleSaveFile(normalizedUrl, message.file_name || 'file');
                                }}
                                className="p-1 rounded hover:bg-background/50 transition-colors"
                                title="Сохранить файл"
                              >
                                <Download className="w-4 h-4" />
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Время и статус */}
                    <div className={cn(
                      "flex items-center gap-2 mt-1 px-1",
                      isOwn ? "flex-row-reverse" : ""
                    )}>
                      <span className="text-xs text-muted-foreground">
                        {formatTime(message.created_at)}
                      </span>
                      
                      {/* Статусы доставки/прочтения */}
                      {isOwn && (
                        <div className="flex items-center">
                          <CheckCheck className="w-3 h-3 text-muted-foreground" />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Аватар для своих сообщений */}
                  {isOwn && <div className="w-8 h-8 flex-shrink-0" />}
                </div>
              </div>
            );
          })}
          {/* Невидимый элемент для прокрутки вниз */}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {/* Поле ввода */}
      <div className="p-4 border-t border-border bg-card/50 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto">
          {selectedFile && (
            <div className="mb-3 p-3 bg-secondary/50 rounded-lg flex items-center justify-between border">
              <div className="flex items-center gap-2">
                <Paperclip className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium truncate max-w-[300px]">
                  {selectedFile.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  ({(selectedFile.size / 1024 / 1024).toFixed(1)} MB)
                </span>
              </div>
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => setSelectedFile(null)}
                className="h-8 w-8 hover:bg-destructive/10 hover:text-destructive"
              >
                <X className="w-3 h-3" />
              </Button>
            </div>
          )}
          
          <div className="flex gap-2 items-end">
            <input 
              ref={fileInputRef} 
              type="file" 
              onChange={handleFileSelect} 
              className="hidden" 
              accept="*/*"
            />
            <Button 
              variant="outline" 
              size="icon" 
              onClick={() => fileInputRef.current?.click()} 
              disabled={uploading}
              className="h-11 w-11 shrink-0 border-2"
            >
              <Paperclip className="w-4 h-4" />
            </Button>
            
            {/* Кнопка тестирования уведомлений - скрыта */}
            {/* <Button 
              variant="outline" 
              size="icon" 
              onClick={testNotification}
              disabled={uploading}
              className="h-11 w-11 shrink-0 border-2 border-yellow-500 hover:bg-yellow-500/10"
              title="Тест уведомлений (для отладки)"
            >
              <Bell className="w-4 h-4" />
            </Button> */}
            
            <div className="flex-1 relative">
              <Input
                placeholder="Введите сообщение..."
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
                disabled={uploading}
                className="pr-12 bg-background border-2 h-11 resize-none"
                multiline
                style={{ minHeight: '44px', maxHeight: '120px' }}
              />
            </div>
            
            <Button 
              onClick={sendMessage} 
              disabled={uploading || (!newMessage.trim() && !selectedFile)} 
              className="h-11 px-6 bg-gradient-primary shadow-glow hover:shadow-glow-lg transition-all duration-200 shrink-0"
              size="lg"
            >
              {uploading ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>
      </div>
      </div>
    </>
  );
};

export default ChatWindow;