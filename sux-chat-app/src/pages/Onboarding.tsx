import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Aura, AURA_SWATCHES, DEFAULT_AURA } from "@/components/Aura";
import Identicon from "@/components/Identicon";
import { BUILTIN_THEMES, setTheme, useTheme } from "@/lib/theme";
import { getLang, setLang, LANGS, LANG_NAMES, useT } from "@/lib/i18n";
import { markOnboarded, setPendingAura } from "@/lib/onboarding";
import logo from "@/assets/logo.png";

/**
 * Онбординг первого запуска: язык → тема → аура. Каждый шаг можно пропустить.
 * Язык и тема применяются сразу (ещё до входа), аура запоминается и уходит в
 * профиль после входа (lib/onboarding.ts). Показывается один раз на устройстве.
 */
const Onboarding = () => {
  const navigate = useNavigate();
  const t = useT();
  const theme = useTheme();
  const [step, setStep] = useState(0);
  const [aura, setAura] = useState<string>("");

  const finish = () => { markOnboarded(); navigate("/auth", { replace: true }); };
  const next = () => { if (step >= 2) finish(); else setStep(step + 1); };

  const titles = [t("Выберите язык"), t("Выберите тему"), t("Выберите ауру")];
  const hints = [
    t("Язык интерфейса. Поменять можно в профиле."),
    t("Как выглядит приложение. Темы можно менять и устанавливать чужие."),
    t("Цвет ауры видят собеседники, пока вы в сети."),
  ];

  return (
    <div className="h-screen flex flex-col bg-background pad-safe-top pad-safe-bottom">
      <div className="flex items-center justify-between px-4 pt-3">
        <div className="flex gap-1.5">{[0, 1, 2].map((i) => <span key={i} className={`h-1.5 w-6 rounded-full ${i <= step ? "bg-primary" : "bg-surface-4"}`} />)}</div>
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
      <div className="px-5 pb-4 max-w-md w-full mx-auto">
        <Button type="button" className="w-full h-12" onClick={next}>{step >= 2 ? t("Готово") : t("Далее")}</Button>
      </div>
    </div>
  );
};

export default Onboarding;
