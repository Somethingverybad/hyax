import { useEffect, useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { 
  MessageSquare, 
  UserPlus, 
  LogOut, 
  X,
  ChevronLeft,
  Menu,
  Bell,
  BellOff
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { api } from "@/api/client";

interface Profile {
  id: string;
  username: string;
  avatar_url?: string;
}

interface Chat {
  id: string;
  participants?: Profile[];
  created_at?: string;
}

interface ChatSidebarProps {
  userId: string;
  chats: Chat[];
  onSelectChat: (chatId: string) => void;
  selectedChatId: string | null;
  onLogout: () => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onChatDeleted: (chatId: string) => void;
  onChatCreated: () => void;
  onRequestNotificationPermission?: () => Promise<boolean>;
  notificationPermission?: NotificationPermission;
  onTestNotification?: () => void;
}

const ChatSidebar = ({ 
  userId, 
  chats,
  onSelectChat, 
  selectedChatId, 
  onLogout, 
  isCollapsed, 
  onToggleCollapse,
  onChatDeleted,
  onChatCreated,
  onRequestNotificationPermission,
  notificationPermission = 'default',
  onTestNotification
}: ChatSidebarProps) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  const [currentUser, setCurrentUser] = useState<Profile | null>(null);
  const [chatParticipants, setChatParticipants] = useState<{[chatId: string]: Profile[]}>({});
  const [loadingParticipants, setLoadingParticipants] = useState<{[chatId: string]: boolean}>({});
  const [deletingChats, setDeletingChats] = useState<{[chatId: string]: boolean}>({});
  const [requestingPermission, setRequestingPermission] = useState(false);

  // Загружаем профиль пользователя один раз при монтировании
  useEffect(() => {
    console.log("ChatSidebar mounted, userId:", userId);
    fetchCurrentUser();
  }, [userId]);

  // Загружаем участников чатов только при изменении списка чатов (по ID, не по всему объекту)
  const chatsIdsRef = useRef<string>('');
  const loadingParticipantsRef = useRef(false);
  
  useEffect(() => {
    const currentChatsIds = chats.map(c => c.id).sort().join(',');
    // Загружаем только если список чатов реально изменился и не загружается уже
    if (currentChatsIds !== chatsIdsRef.current && !loadingParticipantsRef.current) {
      chatsIdsRef.current = currentChatsIds;
      if (chats.length > 0) {
        // Загружаем только тех участников, которых еще нет
        const chatsToLoad = chats.filter(chat => !chatParticipants[chat.id]);
        if (chatsToLoad.length > 0) {
          loadingParticipantsRef.current = true;
          loadChatParticipants(chatsToLoad).finally(() => {
            loadingParticipantsRef.current = false;
          });
        }
      }
    }
  }, [chats, chatParticipants]);

  const fetchCurrentUser = async () => {
    try {
      console.log("Fetching current user profile...");
      const profile = await api.getCurrentUser();
      console.log("Current user profile:", profile);
      
      if (profile && profile.id) {
        setCurrentUser(profile);
      } else {
        console.warn("No valid user profile found");
      }
    } catch (error: any) {
      console.error("Error fetching current user profile:", error);
      toast.error("Не удалось загрузить профиль");
    }
  };

  // Загружаем участников для всех чатов
  const loadChatParticipants = async (chatsArray: Chat[]) => {
    if (chatsArray.length === 0) {
      return;
    }
    
    const participantsMap: {[chatId: string]: Profile[]} = {};
    const loadingMap: {[chatId: string]: boolean} = {};
    
    chatsArray.forEach(chat => {
      loadingMap[chat.id] = true;
    });
    setLoadingParticipants(loadingMap);
    
    for (const chat of chatsArray) {
      try {
        console.log(`Loading participants for chat ${chat.id}...`);
        const participants = await api.getChatParticipants(chat.id);
        console.log(`Participants for ${chat.id}:`, participants);
        
        participantsMap[chat.id] = Array.isArray(participants) ? participants : [];
      } catch (error) {
        console.error(`Error loading participants for chat ${chat.id}:`, error);
        participantsMap[chat.id] = [];
      }
    }
    
    // Обновляем только новые участники, сохраняя старые
    setChatParticipants(prev => ({ ...prev, ...participantsMap }));
    setLoadingParticipants({});
  };

  const searchUsers = async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    try {
      console.log("Searching users with query:", query);
      const results = await api.searchUsers(query);
      console.log("Search results:", results);
      setSearchResults(Array.isArray(results) ? results : []);
    } catch (error: any) {
      console.error("Error searching users:", error);
    }
  };

  const createChat = async (friendId: string) => {
    try {
      console.log("Creating chat with friendId:", friendId);
      const chat = await api.createDirectChat(friendId);
      toast.success("Чат создан!");
      
      onChatCreated();
      handleSelectChat(chat.id);
      
    } catch (error: any) {
      console.error("Error creating chat:", error);
      if (error?.message === "exists") {
        toast.success("Чат уже существует");
        handleSelectChat(error.chatId);
      } else {
        toast.error("Ошибка создания чата");
      }
    }
  };

  // Функция удаления чата
  const deleteChat = async (chatId: string, chatTitle: string) => {
    if (!confirm(`Вы уверены, что хотите удалить чат "${chatTitle}"?`)) {
      return;
    }

    try {
      setDeletingChats(prev => ({ ...prev, [chatId]: true }));
      
      console.log(`Deleting chat ${chatId}...`);
      await api.deleteChat(chatId);
      
      toast.success("Чат удален");
      onChatDeleted(chatId);
      
    } catch (error: any) {
      console.error("Error deleting chat:", error);
      toast.error("Не удалось удалить чат");
    } finally {
      setDeletingChats(prev => ({ ...prev, [chatId]: false }));
    }
  };

  // Обработчик выбора чата - сворачиваем сайдбар
  const handleSelectChat = (chatId: string) => {
    onSelectChat(chatId);
    if (!isCollapsed) {
      setTimeout(() => onToggleCollapse(), 300);
    }
  };

  // Получаем участников для конкретного чата
  const getChatParticipants = (chatId: string): Profile[] => {
    return chatParticipants[chatId] || [];
  };

  // Проверяем, загружаются ли участники для чата
  const isLoadingParticipants = (chatId: string): boolean => {
    return loadingParticipants[chatId] === true;
  };

  // Проверяем, удаляется ли чат
  const isDeletingChat = (chatId: string): boolean => {
    return deletingChats[chatId] === true;
  };

  return (
    <div className={`bg-card border-r border-border flex flex-col transition-all duration-300 ${
      isCollapsed ? "w-16" : "w-full md:w-80 lg:w-96"
    }`}>
      {/* Хедер сайдбара */}
      <div className="border-b border-border bg-gradient-card" style={{ 
        paddingTop: 'max(12px, calc(12px + var(--safe-top, 0px)))',
        paddingBottom: '12px',
        paddingLeft: '12px',
        paddingRight: '12px'
      }}>
        <div className="flex items-center justify-between mb-3 md:mb-4">
          {/* Левая часть - кнопки управления */}
          <div className="flex items-center gap-2">
            {/* Кнопка сворачивания/разворачивания */}
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={onToggleCollapse}
              className="h-8 w-8 md:h-10 md:w-8"
              title={isCollapsed ? "Развернуть сайдбар" : "Свернуть сайдбар"}
            >
              {isCollapsed ? (
                <Menu className="w-4 h-4" />
              ) : (
                <ChevronLeft className="w-4 h-4" />
              )}
            </Button>
            
            {/* Кнопка уведомлений (скрываем в свернутом состоянии, показываем только если разрешение не получено) */}
            {!isCollapsed && onRequestNotificationPermission && notificationPermission !== 'granted' && (
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={async () => {
                  setRequestingPermission(true);
                  try {
                    await onRequestNotificationPermission();
                  } catch (error) {
                    console.error('Ошибка при запросе разрешения на уведомления:', error);
                  } finally {
                    setRequestingPermission(false);
                  }
                }}
                disabled={requestingPermission}
                title={notificationPermission === 'denied' ? 'Уведомления запрещены' : 'Включить уведомления'}
                className="h-8 w-8"
              >
                {notificationPermission === 'denied' ? (
                  <BellOff className="w-4 h-4" />
                ) : (
                  <Bell className="w-4 h-4" />
                )}
              </Button>
            )}
            
            {/* Кнопка тестового уведомления (показываем только если разрешение получено) */}
            {!isCollapsed && notificationPermission === 'granted' && onTestNotification && (
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => {
                  console.log('[ChatSidebar] Тестовая кнопка нажата, permission:', notificationPermission);
                  onTestNotification();
                }}
                title="Тестовое уведомление"
                className="h-8 w-8"
              >
                <Bell className="w-4 h-4 text-green-500" />
              </Button>
            )}
            
            {/* Отладочная информация (временно) - показываем всегда для отладки */}
            {!isCollapsed && (
              <div className="text-xs text-muted-foreground px-2 py-1 border-t border-border mt-2 pt-2">
                <div>Permission: {notificationPermission}</div>
                <div>Has func: {onTestNotification ? 'yes' : 'no'}</div>
                <div>Is granted: {notificationPermission === 'granted' ? 'yes' : 'no'}</div>
                {notificationPermission === 'granted' && onTestNotification && (
                  <div className="text-green-500 mt-1">✅ Кнопка должна быть видна!</div>
                )}
              </div>
            )}
            
            {/* Кнопка выхода (скрываем в свернутом состоянии) */}
            {!isCollapsed && (
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={onLogout} 
                title="Выйти"
                className="h-8 w-8"
              >
                <LogOut className="w-4 h-4" />
              </Button>
            )}
          </div>

          {/* Центральная часть - информация о пользователе (скрываем в свернутом состоянии) */}
          {!isCollapsed && (
            <div className="flex items-center gap-3 flex-1 justify-center">
              {/* Стилизованная буква Х */}
              <div className="w-10 h-10 bg-gradient-primary rounded-xl flex items-center justify-center shadow-glow relative flex-shrink-0">
                <div className="relative">
                  <span className="text-lg font-black text-primary-foreground select-none">
                    Х
                  </span>
                  <div className="absolute inset-0 text-lg font-black text-primary-foreground/30 blur-sm">
                    Х
                  </div>
                </div>
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground truncate">
                  {currentUser?.username || "Загрузка..."}
                </p>
              </div>
            </div>
          )}

          {/* Правая часть - пустая для баланса */}
          {!isCollapsed && <div className="w-16"></div>}
        </div>

        {/* Кнопка нового чата (скрываем в свернутом состоянии) */}
        {!isCollapsed && (
          <Dialog>
            <DialogTrigger asChild>
              <Button className="w-full bg-gradient-primary shadow-glow hover:shadow-glow-lg transition-all">
                <UserPlus className="w-4 h-4 mr-2" />
                Новый чат
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border">
              <DialogHeader>
                <DialogTitle>Найти пользователя</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <Input
                  placeholder="Введите имя пользователя..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    searchUsers(e.target.value);
                  }}
                  className="bg-secondary/50"
                />
                <ScrollArea className="h-64">
                  <div className="space-y-2">
                    {searchResults.length > 0 ? (
                      searchResults.map((user) => (
                        <div
                          key={user.id}
                          className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 hover:bg-secondary cursor-pointer transition-colors"
                          onClick={() => createChat(user.id)}
                        >
                          <div className="flex items-center gap-3">
                            <Avatar>
                              <AvatarFallback className="bg-gradient-primary text-primary-foreground">
                                {user.username?.[0]?.toUpperCase() || "?"}
                              </AvatarFallback>
                            </Avatar>
                            <span className="font-medium">{user.username}</span>
                          </div>
                          <UserPlus className="w-4 h-4 text-muted-foreground" />
                        </div>
                      ))
                    ) : (
                      <div className="text-center text-muted-foreground py-8">
                        {searchQuery ? "Пользователи не найдены" : "Введите имя для поиска"}
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Список чатов */}
      <ScrollArea className="flex-1">
        <div className="p-2">
          {chats.length > 0 ? (
            chats.map((chat) => {
              console.log("Rendering chat:", chat);
              
              const participants = getChatParticipants(chat.id);
              const isLoading = isLoadingParticipants(chat.id);
              const isDeleting = isDeletingChat(chat.id);
              const otherParticipants = participants.filter(p => p.id !== currentUser?.id);
              const displayParticipants = otherParticipants.length > 0 ? otherParticipants : participants;
              
              // Формируем название чата
              let chatTitle = "Без названия";
              
              if (displayParticipants.length > 0) {
                const names = displayParticipants.map(p => p.username).filter(Boolean);
                chatTitle = names.join(", ") || "Без названия";
              } else if (participants.length === 0) {
                chatTitle = `Чат ${chat.id.slice(0, 8)}...`;
              }
              
              const avatarLetter = chatTitle[0]?.toUpperCase() || "?";

              return (
                <div
                  key={chat.id}
                  className={`group relative p-3 rounded-lg mb-2 flex items-center gap-3 transition-all ${
                    selectedChatId === chat.id
                      ? "bg-gradient-primary shadow-glow"
                      : "hover:bg-secondary/50"
                  } ${isDeleting ? "opacity-50 pointer-events-none" : ""} ${
                    isCollapsed ? "justify-center" : ""
                  }`}
                >
                  <button
                    onClick={() => handleSelectChat(chat.id)}
                    className={`flex items-center gap-3 text-left ${
                      isCollapsed ? "flex-col justify-center w-full" : "flex-1"
                    }`}
                    disabled={isDeleting}
                    title={isCollapsed ? chatTitle : undefined}
                  >
                    <Avatar className={isCollapsed ? "w-8 h-8" : "w-8 h-8"}>
                      <AvatarFallback 
                        className={
                          selectedChatId === chat.id 
                            ? "bg-white text-primary" 
                            : "bg-gradient-primary text-primary-foreground"
                        }
                      >
                        {avatarLetter}
                      </AvatarFallback>
                    </Avatar>
                    
                    {!isCollapsed && (
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">
                          {chatTitle}
                        </p>
                        {isLoading && (
                          <p className="text-xs text-muted-foreground">
                            Загрузка...
                          </p>
                        )}
                        {!isLoading && displayParticipants.length === 0 && (
                          <p className="text-xs text-muted-foreground">
                            Нет участников
                          </p>
                        )}
                      </div>
                    )}
                  </button>

                  {/* Кнопка удаления чата (скрываем в свернутом состоянии) */}
                  {!isCollapsed && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteChat(chat.id, chatTitle);
                      }}
                      className="h-6 w-6 opacity-0 group-hover:opacity-70 hover:opacity-100 hover:bg-destructive/10 hover:text-destructive transition-all"
                      disabled={isDeleting}
                      title="Удалить чат"
                    >
                      {isDeleting ? (
                        <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <X className="h-3 w-3" />
                      )}
                    </Button>
                  )}

                  {/* Индикатор загрузки при удалении */}
                  {isDeleting && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/50 rounded-lg">
                      <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <div className={`text-center text-muted-foreground py-8 ${
              isCollapsed ? "px-2 text-xs" : "px-4"
            }`}>
              {isCollapsed ? "Нет чатов" : "Нет чатов. Создайте первый чат!"}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Кнопки в свернутом состоянии (внизу) */}
      {isCollapsed && (
        <div className="border-t border-border space-y-2" style={{ 
          paddingTop: '8px',
          paddingBottom: 'max(8px, calc(8px + var(--safe-bottom, 0px)))',
          paddingLeft: '8px',
          paddingRight: '8px'
        }}>
          {/* Кнопка уведомлений - показываем только если разрешение не получено */}
          {onRequestNotificationPermission && notificationPermission !== 'granted' && (
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={async () => {
                setRequestingPermission(true);
                try {
                  await onRequestNotificationPermission();
                } catch (error) {
                  console.error('Ошибка при запросе разрешения на уведомления:', error);
                } finally {
                  setRequestingPermission(false);
                }
              }}
              disabled={requestingPermission}
              className="w-full h-10"
              title={notificationPermission === 'denied' ? 'Уведомления запрещены' : 'Включить уведомления'}
            >
              {notificationPermission === 'denied' ? (
                <BellOff className="w-4 h-4" />
              ) : (
                <Bell className="w-4 h-4" />
              )}
            </Button>
          )}
          
          {/* Кнопка тестового уведомления (в мобильном меню) */}
          {notificationPermission === 'granted' && onTestNotification && (
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={onTestNotification}
              className="w-full h-10"
              title="Тестовое уведомление"
            >
              <Bell className="w-4 h-4 mr-2 text-green-500" />
              Тестовое уведомление
            </Button>
          )}
          
          {/* Кнопка выхода */}
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={onLogout}
            className="w-full h-10"
            title="Выйти"
          >
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      )}
    </div>
  );
};

export default ChatSidebar;