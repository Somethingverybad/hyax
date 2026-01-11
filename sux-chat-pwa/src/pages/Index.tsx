import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { MessageSquare, Users, Zap } from "lucide-react";

const Index = () => {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-background to-primary/10 overflow-hidden">
      {/* Кастомный скроллбар контейнер */}
      <div className="w-full h-screen overflow-y-auto scrollbar-custom">
        <div className="text-center max-w-2xl px-4 py-8">
          <div className="w-24 h-24 bg-gradient-primary rounded-3xl mx-auto mb-8 flex items-center justify-center shadow-glow animate-pulse">
            <MessageSquare className="w-12 h-12 text-primary-foreground" />
          </div>
          
          <h1 className="mb-6 text-6xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            ХУЯКС эсемэсэнджер
          </h1>
          
          <p className="text-xl text-muted-foreground mb-12">
            Современный мессенджер для общения с друзьями
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
            <div className="p-6 rounded-2xl bg-gradient-card border border-border shadow-card hover:shadow-glow transition-all duration-300">
              <Users className="w-8 h-8 text-primary mx-auto mb-3" />
              <h3 className="font-semibold mb-2">Добавляйте друзей</h3>
              <p className="text-sm text-muted-foreground">Находите пользователей и начинайте общение</p>
            </div>
            
            <div className="p-6 rounded-2xl bg-gradient-card border border-border shadow-card hover:shadow-glow transition-all duration-300">
              <MessageSquare className="w-8 h-8 text-primary mx-auto mb-3" />
              <h3 className="font-semibold mb-2">Отправляйте сообщения</h3>
              <p className="text-sm text-muted-foreground">Мгновенная доставка в режиме реального времени</p>
            </div>
            
            <div className="p-6 rounded-2xl bg-gradient-card border border-border shadow-card hover:shadow-glow transition-all duration-300">
              <Zap className="w-8 h-8 text-primary mx-auto mb-3" />
              <h3 className="font-semibold mb-2">Делитесь файлами</h3>
              <p className="text-sm text-muted-foreground">Отправляйте документы, изображения и другие файлы</p>
            </div>
          </div>

          <Button
            onClick={() => navigate("/auth")}
            size="lg"
            className="bg-gradient-primary shadow-glow hover:shadow-glow-lg hover:scale-105 transition-all duration-300 text-lg px-8 py-6 mb-8"
          >
            Начать общение
          </Button>

          {/* Дополнительный контент для демонстрации скроллбара */}
          <div className="mt-12 space-y-6 opacity-70">
            <div className="p-4 rounded-lg bg-secondary/30 border border-border">
              <p className="text-sm text-muted-foreground">Быстро • Надежно • Бесплатно</p>
            </div>
            <div className="p-4 rounded-lg bg-secondary/30 border border-border">
              <p className="text-sm text-muted-foreground">Работает на всех устройствах</p>
            </div>
            <div className="p-4 rounded-lg bg-secondary/30 border border-border">
              <p className="text-sm text-muted-foreground">Шифрование сообщений</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Index;