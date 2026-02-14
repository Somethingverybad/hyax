import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { MessageSquare, Users, Zap } from "lucide-react";

const Index = () => {
  const navigate = useNavigate();

  return (
    <div className="flex h-full w-full min-w-0 items-center justify-center bg-gradient-to-br from-background via-background to-primary/10 overflow-hidden overflow-x-hidden">
      {/* Кастомный скроллбар контейнер */}
      <div className="w-full h-full overflow-y-auto overflow-x-hidden scrollbar-custom flex items-center justify-center min-w-0">
        <div className="text-center max-w-2xl w-full min-w-0 px-3 md:px-4 py-6 md:py-8 mx-auto box-border">
          <div className="w-20 h-20 md:w-24 md:h-24 bg-gradient-primary rounded-2xl md:rounded-3xl mx-auto mb-6 md:mb-8 flex items-center justify-center shadow-glow animate-pulse">
            <MessageSquare className="w-10 h-10 md:w-12 md:h-12 text-primary-foreground" />
          </div>
          
          <h1 className="mb-4 md:mb-6 text-2xl sm:text-3xl md:text-6xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent break-words">
            ХУЯКС эсемэсэнджер
          </h1>
          
          <p className="text-base md:text-xl text-muted-foreground mb-8 md:mb-12">
            Современный мессенджер для общения с друзьями
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 mb-8 md:mb-12">
            <div className="p-4 md:p-6 rounded-xl md:rounded-2xl bg-gradient-card border border-border shadow-card hover:shadow-glow transition-all duration-300">
              <Users className="w-6 h-6 md:w-8 md:h-8 text-primary mx-auto mb-2 md:mb-3" />
              <h3 className="font-semibold mb-1 md:mb-2 text-sm md:text-base">Добавляйте друзей</h3>
              <p className="text-xs md:text-sm text-muted-foreground">Находите пользователей и начинайте общение</p>
            </div>
            
            <div className="p-4 md:p-6 rounded-xl md:rounded-2xl bg-gradient-card border border-border shadow-card hover:shadow-glow transition-all duration-300">
              <MessageSquare className="w-6 h-6 md:w-8 md:h-8 text-primary mx-auto mb-2 md:mb-3" />
              <h3 className="font-semibold mb-1 md:mb-2 text-sm md:text-base">Отправляйте сообщения</h3>
              <p className="text-xs md:text-sm text-muted-foreground">Мгновенная доставка сообщений товарищу майонру в режиме реального времени</p>
            </div>
            
            <div className="p-4 md:p-6 rounded-xl md:rounded-2xl bg-gradient-card border border-border shadow-card hover:shadow-glow transition-all duration-300">
              <Zap className="w-6 h-6 md:w-8 md:h-8 text-primary mx-auto mb-2 md:mb-3" />
              <h3 className="font-semibold mb-1 md:mb-2 text-sm md:text-base">Делитесь файлами</h3>
              <p className="text-xs md:text-sm text-muted-foreground">Отправляйте документы, изображения и другие файлы. Все посмотрим, все прочитаем</p>
            </div>
          </div>

          <Button
            onClick={() => navigate("/auth")}
            size="lg"
            className="bg-gradient-primary shadow-glow hover:shadow-glow-lg hover:scale-105 transition-all duration-300 text-base md:text-lg px-6 py-4 md:px-8 md:py-6 mb-6 md:mb-8"
          >
            Начать общение
          </Button>

          {/* Дополнительный контент для демонстрации скроллбара */}
          <div className="mt-8 md:mt-12 space-y-3 md:space-y-6 opacity-70">
            <div className="p-3 md:p-4 rounded-lg bg-secondary/30 border border-border">
              <p className="text-xs md:text-sm text-muted-foreground">"Быстро" • "Надежно" • Бесплатно</p>
            </div>
            <div className="p-3 md:p-4 rounded-lg bg-secondary/30 border border-border">
              <p className="text-xs md:text-sm text-muted-foreground">Работает на всех устройствах! И на всех хуёво!</p>
            </div>
            <div className="p-3 md:p-4 rounded-lg bg-secondary/30 border border-border">
              <p className="text-xs md:text-sm text-muted-foreground">Шифрование сообщений не нужно, потому что никому не интересно читать этот бред.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Index;