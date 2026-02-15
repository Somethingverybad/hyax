import { useEffect, useState, useRef } from "react";
import { WebSocketService } from "@/services/websocket";
import { ICE_SERVERS, WS_URL } from "@/api/client";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, Paperclip, X, CheckCheck, Download, Phone, PhoneOff, Mic, MicOff, Smile, User } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { api } from "@/api/client";
import { cn } from "@/lib/utils";
import StickerPicker from "@/components/stickers/StickerPicker";
import StickerPackManager from "@/components/stickers/StickerPackManager";
import VoiceRecorder from "@/components/voice/VoiceRecorder";
import VoicePlayer from "@/components/voice/VoicePlayer";
import ProfileView from "@/components/profile/ProfileView";
import ProfileEdit from "@/components/profile/ProfileEdit";
import { OneToOneCallService } from "@/services/call-service";

interface Profile {
  id: string;
  username: string;
  avatar_url?: string;
}

interface Sticker {
  id: string;
  pack: string;
  pack_name: string;
  file_url: string;
  file_name: string;
  emoji?: string;
  order: number;
  created_at: string;
}

interface Message {
  id: string;
  content: string | null;
  file_url: string | null;
  file_name: string | null;
  sender_id: string;
  sender?: Profile;
  sticker?: Sticker;
  voice_url?: string;
  voice_duration?: number;
  created_at: string;
}

interface ChatWindowProps {
  chatId: string | null;
  userId: string;
  globalCallService: OneToOneCallService | null;
  onCallEnded?: () => void;
}

type CallState = "idle" | "outgoing" | "incoming" | "connecting" | "active";

