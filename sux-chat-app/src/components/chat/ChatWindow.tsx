import { useEffect, useState, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, Paperclip, X, Check, CheckCheck } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { api } from "@/api/client";
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
  sender_id: string;
  sender?: Profile;
  created_at: string;
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
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

  const sendMessage = async () => {
    if (!chatId || (!newMessage.trim() && !selectedFile)) return;

    setUploading(true);

    try {
      let fileUrl: string | null = null;
      let fileName: string | null = null;

      if (selectedFile) {
        toast.info("Загрузка файлов временно недоступна");
        setSelectedFile(null);
        setUploading(false);
        return;
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

      await api.sendMessage(chatId, newMessage.trim() || null);
      setNewMessage("");
      setSelectedFile(null);

      // Прокручиваем вниз сразу после отправки
      setTimeout(() => {
        scrollToBottom();
      }, 50);

      // Обновляем сообщения через небольшой интервал
      setTimeout(() => fetchMessages(), 500);
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
    <div className="flex-1 flex flex-col bg-background">
      <ScrollArea className="flex-1 px-4 py-6" ref={scrollRef as any}>
        <div className="max-w-4xl mx-auto space-y-6">
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
                            "bg-card border border-border/50 shadow-sm",
                            "rounded-bl-md"
                          )
                    )}>
                      {/* Текст сообщения */}
                      {message.content && (
                        <p className="break-words leading-relaxed whitespace-pre-wrap">
                          {message.content}
                        </p>
                      )}

                      {/* Файл */}
                      {message.file_url && (
                        <a 
                          href={message.file_url} 
                          target="_blank" 
                          rel="noopener noreferrer" 
                          className={cn(
                            "flex items-center gap-2 mt-2 p-2 rounded-lg border transition-colors",
                            isOwn
                              ? "bg-primary/20 border-primary/30 hover:bg-primary/30"
                              : "bg-muted border-border hover:bg-muted/80"
                          )}
                        >
                          <Paperclip className="w-3 h-3 flex-shrink-0" />
                          <span className="text-sm truncate max-w-[200px]">
                            {message.file_name || "Файл"}
                          </span>
                        </a>
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
  );
};

export default ChatWindow;