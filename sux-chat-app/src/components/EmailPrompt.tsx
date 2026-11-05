import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Mail, X } from "lucide-react";
import { api, type Profile } from "@/api/client";
import EmailBindForm from "@/components/EmailBindForm";
import { Button } from "@/components/ui/button";
import { emailPromptOff, emailPromptWanted, markEmailPromptShown } from "@/lib/emailPrompt";
import { t } from "@/lib/i18n";
import { onboardingDone } from "@/lib/onboarding";
import { readCache } from "@/lib/session-cache";

/**
 * Предложение привязать почту тем, кто онбординг уже прошёл (новым его делает
 * последний шаг онбординга): через пару секунд после открытия чатов, один раз
 * за вход на устройстве (lib/emailPrompt). Необязательно — «Позже» и «Больше
 * не показывать».
 */
const EmailPrompt = () => {
  const [me, setMe] = useState<Profile | null>(() => readCache<Profile>("user"));
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!onboardingDone() || !emailPromptWanted(readCache<Profile>("user") || { id: "?" })) return;
    let alive = true;
    const timer = setTimeout(() => {
      // Кэш мог отстать (почту привязали на другом устройстве) — сверяемся с сервером.
      void api.getProfile().then((p: Profile) => {
        if (!alive || !emailPromptWanted(p)) return;
        setMe(p);
        markEmailPromptShown();
        setOpen(true);
      }).catch(() => {});
    }, 2500);
    return () => { alive = false; clearTimeout(timer); };
  }, []);
  if (!open) return null;
  const close = () => setOpen(false);
  return createPortal(
    <div className="fixed inset-0 z-[85] bg-black/60 flex flex-col justify-end md:items-center md:justify-center" onClick={close}>
      <div role="dialog" aria-label={t("Почта для восстановления")}
        className="bg-card border-t-2 md:border-2 border-border md:rounded-lg w-full md:w-[420px] p-5 pad-safe-bottom space-y-4"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <span className="w-10 h-10 rounded-full bg-primary/15 text-primary flex items-center justify-center shrink-0"><Mail className="w-5 h-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-body font-semibold">{t("Добавьте почту")}</p>
            <p className="text-small text-subtle mt-1">
              {t("Если забудете пароль, код для входа придёт на эту почту. Это необязательно — привязать её можно и позже: Профиль → Конфиденциальность → Почта для восстановления.")}
            </p>
          </div>
          <button type="button" onClick={close} className="p-1 -mr-1 -mt-1 text-subtle" aria-label={t("Закрыть")}><X className="w-5 h-5" /></button>
        </div>
        <EmailBindForm onBound={close} />
        <div className="flex gap-2">
          <Button type="button" variant="ghost" className="flex-1 h-11 font-medium" onClick={close}>{t("Позже")}</Button>
          <Button type="button" variant="ghost" className="flex-1 h-11 text-subtle" onClick={() => { void emailPromptOff(me); close(); }}>{t("Больше не показывать")}</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default EmailPrompt;
