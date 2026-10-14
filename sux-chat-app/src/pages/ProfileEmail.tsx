import { t } from "@/lib/i18n";
import { useState } from "react";
import { toast } from "sonner";
import { Mail, ShieldCheck } from "lucide-react";
import ScreenHeader from "@/components/ScreenHeader";
import { Input } from "@/components/ui/input";
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
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState<string | null>(null); // адрес, на который ушёл код
  const [busy, setBusy] = useState(false);

  const save = (p: Profile) => { setMe(p); writeCache("user", { ...(readCache<object>("user") || {}), ...p }); };

  const sendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const addr = email.trim().toLowerCase();
    if (!addr || busy) return;
    setBusy(true);
    try {
      const r = await api.setEmail(addr);
      setPending(r.email);
      setCode("");
      toast.success("Код отправлен — проверьте почту");
    } catch (err: any) { toast.error(err?.message || "Не удалось отправить код"); }
    finally { setBusy(false); }
  };

  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    try {
      save(await api.confirmEmail(code.trim()));
      setPending(null); setEmail(""); setCode("");
      toast.success("Почта привязана");
    } catch (err: any) { toast.error(err?.message || "Не удалось подтвердить"); }
    finally { setBusy(false); }
  };

  const unlink = async () => {
    if (busy) return;
    setBusy(true);
    try { save(await api.unlinkEmail()); toast.success("Почта отвязана"); }
    catch (err: any) { toast.error(err?.message || "Не удалось отвязать"); }
    finally { setBusy(false); }
  };

  const inputCls = "h-12 bg-surface-2 border-transparent rounded-md text-body focus:border-amber focus-visible:ring-0";

  return (
    <div className="h-screen flex flex-col bg-background">
      <ScreenHeader title="Почта" />
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <div className="ui-card rounded-lg bg-surface-2 border border-border p-4 space-y-2">
          <p className="text-body font-medium flex items-center gap-2"><Mail className="w-4 h-4" /> Только для восстановления пароля</p>
          <p className="text-small text-subtle">
            Адрес никому не показывается и для рассылок не используется. Забыли пароль — на экране входа нажмите
            «Забыли пароль?», код придёт на эту почту.
          </p>
        </div>

        {me?.email_verified && !pending && (
          <div className="ui-card rounded-lg bg-surface-2 border border-border p-4 space-y-3">
            <p className="text-body flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-primary" /> {me.email}</p>
            <p className="text-small text-subtle">Привязана и подтверждена.</p>
            <Button type="button" variant="secondary" className="w-full" disabled={busy} onClick={unlink}>Отвязать</Button>
          </div>
        )}

        {!pending ? (
          <form onSubmit={sendCode} className="space-y-3">
            <label htmlFor="email" className="text-small text-subtle">{me?.email_verified ? "Сменить почту" : "Адрес почты"}</label>
            <Input id="email" type="email" inputMode="email" autoComplete="email" value={email}
              onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className={inputCls} />
            <Button type="submit" className="w-full h-12" disabled={busy || !email.trim()}>
              {busy ? "Отправляю…" : t("Отправить код")}
            </Button>
          </form>
        ) : (
          <form onSubmit={confirm} className="space-y-3">
            <p className="text-small text-subtle">Код из письма на {pending}. Действует 15 минут.</p>
            <Input id="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="000000"
              className={`${inputCls} tracking-[0.3em] text-center text-lg`} />
            <Button type="submit" className="w-full h-12" disabled={busy || code.length < 6}>
              {busy ? "Проверяю…" : "Подтвердить"}
            </Button>
            <button type="button" className="w-full text-small text-subtle py-2" onClick={() => setPending(null)}>Другой адрес</button>
          </form>
        )}
      </div>
    </div>
  );
};

export default ProfileEmail;
