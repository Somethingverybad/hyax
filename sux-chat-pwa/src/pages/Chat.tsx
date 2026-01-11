import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import ChatSidebar from "@/components/chat/ChatSidebar";
import ChatWindow from "@/components/chat/ChatWindow";
import { api } from "@/api/client";

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

  // Проверка аутентификации и получение профиля
  useEffect(() => {
    const initializeApp = async () => {
      try {
        const profile = await api.getProfile();
        setUser(profile);
        const userChats = await api.getChats();
        setChats(userChats);
      } catch (error) {
        navigate("/auth");
      }
    };
    
    initializeApp();
  }, [navigate]);

  // Автообновление списка чатов
  useEffect(() => {
    if (!user) return;

    // Сразу загружаем чаты при загрузке компонента
    refreshChats();

    // Устанавливаем интервал для автообновления чатов
    const intervalId = setInterval(() => {
      refreshChats();
    }, 5000); // Обновляем каждые 5 секунд

    return () => {
      clearInterval(intervalId);
    };
  }, [user]);

  // Обработчик состояния приложения (visibility change для PWA)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // При возвращении видимости обновляем данные
        refreshChats();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Функция обновления списка чатов
  const refreshChats = async () => {
    if (!user) return;
    
    try {
      const userChats = await api.getChats();
      
      // Обновляем состояние только если данные изменились
      if (JSON.stringify(userChats) !== JSON.stringify(chats)) {
        setChats(userChats);
        
        // Логируем обновление для отладки
        console.log('Chats updated:', userChats.length, 'chats');
      }
    } catch (error) {
      console.error('Error refreshing chats:', error);
    }
  };

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

  if (!user) return null;

  return (
    <div className="h-screen flex bg-background">
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
