import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { MessageSquare, Users, Zap } from "lucide-react";

const Index = () => {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-background to-primary/10 overflow-hidden">
      {/* Кастомный скроллбар контейнер */}
      <div className="w-full h-screen overflow-y-auto scrollbar-custom">
        <div className="flex items-center justify-center min-h-full w-full px-4 py-8 sm:py-12 md:py-16">
          <div className="text-center w-full max-w-4xl mx-auto">
            {/* Логотип */}
            <div className="w-16 h-16 sm:w-20 sm:h-20 md:w-24 md:h-24 bg-gradient-primary rounded-2xl sm:rounded-3xl mx-auto mb-6 sm:mb-8 flex items-center justify-center shadow-glow animate-pulse">
              <MessageSquare className="w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 text-primary-foreground" />
            </div>
            
            {/* Заголовок */}
            <h1 className="mb-4 sm:mb-6 text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent px-4">
              ХУЯКС эсемэсэнджер
            </h1>
            
            {/* Описание */}
            <p className="text-base sm:text-lg md:text-xl text-muted-foreground mb-2 sm:mb-4 px-4">
              Современный мессенджер для общения с друзьями
            </p>
            
            {/* Версия */}
            <p className="text-xs sm:text-sm text-muted-foreground/70 mb-8 sm:mb-12 px-4">
              Версия 0.1 beta
            </p>

            {/* Карточки функций */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 mb-8 sm:mb-12 px-4">
              <div className="p-4 sm:p-6 rounded-xl sm:rounded-2xl bg-gradient-card border border-border shadow-card hover:shadow-glow transition-all duration-300">
                <Users className="w-6 h-6 sm:w-8 sm:h-8 text-primary mx-auto mb-2 sm:mb-3" />
                <h3 className="text-sm sm:text-base font-semibold mb-1 sm:mb-2">Добавляйте друзей</h3>
                <p className="text-xs sm:text-sm text-muted-foreground">Находите пользователей и начинайте общение</p>
              </div>
              
              <div className="p-4 sm:p-6 rounded-xl sm:rounded-2xl bg-gradient-card border border-border shadow-card hover:shadow-glow transition-all duration-300">
                <MessageSquare className="w-6 h-6 sm:w-8 sm:h-8 text-primary mx-auto mb-2 sm:mb-3" />
                <h3 className="text-sm sm:text-base font-semibold mb-1 sm:mb-2">Отправляйте сообщения</h3>
                <p className="text-xs sm:text-sm text-muted-foreground">Мгновенная доставка в режиме реального времени</p>
              </div>
              
              <div className="p-4 sm:p-6 rounded-xl sm:rounded-2xl bg-gradient-card border border-border shadow-card hover:shadow-glow transition-all duration-300 sm:col-span-2 lg:col-span-1">
                <Zap className="w-6 h-6 sm:w-8 sm:h-8 text-primary mx-auto mb-2 sm:mb-3" />
                <h3 className="text-sm sm:text-base font-semibold mb-1 sm:mb-2">Делитесь файлами</h3>
                <p className="text-xs sm:text-sm text-muted-foreground">Отправляйте документы, изображения и другие файлы</p>
              </div>
            </div>

            {/* Кнопка */}
            <div className="px-4 mb-8 sm:mb-12">
              <Button
                onClick={() => navigate("/auth")}
                size="lg"
                className="w-full sm:w-auto bg-gradient-primary shadow-glow hover:shadow-glow-lg hover:scale-105 transition-all duration-300 text-base sm:text-lg px-6 sm:px-8 py-5 sm:py-6"
              >
                Начать общение
              </Button>
            </div>

            {/* Дополнительный контент */}
            <div className="mt-8 sm:mt-12 space-y-4 sm:space-y-6 opacity-70 px-4">
              <div className="p-3 sm:p-4 rounded-lg bg-secondary/30 border border-border">
                <p className="text-xs sm:text-sm text-muted-foreground">Быстро • Надежно • Бесплатно</p>
              </div>
              <div className="p-3 sm:p-4 rounded-lg bg-secondary/30 border border-border">
                <p className="text-xs sm:text-sm text-muted-foreground">Работает на всех устройствах</p>
              </div>
              <div className="p-3 sm:p-4 rounded-lg bg-secondary/30 border border-border">
                <p className="text-xs sm:text-sm text-muted-foreground">Шифрование сообщений</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Index;