import { useEffect, useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, Paperclip, X, Check, CheckCheck, Download, Image as ImageIcon, Smile, MoreVertical } from "lucide-react";
import { useSwipeBack } from "@/hooks/use-swipe-back";
import StickerPicker from "@/components/chat/StickerPicker";
import { toast } from "sonner";
import Identicon from "@/components/Identicon";
import { api, mediaUrl } from "@/api/client";
import { cn } from "@/lib/utils";

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
  /** Приходит с бэкенда, если сообщение — стикер. */
  sticker?: { id: string; file_url: string; emoji?: string } | null;
  sender_id: string;
  sender?: Profile;
  created_at: string;
  /** Клиентские поля оптимистичной отправки: pending — сервер ещё не
   *  подтвердил (одна галочка), _key — стабильный ключ рендера, чтобы
   *  подмена временного сообщения настоящим не перемонтировала DOM,
   *  _dims — размеры картинки, замеренные до вставки пузыря: место
   *  резервируется сразу, и лента не дёргается при декодировании. */
  pending?: boolean;
  _key?: string;
  _dims?: { w: number; h: number } | null;
}

/** Габариты картинки из локального файла — читаются мгновенно, без сети. */
const imageDims = (url: string) =>
  new Promise<{ w: number; h: number } | null>((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = url;
  });

/** Вписывает натуральный размер в бокс превью (240×192), не увеличивая. */
const previewSize = (dims: { w: number; h: number }) => {
  const scale = Math.min(240 / dims.w, 192 / dims.h, 1);
  return { width: Math.round(dims.w * scale), height: Math.round(dims.h * scale) };
};

interface ChatWindowProps {
  chatId: string | null;
  userId: string;
  /** На телефоне переписка занимает весь экран, и вернуться к списку можно
   *  только отсюда — на десктопе список виден всегда, поэтому кнопки нет. */
  onBack?: () => void;
  title?: string;
}