const ChatWindow = ({ chatId, userId, globalCallService, onCallEnded }: ChatWindowProps) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [imageLoadErrors, setImageLoadErrors] = useState<Set<string>>(new Set());
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);
  const [showStickerPicker, setShowStickerPicker] = useState(false);
  const [showStickerManager, setShowStickerManager] = useState(false);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [showProfileEdit, setShowProfileEdit] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageInputRef = useRef<HTMLInputElement>(null);
  const callServiceRef = useRef<OneToOneCallService | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  
  // Рефы для аудио
  const sendSoundRef = useRef<HTMLAudioElement | null>(null);
  const receiveSoundRef = useRef<HTMLAudioElement | null>(null);
  
  // Рефы для отслеживания состояния
  const previousMessagesRef = useRef<Message[]>([]);
  const lastSendTimeRef = useRef<number>(0);
  const [targetParticipant, setTargetParticipant] = useState<Profile | null>(null);
  const [callState, setCallState] = useState<CallState>("idle");
  const [isMuted, setIsMuted] = useState(false);

  // Обработка появления клавиатуры на мобильных
  useEffect(() => {
    const handleResize = () => {
      // Если поле ввода в фокусе, прокручиваем к нему
      if (document.activeElement === messageInputRef.current) {
        setTimeout(() => {
          messageInputRef.current?.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'center' 
          });
        }, 100);
      }
    };

    // Слушаем изменение размера viewport (когда появляется клавиатура)
    if ('visualViewport' in window) {
      window.visualViewport?.addEventListener('resize', handleResize);
    }
    window.addEventListener('resize', handleResize);

    return () => {
      if ('visualViewport' in window) {
        window.visualViewport?.removeEventListener('resize', handleResize);
      }
      window.removeEventListener('resize', handleResize);
    };
  }, []);

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

  useEffect(() => {
    if (!chatId) {
      setTargetParticipant(null);
      return;
    }

    let cancelled = false;

    const loadParticipants = async () => {
      try {
        const participants = await api.getChatParticipants(chatId);
        if (cancelled) {
          return;
        }
        const peer = participants.find((participant) => participant.id !== userId) || null;
        setTargetParticipant(peer);
      } catch (error) {
        console.error("Не удалось загрузить участников чата:", error);
        if (!cancelled) {
          setTargetParticipant(null);
        }
      }
    };

    loadParticipants();
    return () => {
      cancelled = true;
    };
  }, [chatId, userId]);

  useEffect(() => {
    if (!chatId) {
      setTargetParticipant(null);
      return;
    }

    let cancelled = false;

    const loadParticipants = async () => {
      try {
        const participants = await api.getChatParticipants(chatId);
        if (cancelled) {
          return;
        }
        const peer = participants.find((participant) => participant.id !== userId) || null;
        setTargetParticipant(peer);
      } catch (error) {
        console.error("Не удалось загрузить участников чата:", error);
        if (!cancelled) {
          setTargetParticipant(null);
        }
      }
    };

    loadParticipants();
    return () => {
      cancelled = true;
    };
  }, [chatId, userId]);

  // WebSocket соединение для получения новых сообщений (БЕЗ звонков!)
  useEffect(() => {
    if (!chatId) {
      setMessages([]);
      return;
    }

    // Сначала загружаем существующие сообщения
    fetchMessages();

    // Подключаемся к WebSocket ТОЛЬКО для сообщений (звонки через глобальный канал)
    const token = localStorage.getItem("access_token");
    const chatWsService = new WebSocketService(`${WS_URL}/chat/${chatId}/`, {
      onMessage: (data) => {
        if (data.type === 'new_message' && data.message) {
          // Добавляем новое сообщение в список
          setMessages(prev => {
            // Проверяем, нет ли уже такого сообщения
            if (prev.some(msg => msg.id === data.message.id)) {
              return prev;
            }
            return [...prev, data.message];
          });
        }
        // Больше НЕ обрабатываем call_signal здесь - это делает глобальный WebSocket!
      },
      onError: (error) => {
        console.error('[ChatWindow] WebSocket error:', error);
      },
      onOpen: () => {
        console.log(`[ChatWindow] WebSocket connected for chat: ${chatId}`);
      },
      onClose: () => {
        console.log(`[ChatWindow] WebSocket disconnected for chat: ${chatId}`);
      },
    });

    chatWsService.connect(token || undefined);

    return () => {
      console.log('[ChatWindow] Cleanup: отключение WebSocket для чата');
      chatWsService.disconnect();
    };
  }, [chatId]);
  
  // Используем глобальный Call Service (onIncomingCall нужен всегда, targetParticipant — только для исходящих)
  useEffect(() => {
    if (!globalCallService || !chatId) {
      console.log('[ChatWindow] Глобальный Call Service не готов:', {
        hasService: !!globalCallService,
        chatId
      });
      return;
    }
    
    console.log(`📞 [ChatWindow] Подключение к глобальному Call Service для чата ${chatId}`);
    
    // Используем глобальный Call Service
    callServiceRef.current = globalCallService;
    
    // Обновляем chatId для звонков
    if (callServiceRef.current && 'updateChatId' in callServiceRef.current) {
      (callServiceRef.current as any).updateChatId(chatId);
    }
    
    // Перенастраиваем callbacks для текущего чата
    callServiceRef.current.onStateChange = (state) => {
      setCallState(state);
    };
    
    // onIncomingCall обрабатывается в Chat.tsx (попап всегда виден, в любом экране)
    
    callServiceRef.current.onRemoteStream = (stream) => {
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = stream;
        void remoteAudioRef.current.play().catch(() => undefined);
      }
    };
    
    callServiceRef.current.onCallEnded = (reason) => {
      onCallEnded?.();
      setIsMuted(false);
      if (reason === "rejected") {
        toast.info("Звонок отклонен");
      } else if (reason === "failed") {
        toast.error("Звонок завершился с ошибкой соединения");
      }
    };
    
    callServiceRef.current.onError = (message) => {
      toast.error(message);
    };
    
    return () => {
      console.log('[ChatWindow] Cleanup Call Service callbacks');
      // НЕ сбрасываем incomingCall — он глобальный, не привязан к чату
      // НЕ dispose глобальный Call Service!
      setCallState("idle");
      setIsMuted(false);
    };
  }, [globalCallService, chatId, onCallEnded]);

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
      console.log("📥 Fetched messages:", data);
      console.log("📥 Голосовые сообщения в списке:", data.filter((m: any) => m.voice_url));
      
      // Проверяем сообщения на undefined sender.id
      const messagesWithUndefinedSender = data.filter((m: any) => m.sender && !m.sender.id);
      if (messagesWithUndefinedSender.length > 0) {
        console.error("❌ Найдены сообщения с undefined sender.id:", messagesWithUndefinedSender);
        messagesWithUndefinedSender.forEach((msg: any) => {
          console.error(`  - Message ID: ${msg.id}, Sender:`, msg.sender);
        });
      }
      
      // Проверяем сообщения вообще без sender
      const messagesWithoutSender = data.filter((m: any) => !m.sender);
      if (messagesWithoutSender.length > 0) {
        console.error("❌ Найдены сообщения без sender:", messagesWithoutSender);
      }
      
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

  const sendSticker = async (sticker: Sticker) => {
    if (!chatId) return;

    try {
      // Воспроизводим звук отправки
      if (sendSoundRef.current) {
        sendSoundRef.current.currentTime = 0;
        sendSoundRef.current.play().catch(error => {
          console.log("Ошибка воспроизведения звука отправки:", error);
        });
      }

      // Запоминаем время отправки
      lastSendTimeRef.current = Date.now();

      await api.sendMessageWithSticker(chatId, sticker.id);
      
      setShowStickerPicker(false);

      // Прокручиваем вниз сразу после отправки
      setTimeout(() => {
        scrollToBottom();
      }, 50);
    } catch (error: any) {
      console.error("Error sending sticker:", error);
      toast.error("Ошибка отправки стикера: " + (error.message || "Неизвестная ошибка"));
    }
  };

  const sendVoice = async (audioBlob: Blob, duration: number) => {
    if (!chatId) return;

    try {
      setUploading(true);

      // Загружаем голосовое сообщение
      const uploadResult = await api.uploadVoice(audioBlob);

      // Воспроизводим звук отправки
      if (sendSoundRef.current) {
        sendSoundRef.current.currentTime = 0;
        sendSoundRef.current.play().catch(error => {
          console.log("Ошибка воспроизведения звука отправки:", error);
        });
      }

      // Запоминаем время отправки
      lastSendTimeRef.current = Date.now();

      await api.sendMessageWithVoice(chatId, uploadResult.file_url, duration);

      setIsRecordingVoice(false);

      // Прокручиваем вниз сразу после отправки
      setTimeout(() => {
        scrollToBottom();
      }, 50);
    } catch (error: any) {
      console.error("Error sending voice:", error);
      toast.error("Ошибка отправки голосового сообщения: " + (error.message || "Неизвестная ошибка"));
    } finally {
      setUploading(false);
    }
  };

  const startCall = async () => {
    console.log('📞 [startCall] Нажата кнопка звонка');
    console.log('📞 [startCall] targetParticipant:', targetParticipant);
    console.log('📞 [startCall] callServiceRef.current:', callServiceRef.current);
    console.log('📞 [startCall] globalCallService:', globalCallService);
    console.log('📞 [startCall] chatId:', chatId);
    
    if (!targetParticipant) {
      console.error('❌ [startCall] Нет собеседника для звонка');
      toast.error("Для звонка нужен 1:1 чат");
      return;
    }
    if (!callServiceRef.current) {
      console.error('❌ [startCall] Сервис звонков не готов');
      toast.error("Сервис звонков не готов");
      return;
    }
    
    console.log(`📞 [startCall] Начинаем звонок пользователю ${targetParticipant.id}`);
    await callServiceRef.current.startOutgoingCall(targetParticipant.id);
  };

  const endCall = () => {
    callServiceRef.current?.endCall("ended", true);
    onCallEnded?.();
  };

  const toggleMute = () => {
    const muted = callServiceRef.current?.toggleMute() || false;
    setIsMuted(muted);
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
        <DialogContent className="max-w-[min(95vw,600px)] max-h-[95vh] w-[95vw] p-0 bg-background/95 backdrop-blur-sm mx-2">
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

      <div className="flex-1 flex flex-col bg-background overflow-hidden min-w-0 min-h-0 max-w-full">
      <audio ref={remoteAudioRef} autoPlay playsInline />
      {/* Верхняя панель: звонок + кнопка профиля */}
      <div className="border-b border-border bg-card/50 backdrop-blur-sm flex items-center justify-between gap-2 shrink-0 overflow-hidden px-2 sm:px-4" style={{ 
        paddingTop: 'max(8px, calc(8px + var(--safe-top, 0px)))',
        paddingBottom: '8px',
      }}>
        <div className="text-sm text-muted-foreground min-w-0 flex-1 truncate pr-2" title={targetParticipant ? `Звонок с ${targetParticipant.username}` : undefined}>
          {targetParticipant
            ? `Звонок с ${targetParticipant.username}`
            : "Звонки доступны только для 1:1 чатов"}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {(callState === "outgoing" || callState === "connecting" || callState === "active") && (
            <>
              <Button variant="outline" size="icon" onClick={toggleMute} className="h-9 w-9" title={isMuted ? "Звук выкл" : "Звук вкл"}>
                {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </Button>
              <Button variant="destructive" size="icon" onClick={endCall} className="h-9 w-9" title="Завершить">
                <PhoneOff className="w-5 h-5" />
              </Button>
            </>
          )}

          {callState === "idle" && (
            <Button size="icon" onClick={startCall} disabled={!targetParticipant} className="h-9 w-9" title="Позвонить">
              <Phone className="w-5 h-5" />
            </Button>
          )}

          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              if (!userId) {
                toast.error("ID пользователя не определен");
                return;
              }
              setSelectedProfileId(userId);
              setShowProfile(true);
            }}
            className="h-9 w-9 rounded-full hover:bg-primary/10 transition-colors"
            title="Мой профиль"
          >
            <User className="w-5 h-5" />
          </Button>
        </div>
      </div>
      
      <ScrollArea className="flex-1 min-h-0 px-3 md:px-4 py-4 md:py-6 overflow-x-hidden" ref={scrollRef as any}>
        <div className="max-w-4xl mx-auto space-y-4 md:space-y-6 min-w-0">
          {messages.map((message, index) => {
            const isOwn = message.sender?.id === userId;
            const previousMessage = index > 0 ? messages[index - 1] : null;
            const showDate = shouldShowDate(message, previousMessage);
            const username = message.sender?.username || "Неизвестный";
            const avatarLetter = username.charAt(0).toUpperCase();

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
                  "flex gap-3 group",
                  isOwn && "flex-row-reverse"
                )}>
                  {/* Аватар (только для чужих сообщений) */}
                  {!isOwn && (
                    <Avatar 
                      className="w-8 h-8 flex-shrink-0 cursor-pointer hover:ring-2 hover:ring-primary transition-all"
                      onClick={() => {
                        console.log('👤 Клик на аватар', { senderId: message.sender?.id, sender: message.sender });
                        if (message.sender?.id) {
                          setSelectedProfileId(message.sender.id);
                          setShowProfile(true);
                        } else {
                          console.error('❌ sender.id is undefined!', message);
                        }
                      }}
                    >
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
                      "flex flex-col min-w-0 max-w-[85%] sm:max-w-[75%] md:max-w-[70%]",
                      isOwn ? "items-end" : "items-start"
                    )}>
                    {/* Имя отправителя (только для чужих сообщений) */}
                    {!isOwn && (
                      <div className="flex items-center gap-2 mb-1 ml-1">
                        <span 
                          className="text-xs font-medium text-foreground cursor-pointer hover:text-primary transition-colors"
                          onClick={() => {
                            console.log('👤 Клик на имя пользователя', { senderId: message.sender?.id, sender: message.sender });
                            if (message.sender?.id) {
                              setSelectedProfileId(message.sender.id);
                              setShowProfile(true);
                            } else {
                              console.error('❌ sender.id is undefined!', message);
                            }
                          }}
                        >
                          {username}
                        </span>
                      </div>
                    )}

                    {/* Буббл сообщения */}
                    <div className={cn(
                      "rounded-2xl relative",
                      "transition-all duration-200",
                      (message.sticker || message.voice_url) ? "p-0 bg-transparent" : "px-4 py-2",
                      !message.sticker && !message.voice_url && (isOwn 
                        ? cn(
                            "bg-gradient-primary text-primary-foreground shadow-glow",
                            "rounded-br-md"
                          )
                        : cn(
                            "bg-card border border-border/50 shadow-sm",
                            "rounded-bl-md"
                          ))
                    )}>
                      {/* Стикер */}
                      {message.sticker && (
                        <div className="w-24 h-24 sm:w-32 sm:h-32 md:w-40 md:h-40 max-w-[min(10rem,45vw)]">
                          <img
                            src={message.sticker.file_url}
                            alt={message.sticker.file_name}
                            className="w-full h-full object-contain"
                          />
                        </div>
                      )}

                      {/* Голосовое сообщение */}
                      {message.voice_url && (
                        <>
                          {console.log('📩 Отображаем голосовое сообщение:', message.id, message.voice_url)}
                          <VoicePlayer
                            voiceUrl={message.voice_url}
                            duration={message.voice_duration}
                            isOwn={isOwn}
                          />
                        </>
                      )}

                      {/* Текст сообщения */}
                      {!message.sticker && !message.voice_url && message.content && (
                        <p className="break-words leading-relaxed whitespace-pre-wrap max-w-full overflow-hidden">
                          {message.content}
                        </p>
                      )}

                      {/* Файл */}
                      {!message.sticker && !message.voice_url && message.file_url && (
                        <div className={cn("mt-2 overflow-hidden", isImageFile(message.file_name, message.file_url) && !imageLoadErrors.has(message.id) && "max-w-[min(280px,calc(100vw-5rem))] sm:max-w-[350px] md:max-w-[400px]")}>
                          {isImageFile(message.file_name, message.file_url) && !imageLoadErrors.has(message.id) ? (
                            // Отображение изображения
                            <div className="relative group">
                              <img 
                                src={normalizeImageUrl(message.file_url)} 
                                alt={message.file_name || "Изображение"}
                                className={cn(
                                  "rounded-lg w-full max-w-full h-auto cursor-pointer object-contain",
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
      <div className="border-t border-border bg-card/50 backdrop-blur-sm shrink-0 overflow-hidden" style={{ 
        paddingTop: '8px',
        paddingBottom: 'env(safe-area-inset-bottom, 8px)',
        paddingLeft: '8px',
        paddingRight: '8px'
      }}>
        <div className="max-w-4xl mx-auto w-full min-w-0">
          {/* Voice Recorder */}
          {isRecordingVoice && (
            <div className="mb-2">
              <VoiceRecorder
                onSend={sendVoice}
                onCancel={() => setIsRecordingVoice(false)}
              />
            </div>
          )}

          {selectedFile && (
            <div className="mb-2 md:mb-3 p-2 md:p-3 bg-secondary/50 rounded-lg flex items-center justify-between border">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <Paperclip className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <span className="text-sm font-medium truncate">
                  {selectedFile.name}
                </span>
                <span className="text-xs text-muted-foreground flex-shrink-0">
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
          
          <div className="flex gap-2 items-end min-w-0">
            {!isRecordingVoice && (
              <>
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
                  className="h-10 w-10 md:h-11 md:w-11 shrink-0 border-2"
                >
                  <Paperclip className="w-4 h-4" />
                </Button>

                <Popover open={showStickerPicker} onOpenChange={setShowStickerPicker}>
                  <PopoverTrigger asChild>
                    <Button 
                      variant="outline" 
                      size="icon" 
                      disabled={uploading}
                      className="h-10 w-10 md:h-11 md:w-11 shrink-0 border-2"
                    >
                      <Smile className="w-4 h-4" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[min(320px,calc(100vw-1rem))] max-w-[calc(100vw-1rem)] p-0" side="top" align="start">
                    <StickerPicker
                      onSelectSticker={(sticker) => sendSticker(sticker)}
                      onManagePacks={() => {
                        setShowStickerPicker(false);
                        setShowStickerManager(true);
                      }}
                    />
                  </PopoverContent>
                </Popover>

                <Button 
                  variant="outline" 
                  size="icon" 
                  onClick={() => setIsRecordingVoice(true)}
                  disabled={uploading}
                  className="h-10 w-10 md:h-11 md:w-11 shrink-0 border-2"
                >
                  <Mic className="w-4 h-4" />
                </Button>
              </>
            )}
            
            {!isRecordingVoice && (
              <>
                <div className="flex-1 relative min-w-0">
                  <Input
                    ref={messageInputRef}
                    placeholder="Сообщение..."
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        sendMessage();
                      }
                    }}
                    onFocus={() => {
                      console.log('📝 Input focused, scrolling into view');
                      // Даем время клавиатуре появиться, затем прокручиваем
                      setTimeout(() => {
                        messageInputRef.current?.scrollIntoView({ 
                          behavior: 'smooth', 
                          block: 'center',
                          inline: 'nearest'
                        });
                      }, 300);
                    }}
                    disabled={uploading}
                    className="pr-12 bg-background border-2 h-10 md:h-11 resize-none text-sm md:text-base"
                    multiline
                    style={{ minHeight: '40px', maxHeight: '120px' }}
                  />
                </div>
                
                <Button 
                  onClick={sendMessage} 
                  disabled={uploading || (!newMessage.trim() && !selectedFile)} 
                  className="h-10 md:h-11 px-4 md:px-6 bg-gradient-primary shadow-glow hover:shadow-glow-lg transition-all duration-200 shrink-0"
                  size="lg"
                >
                  {uploading ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
      </div>

      {/* Менеджер стикерпаков */}
      <StickerPackManager
        open={showStickerManager}
        onOpenChange={setShowStickerManager}
        onPacksUpdated={() => {
          // Можно добавить обновление списка стикерпаков если нужно
        }}
      />

      {/* Просмотр профиля */}
      {showProfile && selectedProfileId && (
        <>
          {console.log('👁️ Рендер ProfileView', { selectedProfileId, userId, isOwnProfile: selectedProfileId === userId })}
          <ProfileView
            profileId={selectedProfileId}
            onClose={() => {
              console.log('👁️ Закрытие ProfileView');
              setShowProfile(false);
              setSelectedProfileId(null);
            }}
            isOwnProfile={selectedProfileId === userId}
            onEditClick={() => {
              console.log('✏️ Открытие ProfileEdit');
              setShowProfile(false);
              setShowProfileEdit(true);
            }}
          />
        </>
      )}

      {/* Редактирование профиля */}
      {showProfileEdit && (
        <ProfileEdit
          onClose={() => setShowProfileEdit(false)}
          onSaved={() => {
            // Можно обновить данные профиля в чате если нужно
            fetchMessages();
          }}
        />
      )}

    </>
  );
};

export default ChatWindow;

