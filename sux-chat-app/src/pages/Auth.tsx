import { t } from "@/lib/i18n";
import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Eye, EyeOff, User as UserIcon, X } from "lucide-react";
import logo from "@/assets/logo.png";
import { api } from "@/api/client";
import { LegalView, type LegalKind } from "./Legal";
import AuthQuote from "@/components/AuthQuote";
import SuprematistBackdrop from "@/components/SuprematistBackdrop";
import ForgotPassword from "@/components/ForgotPassword";
import { onboardingDone, applyPendingAura } from "@/lib/onboarding";

const Auth = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  // Согласие с правилами и политикой — обязательное условие регистрации
  // (App Store, гайдлайн 1.2: пользовательский контент).
  // Правила принимают и при входе, а не только при регистрации (App Store 1.2: EULA до входа).
  // На этом устройстве уже принимал — галочка стоит; снять можно.
  const [agreed, setAgreed] = useState(() => { try { return localStorage.getItem("hyax:terms-ok") === "1"; } catch { return false; } });
  // Правила открываются поверх формы: переход на /terms размонтировал бы
  // экран и стёр уже введённые логин с паролем.
  const [legal, setLegal] = useState<LegalKind | null>(null);
  const [forgot, setForgot] = useState(false);
  // Двухшаговый вход, как в мессенджерах: сначала логин, потом пароль.
  // Одно поле на экране — клавиатура ничего не перекрывает, а панели
  // скользят transform-ом (его считает композитор, перехода без рывков).
  const [step, setStep] = useState<0 | 1>(0);
  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const goToPassword = () => {
    if (!username.trim()) {
      toast.error(t("Введите логин"));
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
  // Первый запуск на устройстве — сначала онбординг (язык, тема, аура).
  useEffect(() => {
    if (!localStorage.getItem("access_token") && !onboardingDone()) navigate("/onboarding", { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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

      const failed = (data as { error?: string }).error;
      if (failed) throw new Error(failed);

      // Регистрация возвращает только id созданного пользователя, без токенов —
      // поэтому сразу входим теми же данными. Иначе переход на /chat случался,
      // но экран не находил токен и возвращал обратно на форму.
      if (!isLogin) {
        await api.login(username, password);
      } else {
        // Вошёл с принятыми правилами — отметим и на сервере (старым аккаунтам не покажется TermsGate).
        void api.acceptTerms().catch(() => {});
      }
      try { localStorage.setItem("hyax:terms-ok", "1"); } catch { /* без памяти */ }

      toast.success(t("Ого! Заработало"));
      await applyPendingAura();
      navigate(next, { replace: true });
    } catch (error: any) {
      // Сервер отвечает подробностями в теле — показываем их, а не «Login failed 401».
      let text = error?.message || t("Произошла ошибка");
      try {
        const body = JSON.parse(error?.fullResponse || "{}");
        text = body.detail || body.error || Object.values(body)?.[0] || text;
      } catch {
        // тело не JSON — оставляем исходное сообщение
      }
      // Тело ответа сервера не проходит через LError — переводим по словарю здесь.
      toast.error(t(String(text)));
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
          {t("ЛЮДИ.")}<br />{t("СООБЩЕНИЯ.")}<br />{t("БЛИЖЕ.")}
          <span className="mt-1.5 ml-auto block w-10 h-[2px] bg-foreground/70" />
        </div>

        <div className="relative flex flex-col items-center mb-4 md:mb-6 -mt-6">
          <img
            src={logo}
            alt="WYX"
            className="w-20 h-20 md:w-24 md:h-24 mb-3 rounded-[14px] select-none pointer-events-none"
            draggable={false}
          />

          <div className="text-center mb-2 md:mb-3">
            <h1 className="text-[34px] md:text-[38px] font-extrabold text-foreground leading-none tracking-tight">WYX</h1>
            <p className="text-caption text-subtle mt-1.5 tracking-[0.22em] uppercase">{t("народный мессенджер")}</p>
            <span className="mt-2.5 mx-auto block w-9 h-[3px] rounded-full bg-foreground/80" />
          </div>

          {isLogin ? (
            <AuthQuote className="text-subtle mt-1.5 mb-2 text-small" />
          ) : (
            <p className="text-subtle text-center mt-1.5 mb-2 text-small">{t("ВЫ КТО ТАКИЕ? Я ВАС ЗВАЛ! ЗАХОДИТЕ!")}</p>
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
                    {isLogin ? t("Логин") : t("Имя пользователя")}
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
                        aria-label={t("Очистить")}
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
                  <span>{t("Далее")}</span>
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
                  <Label htmlFor="password" className="text-small font-normal text-subtle">{t("Пароль")}</Label>
                  <div className="relative">
                  <Input
                    id="password"
                    ref={passwordRef}
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete={isLogin ? "current-password" : "new-password"}
                    tabIndex={step === 1 ? 0 : -1}
                    className="h-12 pr-11 bg-surface-2 border-transparent rounded-md text-body placeholder:text-subtle focus:border-amber focus-visible:ring-0 transition-colors"
                  />
                  {/* Показать пароль: глаз справа в поле — опечатку видно сразу. */}
                  <button type="button" onClick={() => setShowPassword((v) => !v)} tabIndex={step === 1 ? 0 : -1}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center text-subtle active:text-foreground"
                    aria-label={showPassword ? t("Скрыть пароль") : t("Показать пароль")}>
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                  </div>
                </div>
                {(
                  <label className="flex items-start gap-2.5 text-small text-subtle">
                    <input
                      type="checkbox"
                      className="mt-0.5 w-5 h-5 accent-primary shrink-0"
                      checked={agreed}
                      onChange={(e) => setAgreed(e.target.checked)}
                      tabIndex={step === 1 ? 0 : -1}
                    />
                    <span>
                      {t("Мне есть 17 лет, я принимаю")}{" "}
                      <a href="/terms" onClick={(e) => { e.preventDefault(); setLegal("terms"); }} className="text-primary underline">{t("правила")}</a>
                      {" "}{t("и")}{" "}
                      <a href="/privacy" onClick={(e) => { e.preventDefault(); setLegal("privacy"); }} className="text-primary underline">{t("политику конфиденциальности")}</a>.
                      {" "}{t("Нулевая терпимость к недопустимому контенту и оскорблениям: на сообщение или человека можно пожаловаться и заблокировать его, нарушителей удаляем в течение суток.")}
                    </span>
                  </label>
                )}
                <Button
                  type="submit"
                  className="w-full h-12 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 font-semibold text-body disabled:opacity-40"
                  disabled={loading || !password || !agreed}
                >
                  {loading ? (
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />{t("Загрузка...")}</div>
                  ) : isLogin ? (
                    t("Войти в WYX")
                  ) : (
                    t("Создать аккаунт")
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
            {isLogin ? t("Нет аккаунта? ") : t("Уже есть аккаунт? ")}
            <span className="text-primary font-semibold underline underline-offset-4">{isLogin ? t("Зарегистрируйтесь") : t("Войдите")}</span>
          </button>
        </div>
        {isLogin && (
          <div className="mt-3 text-center">
            <button type="button" onClick={() => setForgot(true)} className="text-small text-subtle underline underline-offset-4">{t("Забыли пароль?")}</button>
          </div>
        )}
      </Card>
      {forgot && (
        <ForgotPassword
          initialLogin={username}
          onClose={() => setForgot(false)}
          onDone={(l) => { setForgot(false); setIsLogin(true); setUsername(l); setPassword(""); setStep(1); }}
        />
      )}
      {legal && (
        // Плотная подложка у самого окна: в «стекле» и «мягкой» экраны прозрачны,
        // и сквозь правила просвечивала форма входа.
        <div className="fixed inset-0 z-50 bg-background" role="dialog" aria-modal="true">
          <LegalView kind={legal} onClose={() => setLegal(null)} />
        </div>
      )}
    </div>
  );
};

export default Auth;