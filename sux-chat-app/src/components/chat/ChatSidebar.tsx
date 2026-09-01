import { useEffect, useRef, useState } from "react";
import Identicon from "@/components/Identicon";
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
  Menu,
  Users,
  Check,
  Trash2
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { api, mediaUrl } from "@/api/client";
import { readCache, writeCache } from "@/lib/session-cache";

interface Profile {
  id: string;
  username: string;
  avatar_url?: string;
}

interface Chat {
  id: string;
  name?: string;
  is_group?: boolean;
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
  onOpenProfile?: () => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onChatDeleted: (chatId: string) => void;
  onChatCreated: () => void;
}

// Кеш участников переживает перезапуск приложения: имена в списке чатов
// появляются сразу, без ожидания сети. Ключ отдельный от токенов, чтобы
// чистка сессии его не задевала.
const PARTICIPANTS_CACHE_KEY = "chat_participants_cache";

function readParticipantsCache(): {[chatId: string]: any[]} {
  try {
    return JSON.parse(localStorage.getItem(PARTICIPANTS_CACHE_KEY) || "{}");
  } catch {
    return {};
  }
}

function writeParticipantsCache(map: {[chatId: string]: any[]}) {
  try {
    localStorage.setItem(PARTICIPANTS_CACHE_KEY, JSON.stringify(map));
  } catch {
    // Переполнено или недоступно — не критично, просто не кешируем.
  }
}

