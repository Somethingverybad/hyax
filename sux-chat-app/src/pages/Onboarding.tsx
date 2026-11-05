import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Aura, AURA_SWATCHES, DEFAULT_AURA } from "@/components/Aura";
import Identicon from "@/components/Identicon";
import { BUILTIN_THEMES, setTheme, useTheme } from "@/lib/theme";
import { getLang, setLang, LANGS, LANG_NAMES, useT } from "@/lib/i18n";
import { applyPendingAura, markOnboarded, setPendingAura } from "@/lib/onboarding";
import { emailPromptOff, emailPromptWanted, markEmailPromptShown } from "@/lib/emailPrompt";
import EmailBindForm from "@/components/EmailBindForm";
import { api, type Profile } from "@/api/client";
import { readCache } from "@/lib/session-cache";
import logo from "@/assets/logo.png";

/**
 * Онбординг — сразу после первого входа или регистрации на устройстве (раньше
 * был до входа): язык → тема → аура → почта для восстановления пароля (если её
 * нет и не отказались насовсем, lib/emailPrompt). Каждый шаг можно пропустить.
 * Язык и тема применяются сразу, аура уходит в профиль по «Готово».
 * Показывается один раз на устройстве.
 */
const Onboarding = () => {
  const navigate = useNavigate();
  const t = useT();
  const theme = useTheme();
  const [params] = useSearchParams();
  const nextRaw = params.get("next") || "";
  const after = nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/chat";
  const [step, setStep] = useState(0);
  const [aura, setAura] = useState<string>("");
  // Шаг почты — только тем, у кого её нет (профиль свежий — с сервера).
  const [me, setMe] = useState<Profile | null>(() => readCache<Profile>("user"));
  useEffect(() => {
    if (!localStorage.getItem("access_token")) { navigate("/auth", { replace: true }); return; }
    void api.getProfile().then((p) => setMe(p)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const withEmail = emailPromptWanted(me) || step === 3;
  const last = withEmail ? 3 : 2;
  useEffect(() => { if (step === 3) markEmailPromptShown(); }, [step]);

  const finish = () => { markOnboarded(); void applyPendingAura(); navigate(after, { replace: true }); };
  const next = () => { if (step >= last) finish(); else setStep(step + 1); };

  const titles = [t("Выберите язык"), t("Выберите тему"), t("Выберите ауру"), t("Почта для восстановления")];
  const hints = [
    t("Язык интерфейса. Поменять можно в профиле."),
    t("Как выглядит приложение. Темы можно менять и устанавливать чужие."),
    t("Цвет ауры видят собеседники, пока вы в сети."),
    t("Если забудете пароль, код для входа придёт на эту почту. Это необязательно — привязать её можно и позже: Профиль → Конфиденциальность → Почта для восстановления."),
  ];

  return (
    <div className="h-screen flex flex-col bg-background pad-safe-top pad-safe-bottom">
      <div className="flex items-center justify-between px-4 pt-3">
        <div className="flex gap-1.5">{Array.from({ length: last + 1 }, (_, i) => <span key={i} className={`h-1.5 w-6 rounded-full ${i <= step ? "bg-primary" : "bg-surface-4"}`} />)}</div>
        <button type="button" onClick={next} className="text-small text-subtle px-2 py-1">{t("Пропустить")}</button>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-6 max-w-md w-full mx-auto">
        {step === 0 && <img src={logo} alt="" className="w-16 h-16 mx-auto mb-4" />}
        <h1 className="text-h1 text-center">{titles[step]}</h1>
        <p className="text-small text-subtle text-center mt-2 mb-6">{hints[step]}</p>

        {step === 0 && (
          <div className="space-y-2">
            {LANGS.map((l) => (
              <button key={l} type="button" onClick={() => setLang(l)}
                className={`w-full h-14 rounded-lg border text-body flex items-center justify-between px-4 ${getLang() === l ? "border-primary bg-primary/10" : "border-border bg-surface-2"}`}>
                <span>{LANG_NAMES[l]}</span>{getLang() === l && <Check className="w-5 h-5 text-primary" />}
              </button>
            ))}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-2">
            {BUILTIN_THEMES.map((th) => (
              <button key={th.id} type="button" onClick={() => setTheme(th, false)}
                className={`w-full h-16 rounded-lg border flex items-center gap-3 px-3 ${theme.id === th.id ? "border-primary bg-primary/10" : "border-border bg-surface-2"}`}>
                <span className="w-10 h-10 rounded-md border border-border overflow-hidden grid grid-cols-2" aria-hidden>
                  <span style={{ background: th.colors.background }} /><span style={{ background: th.colors.primary }} />
                  <span style={{ background: th.colors.surface2 }} /><span style={{ background: th.colors.foreground }} />
                </span>
                <span className="text-body flex-1 text-left">{t(th.name)}</span>
                {theme.id === th.id && <Check className="w-5 h-5 text-primary" />}
              </button>
            ))}
          </div>
        )}

        {step === 3 && <EmailBindForm autoFocus onBound={finish} />}

        {step === 2 && (
          <div className="space-y-5">
            <div className="flex justify-center py-2">
              <Aura active owner={{ aura_color: aura || DEFAULT_AURA, aura_text: "" }} size={104}>
                <Identicon id="onboarding" className="w-[104px] h-[104px] rounded-lg" />
              </Aura>
            </div>
            <div className="grid grid-cols-6 gap-3 justify-items-center">
              {AURA_SWATCHES.map((c) => (
                <button key={c} type="button" aria-label={c} onClick={() => { setAura(c); setPendingAura(c); }}
                  className={`w-10 h-10 rounded-full border-2 ${aura === c ? "border-foreground scale-110" : "border-transparent"}`} style={{ background: c }} />
              ))}
            </div>
          </div>
        )}
      </div>
      {step === 3 ? (
        // Как в окне EmailPrompt: главная кнопка одна — «Отправить код», эти — текстом.
        <div className="px-5 pb-4 max-w-md w-full mx-auto flex gap-2">
          <Button type="button" variant="ghost" className="flex-1 h-11 font-medium" onClick={finish}>{t("Позже")}</Button>
          <Button type="button" variant="ghost" className="flex-1 h-11 text-subtle" onClick={() => { void emailPromptOff(me); finish(); }}>{t("Больше не показывать")}</Button>
        </div>
      ) : (
        <div className="px-5 pb-4 max-w-md w-full mx-auto">
          <Button type="button" className="w-full h-12" onClick={next}>{step >= last ? t("Готово") : t("Далее")}</Button>
        </div>
      )}
    </div>
  );
};

export default Onboarding;
