import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh";
import { useIsMobile } from "@/hooks/use-mobile";
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
  Menu
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
  /** title — вычисленное имя собеседника: список чатов его не содержит,
   *  участники грузятся отдельно, поэтому знает о нём только сайдбар. */
  onSelectChat: (chatId: string, title?: string) => void;
  /** Перезагрузка списка — вызывается жестом «потянуть вниз». */
  onRefresh?: () => Promise<unknown> | void;
  selectedChatId: string | null;
  onLogout: () => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onChatDeleted: (chatId: string) => void;
  onChatCreated: () => void;
}

const ChatSidebar = ({ 
  userId, 
  chats,
  onSelectChat,
  onRefresh, 
  selectedChatId, 
  onLogout, 
  isCollapsed, 
  onToggleCollapse,
  onChatDeleted,
  onChatCreated
}: ChatSidebarProps) => {
  const isMobileLayout = useIsMobile();
  const listRef = useRef<HTMLDivElement>(null);
  const { pull, refreshing } = usePullToRefresh(listRef, onRefresh);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  const [currentUser, setCurrentUser] = useState<Profile | null>(null);
  const [chatParticipants, setChatParticipants] = useState<{[chatId: string]: Profile[]}>({});
  const [loadingParticipants, setLoadingParticipants] = useState<{[chatId: string]: boolean}>({});
  const [deletingChats, setDeletingChats] = useState<{[chatId: string]: boolean}>({});

  useEffect(() => {
    console.log("ChatSidebar mounted, userId:", userId);
    fetchCurrentUser();
    loadChatParticipants(chats);
  }, [userId, chats]);

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
    
    setChatParticipants(participantsMap);
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
  const handleSelectChat = (chatId: string, title?: string) => {
    onSelectChat(chatId, title);
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
    <div
      ref={listRef}
      className={`bg-card border-r border-border flex flex-col transition-all duration-300 ${
      isCollapsed ? "w-16" : "w-full md:w-80 lg:w-96"
    }`}>
      {/* Хедер сайдбара */}
      <div className="p-3 md:p-4 pad-safe-top border-b border-border bg-gradient-card">
        <div className="flex items-center justify-between mb-3 md:mb-4">
          {/* Левая часть - кнопки управления */}
          <div className="flex items-center gap-2">
            {/* Сворачивание сайдбара — только для десктопа: на телефоне
                свёрнутого состояния нет, и кнопка ничего не делала. */}
            {!isMobileLayout && (
              <Button
                variant="ghost"
                size="icon"
                onClick={onToggleCollapse}
                className="h-10 w-8"
                title={isCollapsed ? "Развернуть сайдбар" : "Свернуть сайдбар"}
              >
                {isCollapsed ? <Menu className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
              </Button>
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

      {/* Индикатор жеста «потянуть вниз»: следует за пальцем, страницу не двигает */}
      <div
        className="flex items-center justify-center overflow-hidden shrink-0"
        style={{
          height: pull,
          transition: refreshing || pull === 0 ? "height 200ms ease-out" : "none",
        }}
      >
        <RefreshCw
          className={`w-4 h-4 text-primary ${refreshing ? "animate-spin" : ""}`}
          style={{ opacity: Math.min(pull / 60, 1) }}
        />
      </div>

      {/* Список чатов */}
      <ScrollArea className="flex-1">
        <div>
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
                  className={`group relative px-4 py-3 flex items-center gap-3 border-b border-border/60 transition-colors ${
                    selectedChatId === chat.id ? "bg-secondary" : "active:bg-secondary/60"
                  } ${isDeleting ? "opacity-50 pointer-events-none" : ""} ${
                    isCollapsed ? "justify-center" : ""
                  }`}
                >
                  <button
                    onClick={() => handleSelectChat(chat.id, chatTitle)}
                    className={`flex items-center gap-3 text-left ${
                      isCollapsed ? "flex-col justify-center w-full" : "flex-1"
                    }`}
                    disabled={isDeleting}
                    title={isCollapsed ? chatTitle : undefined}
                  >
                    {/* Квадрат вместо круга — супрематизм строится на прямых углах */}
                    <div className="w-12 h-12 shrink-0 flex items-center justify-center bg-primary text-primary-foreground text-lg font-bold">
                      {avatarLetter}
                    </div>
                    
                    {!isCollapsed && (
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="font-semibold truncate">{chatTitle}</p>
                          {chat.updated_at && (
                            <span className="text-[11px] text-muted-foreground shrink-0">
                              {new Date(chat.updated_at).toLocaleTimeString("ru-RU", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center justify-between gap-2 mt-0.5">
                          <p className="text-sm text-muted-foreground truncate">
                            {isLoading
                              ? "Загрузка…"
                              : chat.last_message || "Сообщений пока нет"}
                          </p>
                          {!!chat.unread_count && chat.unread_count > 0 && (
                            <span className="shrink-0 min-w-[20px] h-5 px-1.5 bg-primary text-primary-foreground text-[11px] font-bold flex items-center justify-center">
                              {chat.unread_count > 99 ? "99+" : chat.unread_count}
                            </span>
                          )}
                        </div>
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

      {/* Кнопка выхода в свернутом состоянии (внизу) */}
      {isCollapsed && (
        <div className="p-2 border-t border-border">
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