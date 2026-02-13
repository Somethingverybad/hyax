import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Zap } from "lucide-react";
import { api } from "@/api/client";

const Auth = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const profile = await api.getProfile();
        if (profile?.id) navigate("/chat");
      } catch {}
    };
    checkAuth();
  }, [navigate]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const data = isLogin
        ? await api.login(username, password)
        : await api.register(username, password);

      if (data.error) throw new Error(data.error);

      toast.success("Ого! Заработало");
      navigate("/chat");
    } catch (error: any) {
      toast.error(error.message || "Произошла ошибка");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full w-full flex items-center justify-center bg-gradient-to-br from-background via-background to-primary/10 p-3 md:p-4 overflow-auto">
      <Card className="w-full max-w-md p-4 md:p-8 bg-gradient-card shadow-card border-border">
        <div className="flex flex-col items-center mb-6 md:mb-8">
          {/* Иконка со стилизованной буквой Х */}
          <div className="relative mb-4 md:mb-6">
            <div className="w-20 h-20 md:w-24 md:h-24 bg-gradient-primary rounded-2xl md:rounded-3xl flex items-center justify-center shadow-glow">
              {/* Стилизованная буква Х */}
              <div className="relative">
                <span className="text-5xl md:text-7xl font-black text-primary-foreground select-none">
                  Х
                </span>
                {/* Эффект свечения */}
                <div className="absolute inset-0 text-5xl md:text-7xl font-black text-primary-foreground/30 blur-sm">
                  Х
                </div>
              </div>
            </div>
            <div className="absolute -top-1 -right-1 md:-top-2 md:-right-2 w-6 h-6 md:w-8 md:h-8 bg-accent rounded-full flex items-center justify-center shadow-md">
              <Zap className="w-3 h-3 md:w-4 md:h-4 text-accent-foreground" />
            </div>
          </div>
          
          {/* Стилизованное название с эффектом */}
          <div className="text-center mb-2 md:mb-3">
            <div className="relative">
              <h1 className="text-4xl md:text-6xl font-black bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent leading-none tracking-tight drop-shadow-sm">
                ХУЯКС
              </h1>
              <div className="absolute inset-0 text-4xl md:text-6xl font-black text-primary/20 blur-sm leading-none tracking-tight">
                ХУЯКС
              </div>
            </div>
            <p className="text-base md:text-xl font-semibold text-muted-foreground mt-2 md:mt-3 tracking-wider uppercase">
              эсемэсэнджер
            </p>
          </div>

          <div className="w-24 md:w-32 h-1 bg-gradient-to-r from-transparent via-primary to-transparent rounded-full mt-3 md:mt-4"></div>

          <p className="text-muted-foreground text-center mt-4 md:mt-6 text-xs md:text-sm">
            {isLogin 
              ? "Не очень то и быстрый и ненадежный месенджер" 
              : "ВЫ КТО ТАКИЕ? Я ВАС ЗВАЛ! ЗАХОДИТЕ!"
            }
          </p>
        </div>

        <form onSubmit={handleAuth} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="username" className="text-sm font-medium">
              {isLogin ? "Логин" : "Имя пользователя"}
            </Label>
            <Input
              id="username"
              type="text"
              placeholder="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoComplete="username"
              className="bg-secondary/50 border-border focus:border-primary transition-colors"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password" className="text-sm font-medium">
              Пароль
            </Label>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete={isLogin ? "current-password" : "new-password"}
              className="bg-secondary/50 border-border focus:border-primary transition-colors"
            />
          </div>

          <Button
            type="submit"
            className="w-full bg-gradient-primary shadow-glow hover:shadow-glow-lg hover:scale-[1.02] transition-all duration-200 font-semibold py-2.5 md:py-3 text-sm md:text-base"
            disabled={loading}
          >
            {loading ? (
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Загрузка...
              </div>
            ) : isLogin ? (
              "Войти в ХУЯКС"
            ) : (
              "Создать аккаунт"
            )}
          </Button>
        </form>

        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={() => setIsLogin(!isLogin)}
            className="text-sm text-muted-foreground hover:text-primary transition-colors font-medium"
          >
            {isLogin ? "Нет аккаунта? Зарегистрируйтесь" : "Уже есть аккаунт? Войдите"}
          </button>
        </div>
      </Card>
    </div>
  );
};

export default Auth;