import { t } from "@/lib/i18n";
import { useState } from "react";
import { toast } from "sonner";
import { Mail, ShieldCheck } from "lucide-react";
import ScreenHeader from "@/components/ScreenHeader";
import EmailBindForm from "@/components/EmailBindForm";
import { Button } from "@/components/ui/button";
import { api, type Profile } from "@/api/client";
import { readCache, writeCache } from "@/lib/session-cache";

/**
 * Почта для восстановления пароля. Привязывается кодом из письма: ввёл адрес —
 * пришёл код — ввёл код. Никому не показывается и ни для чего, кроме сброса
 * пароля, не используется. Письма шлёт сервер (chat/mailer.py).
 */
const ProfileEmail = () => {
  const [me, setMe] = useState<Profile | null>(() => readCache<Profile>("user"));
  const [busy, setBusy] = useState(false);

  const save = (p: Profile) => { setMe(p); writeCache("user", { ...(readCache<object>("user") || {}), ...p }); };

  const unlink = async () => {
    if (busy) return;
    setBusy(true);
    try { save(await api.unlinkEmail()); toast.success(t("Почта отвязана")); }
    catch (err: any) { toast.error(err?.message || t("Не удалось отвязать")); }
    finally { setBusy(false); }
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      <ScreenHeader title={t("Почта")} />
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <div className="ui-card rounded-lg bg-surface-2 border border-border p-4 space-y-2">
          <p className="text-body font-medium flex items-center gap-2"><Mail className="w-4 h-4" /> {t("Только для восстановления пароля")}</p>
          <p className="text-small text-subtle">
            {t("Адрес никому не показывается и для рассылок не используется. Забыли пароль — на экране входа нажмите «Забыли пароль?», код придёт на эту почту.")}
          </p>
        </div>

        {me?.email_verified && (
          <div className="ui-card rounded-lg bg-surface-2 border border-border p-4 space-y-3">
            <p className="text-body flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-primary" /> {me.email}</p>
            <p className="text-small text-subtle">{t("Привязана и подтверждена.")}</p>
            <Button type="button" variant="secondary" className="w-full" disabled={busy} onClick={unlink}>{t("Отвязать")}</Button>
          </div>
        )}

        <EmailBindForm verified={!!me?.email_verified} onBound={save} />
      </div>
    </div>
  );
};

export default ProfileEmail;