const ChatSidebar = ({ 
  userId, 
  chats,
  onSelectChat,
  onRefresh, 
  selectedChatId, 
  onLogout,
  onOpenProfile,
  
  isCollapsed, 
  onToggleCollapse,
  onChatDeleted,
  onChatCreated
}: ChatSidebarProps) => {
  const isMobileLayout = useIsMobile();
  const listRef = useRef<HTMLDivElement>(null);
  const { pull, refreshing } = usePullToRefresh(listRef, onRefresh);
  const [searchQuery, setSearchQuery] = useState("");
  // Групповой режим диалога «Новый чат»: копим выбранных участников и имя.
  const [groupMode, setGroupMode] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupMembers, setGroupMembers] = useState<Profile[]>([]);
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  // Профиль берём из кеша сразу: сеть только обновляет его. Иначе при каждом
  // возврате из чата шапка показывала «Загрузка…», хотя данные уже известны.
  const [currentUser, setCurrentUser] = useState<Profile | null>(
    () => readCache<Profile>("user")
  );
  const [chatParticipants, setChatParticipants] = useState<{[chatId: string]: Profile[]}>({});
  const [loadingParticipants, setLoadingParticipants] = useState<{[chatId: string]: boolean}>({});
  const [deletingChats, setDeletingChats] = useState<{[chatId: string]: boolean}>({});
  // Удаление чата: десктоп — меню по правому клику у курсора; телефон —
  // свайп влево открывает красную кнопку.
  const [chatMenu, setChatMenu] = useState<{ x: number; y: number; chatId: string; title: string } | null>(null);
  const [swipedChatId, setSwipedChatId] = useState<string | null>(null);
  const swipeStartRef = useRef<{ x: number; y: number; id: string } | null>(null);

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
        writeCache("user", profile);
      } else {
        console.warn("No valid user profile found");
      }
    } catch (error: any) {
      console.error("Error fetching current user profile:", error);
      // Молчим, если профиль уже показан из кеша: ругаться на фоновое
      // обновление незачем, пользователь видит рабочий экран.
      if (!currentUser) toast.error("Не удалось загрузить профиль");
    }
  };

  // Загружаем участников для всех чатов.
  //
  // Участники приходят отдельным запросом на каждый чат, поэтому до их ответа
  // в списке вместо имени показывался идентификатор — при каждом открытии
  // приложения. Кешируем их локально: список рисуется мгновенно из кеша, а
  // сеть только обновляет данные в фоне.
  const loadChatParticipants = async (chatsArray: Chat[]) => {
    const cached = readParticipantsCache();
    const participantsMap: {[chatId: string]: Profile[]} = { ...cached };
    const loadingMap: {[chatId: string]: boolean} = {};

    // Показываем кеш сразу и помечаем загрузкой только то, чего в нём нет —
    // иначе известные чаты моргали бы надписью «Загрузка».
    if (Object.keys(cached).length > 0) {
      setChatParticipants(cached);
    }
    chatsArray.forEach(chat => {
      if (!cached[chat.id]) loadingMap[chat.id] = true;
    });
    setLoadingParticipants(loadingMap);

    for (const chat of chatsArray) {
      // Сервер отдаёт участников прямо в списке чатов — отдельный запрос нужен
      // только старым версиям бэкенда, где этого поля ещё нет.
      const inline = (chat as any).participants;
      if (Array.isArray(inline)) {
        participantsMap[chat.id] = inline;
        continue;
      }
      try {
        const participants = await api.getChatParticipants(chat.id);
        participantsMap[chat.id] = Array.isArray(participants) ? participants : [];
      } catch (error) {
        console.error(`Error loading participants for chat ${chat.id}:`, error);
        // Ошибку сети кешем не перетираем: старые имена лучше пустоты.
        participantsMap[chat.id] = participantsMap[chat.id] || [];
      }
    }

    setChatParticipants(participantsMap);
    setLoadingParticipants({});
    writeParticipantsCache(participantsMap);
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

  const toggleGroupMember = (user: Profile) => {
    setGroupMembers((prev) =>
      prev.some((m) => m.id === user.id)
        ? prev.filter((m) => m.id !== user.id)
        : [...prev, user]
    );
  };

  const resetDialog = () => {
    setGroupMode(false);
    setGroupName("");
    setGroupMembers([]);
    setSearchQuery("");
    setSearchResults([]);
  };

  const createGroup = async () => {
    if (groupMembers.length < 2) {
      toast.error("Выберите хотя бы двух участников");
      return;
    }
    try {
      const chat = await api.createChat(
        groupMembers.map((m) => m.id),
        { name: groupName.trim() || groupMembers.map((m) => m.username).join(", ") }
      );
      toast.success("Группа создана");
      resetDialog();
      onChatCreated();
      handleSelectChat(chat.id, chat.name || "Группа");
    } catch {
      toast.error("Не удалось создать группу");
    }
  };

  // Функция удаления чата
  const deleteChat = async (chatId: string, chatTitle: string, skipConfirm = false) => {
    setChatMenu(null);
    setSwipedChatId(null);
    if (!skipConfirm && !confirm(`Вы уверены, что хотите удалить чат "${chatTitle}"?`)) {
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
            <button
              type="button"
              onClick={onOpenProfile}
              disabled={!onOpenProfile}
              className="flex items-center gap-3 flex-1 justify-center rounded-lg px-2 py-1 hover:bg-secondary/60 transition-colors disabled:hover:bg-transparent"
              title="Профиль"
            >
              <Identicon
                id={currentUser?.id || "?"}
                avatarUrl={currentUser?.avatar_url}
                className="w-10 h-10"
              />
              <div className="min-w-0 text-left">
                <p className="text-xs text-muted-foreground truncate">
                  {currentUser?.username || "Загрузка..."}
                </p>
              </div>
            </button>
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
                <DialogTitle>{groupMode ? "Новая группа" : "Найти пользователя"}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={groupMode ? "outline" : "default"}
                    className="flex-1"
                    onClick={() => setGroupMode(false)}
                  >
                    Личный чат
                  </Button>
                  <Button
                    type="button"
                    variant={groupMode ? "default" : "outline"}
                    className="flex-1"
                    onClick={() => setGroupMode(true)}
                  >
                    <Users className="w-4 h-4 mr-2" />
                    Группа
                  </Button>
                </div>

                {groupMode && (
                  <>
                    <Input
                      placeholder="Название группы"
                      value={groupName}
                      onChange={(e) => setGroupName(e.target.value)}
                      className="bg-secondary/50"
                    />
                    {groupMembers.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {groupMembers.map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => toggleGroupMember(m)}
                            className="px-2 py-1 text-xs bg-primary text-primary-foreground flex items-center gap-1"
                          >
                            {m.username}
                            <X className="w-3 h-3" />
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}

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
                          onClick={() => (groupMode ? toggleGroupMember(user) : createChat(user.id))}
                        >
                          <div className="flex items-center gap-3">
                            <Avatar>
                              <AvatarFallback className="bg-gradient-primary text-primary-foreground">
                                {user.username?.[0]?.toUpperCase() || "?"}
                              </AvatarFallback>
                            </Avatar>
                            <span className="font-medium">{user.username}</span>
                          </div>
                          {groupMode && groupMembers.some((m) => m.id === user.id) ? (
                            <Check className="w-4 h-4 text-primary" />
                          ) : (
                            <UserPlus className="w-4 h-4 text-muted-foreground" />
                          )}
                        </div>
                      ))
                    ) : (
                      <div className="text-center text-muted-foreground py-8">
                        {searchQuery ? "Пользователи не найдены" : "Введите имя для поиска"}
                      </div>
                    )}
                  </div>
                </ScrollArea>

                {groupMode && (
                  <Button
                    type="button"
                    onClick={createGroup}
                    disabled={groupMembers.length < 2}
                    className="w-full bg-gradient-primary"
                  >
                    Создать группу ({groupMembers.length})
                  </Button>
                )}
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
              let chatTitle = chat.is_group ? (chat.name || "Группа") : "Без названия";
              
              if (chat.is_group) {
                // название уже задано
              } else if (displayParticipants.length > 0) {
                const names = displayParticipants.map(p => p.username).filter(Boolean);
                chatTitle = names.join(", ") || "Без названия";
              } else if (participants.length === 0) {
                chatTitle = `Чат ${chat.id.slice(0, 8)}...`;
              }

              return (
                <div
                  key={chat.id}
                  className="relative border-b border-border/60 overflow-hidden"
                >
                  {/* Красная кнопка удаления — открывается свайпом влево (телефон) */}
                  <button
                    type="button"
                    onClick={() => deleteChat(chat.id, chatTitle, true)}
                    className="absolute inset-y-0 right-0 w-20 bg-destructive text-white flex items-center justify-center"
                    tabIndex={swipedChatId === chat.id ? 0 : -1}
                    aria-label="Удалить чат"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>

                  {/* Содержимое строки: ездит по свайпу, правый клик → меню */}
                  <div
                    className={`group relative px-4 py-3 flex items-center gap-3 transition-transform ${
                      selectedChatId === chat.id ? "bg-secondary" : "bg-card active:bg-secondary/60"
                    } ${isDeleting ? "opacity-50 pointer-events-none" : ""} ${
                      isCollapsed ? "justify-center" : ""
                    }`}
                    style={{ transform: swipedChatId === chat.id ? "translateX(-80px)" : "translateX(0)" }}
                    onContextMenu={(e) => {
                      if (isCollapsed) return;
                      e.preventDefault();
                      setChatMenu({ x: e.clientX, y: e.clientY, chatId: chat.id, title: chatTitle });
                    }}
                    onTouchStart={(e) => {
                      swipeStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, id: chat.id };
                    }}
                    onTouchEnd={(e) => {
                      const s = swipeStartRef.current;
                      swipeStartRef.current = null;
                      if (!s || s.id !== chat.id || isCollapsed) return;
                      const t = e.changedTouches[0];
                      const dx = t.clientX - s.x, dy = t.clientY - s.y;
                      if (Math.abs(dx) > Math.abs(dy) * 1.5) {
                        if (dx < -45) setSwipedChatId(chat.id);
                        else if (dx > 25) setSwipedChatId(null);
                      }
                    }}
                  >
                  <button
                    onClick={() => {
                      if (swipedChatId === chat.id) { setSwipedChatId(null); return; }
                      handleSelectChat(chat.id, chatTitle);
                    }}
                    className={`flex items-center gap-3 text-left ${
                      isCollapsed ? "flex-col justify-center w-full" : "flex-1"
                    }`}
                    disabled={isDeleting}
                    title={isCollapsed ? chatTitle : undefined}
                  >
                    {chat.is_group ? (
                      (chat as any).avatar_url ? (
                        <img
                          src={mediaUrl((chat as any).avatar_url)}
                          alt=""
                          className="w-12 h-12 shrink-0 object-cover"
                        />
                      ) : (
                        <div className="w-12 h-12 shrink-0 bg-secondary flex items-center justify-center">
                          <Users className="w-6 h-6 text-primary" />
                        </div>
                      )
                    ) : (
                      <Identicon
                        id={displayParticipants[0]?.id || chat.id}
                        avatarUrl={displayParticipants[0]?.avatar_url}
                        className="w-12 h-12"
                      />
                    )}
                    
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
                          <p className="text-sm text-muted-foreground truncate flex-1 min-w-0">
                            {isLoading
                              ? "Загрузка…"
                              : (chat as any).last_message
                                ? `${(chat as any).last_message.sender_id === currentUser?.id ? "Вы: " : ""}${(chat as any).last_message.text}`
                                : "Сообщений пока нет"}
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

                  {/* Индикатор загрузки при удалении */}
                  {isDeleting && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/50">
                      <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                  </div>
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

      {/* Меню чата по правому клику (десктоп) */}
      {chatMenu && (
        <div
          className="fixed inset-0 z-[80]"
          onClick={() => setChatMenu(null)}
          onContextMenu={(e) => { e.preventDefault(); setChatMenu(null); }}
        >
          <div
            className="fixed min-w-[170px] bg-card border-2 border-border shadow-xl py-1"
            style={{
              left: Math.max(8, Math.min(chatMenu.x, window.innerWidth - 188)),
              top: Math.max(8, Math.min(chatMenu.y, window.innerHeight - 60)),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => deleteChat(chatMenu.chatId, chatMenu.title)}
              className="w-full px-4 py-2 text-left text-sm text-destructive hover:bg-secondary flex items-center gap-2"
            >
              <Trash2 className="w-4 h-4" />
              Удалить чат
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatSidebar;