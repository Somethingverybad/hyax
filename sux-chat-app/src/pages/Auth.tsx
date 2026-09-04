import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import logo from "@/assets/logo.png";
import { api } from "@/api/client";

const Auth = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  // Двухшаговый вход, как в мессенджерах: сначала логин, потом пароль.
  // Одно поле на экране — клавиатура ничего не перекрывает, а панели
  // скользят transform-ом (его считает композитор, перехода без рывков).
  const [step, setStep] = useState<0 | 1>(0);
  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const goToPassword = () => {
    if (!username.trim()) {
      toast.error("Введите логин");
      return;
    }
    setStep(1);
    // Фокус после того, как панель доехала — иначе клавиатура дёрнет анимацию.
    setTimeout(() => passwordRef.current?.focus(), 260);
  };

  const goBack = () => {
    setStep(0);
    setTimeout(() => usernameRef.current?.focus(), 260);
  };
  const navigate = useNavigate();

  // Пока токен есть, форму не показываем: иначе она успевала мелькнуть до
  // того, как проверка сессии уведёт в чат, и вход выглядел не бесшовным.
  const [checking, setChecking] = useState(!!localStorage.getItem("access_token"));

  useEffect(() => {
    if (!checking) return;
    const checkAuth = async () => {
      try {
        const profile = await api.getProfile();
        if (profile?.id) {
          navigate("/chat", { replace: true });
          return;
        }
      } catch {
        // Сессия недействительна — чистим и показываем форму.
        localStorage.removeItem("access_token");
        localStorage.removeItem("refresh_token");
      }
      setChecking(false);
    };
    checkAuth();
  }, [checking, navigate]);

  if (checking) {
    return <div className="min-h-screen bg-background" />;
  }

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const data = isLogin
        ? await api.login(username, password)
        : await api.register(username, password);

      if (data.error) throw new Error(data.error);

      // Регистрация возвращает только id созданного пользователя, без токенов —
      // поэтому сразу входим теми же данными. Иначе переход на /chat случался,
      // но экран не находил токен и возвращал обратно на форму.
      if (!isLogin) {
        await api.login(username, password);
      }

      toast.success("Ого! Заработало");
      navigate("/chat");
    } catch (error: any) {
      // Сервер отвечает подробностями в теле — показываем их, а не «Login failed 401».
      let text = error?.message || "Произошла ошибка";
      try {
        const body = JSON.parse(error?.fullResponse || "{}");
        text = body.detail || body.error || Object.values(body)?.[0] || text;
      } catch {
        // тело не JSON — оставляем исходное сообщение
      }
      toast.error(String(text));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen overflow-y-auto flex items-start justify-center bg-background p-3 md:p-4"
      style={{ paddingTop: "calc(var(--sat) + 2vh)" }}
    >
      <Card className="w-full max-w-md p-4 md:p-8 bg-transparent border-0">
        <div className="flex flex-col items-center mb-4 md:mb-6">
          <img
            src={logo}
            alt="ХУЯКС"
            className="w-20 h-20 md:w-24 md:h-24 mb-3 select-none pointer-events-none"
            draggable={false}
          />

          <div className="text-center mb-2 md:mb-3">
            <h1 className="text-[32px] md:text-[40px] font-bold text-foreground leading-none tracking-tight">ХУЯКС</h1>
            <p className="text-small font-semibold text-subtle mt-2 tracking-wider uppercase">эсемэсэнджер</p>
          </div>

          <p className="text-subtle text-center mt-3 text-small">
            {isLogin 
              ? "Не очень то и быстрый и ненадежный месенджер" 
              : "ВЫ КТО ТАКИЕ? Я ВАС ЗВАЛ! ЗАХОДИТЕ!"
            }
          </p>
        </div>

        <form onSubmit={handleAuth}>
          {/* Слайдер шагов: две панели в ряд, сдвиг transform-ом. */}
          <div className="overflow-hidden">
            <div
              className="flex transition-transform duration-300 ease-out"
              style={{ transform: `translateX(-${step * 100}%)` }}
            >
              {/* Шаг 1: логин */}
              <div className="w-full shrink-0 space-y-4 px-0.5">
                <div className="space-y-2">
                  <Label htmlFor="username" className="text-small text-muted-foreground uppercase tracking-wide">
                    {isLogin ? "Логин" : "Имя пользователя"}
                  </Label>
                  <Input
                    id="username"
                    ref={usernameRef}
                    type="text"
                    placeholder="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="username"
                    tabIndex={step === 0 ? 0 : -1}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        goToPassword();
                      }
                    }}
                    className="h-11 bg-surface-2 border-border rounded-md text-body focus:border-amber focus-visible:ring-0 transition-colors"
                  />
                </div>
                <Button
                  type="button"
                  onClick={goToPassword}
                  disabled={!username.trim()}
                  className="w-full h-11 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 font-semibold text-body"
                >
                  Далее
                </Button>
              </div>

              {/* Шаг 2: пароль */}
              <div className="w-full shrink-0 space-y-4 px-0.5">
                <button
                  type="button"
                  onClick={goBack}
                  className="flex items-center gap-1.5 text-sm text-muted-foreground"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span className="font-medium text-foreground">{username || "…"}</span>
                </button>
                <div className="space-y-2">
                  <Label htmlFor="password" className="text-small text-muted-foreground uppercase tracking-wide">
                    Пароль
                  </Label>
                  <Input
                    id="password"
                    ref={passwordRef}
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete={isLogin ? "current-password" : "new-password"}
                    tabIndex={step === 1 ? 0 : -1}
                    className="h-11 bg-surface-2 border-border rounded-md text-body focus:border-amber focus-visible:ring-0 transition-colors"
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full h-11 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 font-semibold text-body"
                  disabled={loading || !password}
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
              </div>
            </div>
          </div>
        </form>

        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={() => { setIsLogin(!isLogin); setStep(0); setPassword(""); }}
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