const ChatWindow = ({ chatId, userId, onBack, title }: ChatWindowProps) => {
  // Возврат к списку — жестом от левого края. Кнопку в шапке убрали:
  // на телефоне привычнее свайп, как в нативных приложениях.
  useSwipeBack(onBack);
  // Панель стикеров: выезжает над полем ввода, как в мессенджерах.
  const [stickersOpen, setStickersOpen] = useState(false);
  // Открытая на весь экран картинка: { url, name }.
  const [viewer, setViewer] = useState<{ url: string; name: string } | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [imageLoadErrors, setImageLoadErrors] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // Свои картинки показываем из локального файла: сервер их и так получил от
  // нас, скачивать обратно — лишний трафик и «пустой» пузырь на время загрузки.
  // Ключ — file_url, который сервер выдал при аплоаде.
  const localImagesRef = useRef<Map<string, string>>(new Map());
  
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

  // Основной эффект для загрузки сообщений
  useEffect(() => {
    if (!chatId) {
      setMessages([]);
      return;
    }

    // Сразу загружаем сообщения при смене чата
    fetchMessages();

    // Устанавливаем интервал для автообновления
    const intervalId = setInterval(() => {
      fetchMessages();
    }, 3000);

    return () => {
      clearInterval(intervalId);
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
      const data: Message[] = await api.getMessages(chatId);

      setMessages(prev => {
        // Серверный список не знает про клиентские поля: переносим ключ
        // рендера и размеры с уже подтверждённых сообщений, а ещё не
        // подтверждённые дописываем в конец — иначе опрос стирал бы пузырь
        // до ответа сервера.
        const meta = new Map(prev.filter(m => m._key).map(m => [m.id, m]));
        const withMeta = data.map(d => {
          const local = meta.get(d.id);
          return local ? { ...d, _key: local._key, _dims: local._dims } : d;
        });
        const merged = [...withMeta, ...prev.filter(m => m.pending)];
        return JSON.stringify(merged) !== JSON.stringify(prev) ? merged : prev;
      });
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

    const text = newMessage.trim();
    const file = selectedFile;

    // Пузырь появляется мгновенно, поле очищается сразу — сеть догоняет
    // в фоне. Для картинки заранее замеряем размеры из локального файла,
    // чтобы пузырь сразу занял своё место и лента не дёргалась.
    const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const localUrl =
      file && file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
    const dims = localUrl ? await imageDims(localUrl) : null;

    const optimistic: Message = {
      id: tempId,
      content: text || null,
      file_url: localUrl,
      file_name: file?.name ?? null,
      sender_id: userId,
      sender: { id: userId } as Profile,
      created_at: new Date().toISOString(),
      pending: true,
      _key: tempId,
      _dims: dims,
    };

    setNewMessage("");
    setSelectedFile(null);
    setMessages(prev => [...prev, optimistic]);
    lastSendTimeRef.current = Date.now();
    setTimeout(() => scrollToBottom(), 50);

    if (sendSoundRef.current) {
      sendSoundRef.current.currentTime = 0;
      sendSoundRef.current.play().catch(() => {});
    }

    try {
      let sent: Message;
      if (file) {
        const uploadResult = await api.uploadFile(file);
        // Свою картинку рисуем из локального файла и после подтверждения —
        // сервер нужен только собеседнику.
        if (localUrl && uploadResult.file_url) {
          localImagesRef.current.set(uploadResult.file_url, localUrl);
        }
        sent = await api.sendMessageWithFile(chatId, {
          file_url: uploadResult.file_url,
          file_name: uploadResult.file_name,
          file_size: uploadResult.file_size,
        }, text || undefined);
      } else {
        sent = await api.sendMessage(chatId, text || null);
      }

      // Подменяем временное сообщение настоящим, сохранив ключ рендера и
      // размеры — DOM не перемонтируется, картинка не мигает.
      setMessages(prev =>
        prev.map(m =>
          m.id === tempId ? { ...m, ...sent, pending: false, _key: tempId, _dims: dims } : m
        )
      );
    } catch (error: any) {
      console.error("Error sending message:", error);
      toast.error("Ошибка отправки: " + (error.message || "Неизвестная ошибка"));
      // Возвращаем черновик, чтобы можно было отправить повторно.
      setMessages(prev => prev.filter(m => m.id !== tempId));
      setNewMessage(text);
      setSelectedFile(file);
      if (localUrl) URL.revokeObjectURL(localUrl);
    }
  };

  // Отправленное с этого устройства берём из локального файла, остальное —
  // с сервера.
  const resolveImageUrl = (fileUrl: string) => {
    if (fileUrl.startsWith("blob:")) return fileUrl; // ещё не отправленное
    return localImagesRef.current.get(fileUrl) ?? mediaUrl(fileUrl);
  };

  // Объектные URL живут до конца сессии страницы — освобождаем при уходе
  // из чата, чтобы память не копилась от фотографий.
  useEffect(() => {
    const map = localImagesRef.current;
    return () => {
      map.forEach((url) => URL.revokeObjectURL(url));
      map.clear();
    };
  }, []);

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

  // Функция для сохранения файла локально (для Electron)
  const handleSaveFile = async (fileUrl: string, fileName: string) => {
    // Проверяем, запущено ли приложение в Electron
    if (typeof window !== 'undefined' && window.electronAPI?.saveFile) {
      try {
        const result = await window.electronAPI.saveFile(fileUrl, fileName);
        if (result.success) {
          toast.success('Файл сохранен');
        } else if (result.canceled) {
          // Пользователь отменил сохранение - ничего не делаем
        } else {
          toast.error('Ошибка сохранения файла: ' + (result.error || 'Неизвестная ошибка'));
        }
      } catch (error) {
        console.error('Error saving file:', error);
        toast.error('Ошибка сохранения файла');
      }
    } else {
      // Fallback: открываем файл в новой вкладке для сохранения вручную
      const link = document.createElement('a');
      link.href = fileUrl;
      link.download = fileName;
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
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
    <div className="flex-1 flex flex-col bg-background min-w-0 min-h-0">
      {onBack && (
        <div className="shrink-0 flex items-center px-4 py-2.5 pad-safe-top border-b border-border bg-card">
          <span className="font-medium truncate">{title || "Чат"}</span>
        </div>
      )}
      {/* Нативный overflow-скролл вместо Radix ScrollArea: min-h-0 позволяет
          ленте ужиматься меньше содержимого (иначе большие сообщения выталкивают
          поле ввода за экран), а scrollTop работает напрямую. */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain chat-scroll px-3 md:px-4 py-4 md:py-6"
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        <div className="max-w-4xl mx-auto space-y-4 md:space-y-6">
          {messages.map((message, index) => {
            const isOwn = message.sender?.id === userId;
            const hasImage =
              !!message.file_url &&
              isImageFile(message.file_name, message.file_url) &&
              !imageLoadErrors.has(message.id);
            // Картинка без текста — сама себе пузырь: без цветной рамки-паспарту,
            // которая раздувала сообщение на пол-экрана.
            const imageOnly = hasImage && !message.content && !message.sticker?.file_url;
            const previousMessage = index > 0 ? messages[index - 1] : null;
            const showDate = shouldShowDate(message, previousMessage);
            const username = message.sender?.username || "Неизвестный";

            return (
              <div
                key={message._key ?? message.id}
                className={cn("space-y-2", message._key && "msg-in")}
              >
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
                    <Identicon
                      id={message.sender?.id || "?"}
                      avatarUrl={message.sender?.avatar_url}
                      className="w-8 h-8"
                    />
                  )}

                  {/* Контент сообщения */}
                  <div className={cn(
                    "flex flex-col max-w-[85%] sm:max-w-[75%] md:max-w-[70%]",
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
                      "relative",
                      !imageOnly && "px-4 py-2",
                      // Свои сообщения алые, входящие зелёные — два цвета
                      // палитры работают как разметка разговора, без подписей.
                      !imageOnly &&
                        (isOwn
                          ? "bg-primary text-primary-foreground"
                          : "bg-success text-success-foreground")
                    )}>
                      {/* Стикер: показываем картинкой без фона пузыря — так же,
                          как это выглядит в мессенджерах. */}
                      {message.sticker?.file_url && (
                        <img
                          src={mediaUrl(message.sticker.file_url)}
                          alt={message.sticker.emoji || "Стикер"}
                          className="w-32 h-32 object-contain"
                          loading="lazy"
                        />
                      )}

                      {/* Текст сообщения */}
                      {message.content && (
                        <p className="break-words leading-relaxed whitespace-pre-wrap">
                          {message.content}
                        </p>
                      )}

                      {/* Файл */}
                      {message.file_url && (
                        <div className={cn(!imageOnly && "mt-2")}>
                          {hasImage ? (
                            // Компактное превью: полноразмерная картинка ломала
                            // прокрутку ленты. Тап — встроенный просмотрщик,
                            // скачивание там, в меню «⋯».
                            <img
                              src={resolveImageUrl(message.file_url)}
                              alt={message.file_name || "Изображение"}
                              loading="lazy"
                              className="max-h-48 max-w-[min(240px,100%)] w-auto object-contain cursor-pointer block"
                              style={message._dims ? previewSize(message._dims) : undefined}
                              onClick={() =>
                                setViewer({
                                  url: resolveImageUrl(message.file_url),
                                  name: message.file_name || "image",
                                })
                              }
                              onError={() => {
                                setImageLoadErrors(prev => new Set(prev).add(message.id));
                              }}
                            />
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
                                href={mediaUrl(message.file_url)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex-1 text-sm truncate hover:underline"
                              >
                                {message.file_name || "Файл"}
                              </a>
                              <button
                                onClick={(e) => {
                                  e.preventDefault();
                                  handleSaveFile(mediaUrl(message.file_url), message.file_name || 'file');
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
                      
                      {/* Статусы: одна галочка — отправляется, две — на сервере. */}
                      {isOwn && (
                        <div className="flex items-center">
                          {message.pending ? (
                            <Check className="w-3 h-3 text-muted-foreground" />
                          ) : (
                            <CheckCheck className="w-3 h-3 text-success" />
                          )}
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
      </div>

      {/* Поле ввода */}
      <div className="p-2 md:p-4 pad-safe-bottom border-t border-border bg-card">
        <div className="max-w-4xl mx-auto">
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
          
          {stickersOpen && (
            <div className="mb-2 rounded-xl border border-border bg-card overflow-hidden">
              <StickerPicker
                onSelect={async (sticker) => {
                  setStickersOpen(false);
                  try {
                    await api.sendMessageWithSticker(chatId!, sticker.id);
                    await fetchMessages();
                  } catch {
                    toast.error("Не удалось отправить стикер");
                  }
                }}
              />
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
              className="h-10 w-10 md:h-11 md:w-11 shrink-0 border-2"
            >
              <Paperclip className="w-4 h-4" />
            </Button>

            <Button
              variant="outline"
              size="icon"
              onClick={() => setStickersOpen((v) => !v)}
              className="h-10 w-10 md:h-11 md:w-11 shrink-0 border-2"
              aria-label="Стикеры"
            >
              <Smile className="w-4 h-4" />
            </Button>
            
            <div className="flex-1 relative">
              <Input
                placeholder="Сообщение..."
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
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
          </div>
        </div>
      </div>

      {viewer && (
        <ImageViewer
          item={viewer}
          onClose={() => setViewer(null)}
          onSave={() => handleSaveFile(viewer.url, viewer.name)}
        />
      )}
    </div>
  );
};


/**
 * Встроенный просмотр изображения, как в мессенджерах: во весь экран поверх
 * чата, закрытие крестиком или тапом по фону, скачивание — в меню «⋯».
 * Раньше тап открывал картинку в браузере — из приложения это выглядит
 * как выброс наружу.
 */
const ImageViewer = ({
  item,
  onClose,
  onSave,
}: {
  item: { url: string; name: string };
  onClose: () => void;
  onSave: () => void;
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div
      className="fixed inset-0 z-50 bg-black flex items-center justify-center"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
      onClick={onClose}
    >
      {/* Шапка: закрыть и меню */}
      <div
        className="absolute inset-x-0 flex items-center justify-between px-3"
        style={{ top: "calc(env(safe-area-inset-top) + 0.5rem)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" onClick={onClose} className="p-2 text-white" aria-label="Закрыть">
          <X className="w-6 h-6" />
        </button>
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="p-2 text-white"
            aria-label="Меню"
          >
            <MoreVertical className="w-6 h-6" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 bg-card border border-border min-w-[160px]">
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onSave();
                }}
                className="w-full flex items-center gap-2 px-4 py-3 text-sm text-left active:bg-secondary"
              >
                <Download className="w-4 h-4" />
                Скачать
              </button>
            </div>
          )}
        </div>
      </div>

      <img
        src={item.url}
        alt=""
        className="max-h-full max-w-full object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
};

export default ChatWindow;