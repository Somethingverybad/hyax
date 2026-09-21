import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, User as UserIcon, X } from "lucide-react";
import logo from "@/assets/logo.png";
import { api } from "@/api/client";
import { LegalView, type LegalKind } from "./Legal";
import AuthQuote from "@/components/AuthQuote";
import SuprematistBackdrop from "@/components/SuprematistBackdrop";

const Auth = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  // Согласие с правилами и политикой — обязательное условие регистрации
  // (App Store, гайдлайн 1.2: пользовательский контент).
  const [agreed, setAgreed] = useState(false);
  // Правила открываются поверх формы: переход на /terms размонтировал бы
  // экран и стёр уже введённые логин с паролем.
  const [legal, setLegal] = useState<LegalKind | null>(null);
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
  // Пришли по ссылке на профиль (/u/<ник>) без сессии — после входа
  // возвращаем туда же, а не в общий список чатов. Только свои пути.
  const [params] = useSearchParams();
  const nextRaw = params.get("next") || "";
  const next = nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/chat";

  useEffect(() => {
    if (!checking) return;
    const checkAuth = async () => {
      try {
        const profile = await api.getProfile();
        if (profile?.id) {
          navigate(next, { replace: true });
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
        : await api.register(username, password, agreed);

      if (data.error) throw new Error(data.error);

      // Регистрация возвращает только id созданного пользователя, без токенов —
      // поэтому сразу входим теми же данными. Иначе переход на /chat случался,
      // но экран не находил токен и возвращал обратно на форму.
      if (!isLogin) {
        await api.login(username, password);
      }

      toast.success("Ого! Заработало");
      navigate(next, { replace: true });
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
      className="min-h-screen overflow-y-auto flex items-start justify-center bg-background px-4 py-3"
      style={{ paddingTop: "calc(var(--sat) + 2vh)" }}
    >
      <Card className="auth-card relative w-full max-w-md p-5 md:p-7 overflow-hidden rounded-[18px]">
        <SuprematistBackdrop />
        {/* Девиз в углу, как на макете: три слова столбиком и черта под ними. */}
        <div className="relative text-right text-[11px] leading-[1.45] font-semibold tracking-[0.12em] text-foreground/80">
          ЛЮДИ.<br />СООБЩЕНИЯ.<br />БЛИЖЕ.
          <span className="mt-1.5 ml-auto block w-10 h-[2px] bg-foreground/70" />
        </div>

        <div className="relative flex flex-col items-center mb-4 md:mb-6 -mt-6">
          <img
            src={logo}
            alt="WhoYaX"
            className="w-20 h-20 md:w-24 md:h-24 mb-3 rounded-[14px] select-none pointer-events-none"
            draggable={false}
          />

          <div className="text-center mb-2 md:mb-3">
            <h1 className="text-[34px] md:text-[38px] font-extrabold text-foreground leading-none tracking-tight">WhoYaX</h1>
            <p className="text-caption text-subtle mt-1.5 tracking-[0.32em] uppercase">эсемэсэнджер</p>
            <span className="mt-2.5 mx-auto block w-9 h-[3px] rounded-full bg-foreground/80" />
          </div>

          {isLogin ? (
            <AuthQuote className="text-subtle mt-1.5 mb-2 text-small" />
          ) : (
            <p className="text-subtle text-center mt-1.5 mb-2 text-small">ВЫ КТО ТАКИЕ? Я ВАС ЗВАЛ! ЗАХОДИТЕ!</p>
          )}
        </div>

        <form onSubmit={handleAuth} className="relative">
          {/* Слайдер шагов: две панели в ряд, сдвиг transform-ом. */}
          <div className="overflow-hidden">
            <div
              className="flex transition-transform duration-300 ease-out"
              style={{ transform: `translateX(-${step * 100}%)` }}
            >
              {/* Шаг 1: логин */}
              <div className="w-full shrink-0 space-y-4 px-0.5">
                <div className="space-y-2">
                  <Label htmlFor="username" className="text-small font-normal text-subtle">
                    {isLogin ? "Логин" : "Имя пользователя"}
                  </Label>
                  <div className="relative">
                    <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-subtle pointer-events-none" />
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
                      className="h-13 pl-10 pr-10 bg-surface-1 rounded-md text-body placeholder:text-subtle focus:border-amber focus-visible:ring-0 transition-colors"
                    />
                    {username && (
                      <button
                        type="button"
                        onClick={() => { setUsername(""); usernameRef.current?.focus(); }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-subtle active:opacity-60"
                        aria-label="Очистить"
                        tabIndex={-1}
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
                <Button
                  type="button"
                  onClick={goToPassword}
                  disabled={!username.trim()}
                  className="ui-btn w-full h-13 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 font-bold text-body tracking-[0.18em] uppercase disabled:opacity-40 flex items-center justify-between px-5"
                >
                  <span>Далее</span>
                  <ArrowRight className="w-5 h-5" />
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
                  <Label htmlFor="password" className="text-small font-normal text-subtle">
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
                    className="h-12 bg-surface-2 border-transparent rounded-md text-body placeholder:text-subtle focus:border-amber focus-visible:ring-0 transition-colors"
                  />
                </div>
                {!isLogin && (
                  <label className="flex items-start gap-2.5 text-small text-subtle">
                    <input
                      type="checkbox"
                      className="mt-0.5 w-5 h-5 accent-primary shrink-0"
                      checked={agreed}
                      onChange={(e) => setAgreed(e.target.checked)}
                      tabIndex={step === 1 ? 0 : -1}
                    />
                    <span>
                      Мне есть 17 лет, я принимаю{" "}
                      <a href="/terms" onClick={(e) => { e.preventDefault(); setLegal("terms"); }} className="text-primary underline">правила</a>
                      {" "}и{" "}
                      <a href="/privacy" onClick={(e) => { e.preventDefault(); setLegal("privacy"); }} className="text-primary underline">политику конфиденциальности</a>.
                      Недопустимый контент и оскорбления запрещены.
                    </span>
                  </label>
                )}
                <Button
                  type="submit"
                  className="w-full h-12 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 font-semibold text-body disabled:opacity-40"
                  disabled={loading || !password || (!isLogin && !agreed)}
                >
                  {loading ? (
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Загрузка...
                    </div>
                  ) : isLogin ? (
                    "Войти в WhoYaX"
                  ) : (
                    "Создать аккаунт"
                  )}
                </Button>
              </div>
            </div>
          </div>
        </form>

        <div className="relative mt-6 flex items-center justify-center gap-3">
          <span className="h-[2px] w-10 bg-foreground/70 shrink-0" />
          <button
            type="button"
            onClick={() => { setIsLogin(!isLogin); setStep(0); setPassword(""); }}
            className="text-body text-subtle"
          >
            {isLogin ? "Нет аккаунта? " : "Уже есть аккаунт? "}
            <span className="text-primary font-semibold underline underline-offset-4">{isLogin ? "Зарегистрируйтесь" : "Войдите"}</span>
          </button>
        </div>
      </Card>
      {legal && (
        <div className="fixed inset-0 z-50">
          <LegalView kind={legal} onClose={() => setLegal(null)} />
        </div>
      )}
    </div>
  );
};

export default Auth;