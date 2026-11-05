import { useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { api, type Profile } from "@/api/client";
import { t } from "@/lib/i18n";
import { readCache, writeCache } from "@/lib/session-cache";

/**
 * Привязка почты для восстановления пароля: адрес → код из письма → готово.
 * Общая для «Профиль → Почта» и предложения после входа (онбординг,
 * EmailPrompt). onBound — почта подтверждена, профиль уже в кэше.
 */
const EmailBindForm = ({ verified, onBound, autoFocus }: {
  /** Почта уже есть — подпись «Сменить почту» вместо «Адрес почты». */
  verified?: boolean;
  onBound?: (p: Profile) => void;
  autoFocus?: boolean;
}) => {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState<string | null>(null); // адрес, на который ушёл код
  const [busy, setBusy] = useState(false);

  const sendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const addr = email.trim().toLowerCase();
    if (!addr || busy) return;
    setBusy(true);
    try {
      const r = await api.setEmail(addr);
      setPending(r.email);
      setCode("");
      toast.success(t("Код отправлен — проверьте почту"));
    } catch (err: any) { toast.error(err?.message || t("Не удалось отправить код")); }
    finally { setBusy(false); }
  };

  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    try {
      const p = await api.confirmEmail(code.trim());
      writeCache("user", { ...(readCache<object>("user") || {}), ...p });
      setPending(null); setEmail(""); setCode("");
      toast.success(t("Почта привязана"));
      onBound?.(p);
    } catch (err: any) { toast.error(err?.message || t("Не удалось подтвердить")); }
    finally { setBusy(false); }
  };

  // surface-4 — поле видно и на фоне экрана, и в шторке (bg-card).
  const inputCls = "h-12 bg-surface-4 border-transparent rounded-md text-body focus:border-amber focus-visible:ring-0";

  return !pending ? (
    <form onSubmit={sendCode} className="space-y-3">
      <label htmlFor="email" className="text-small text-subtle">{verified ? t("Сменить почту") : t("Адрес почты")}</label>
      <Input id="email" type="email" inputMode="email" autoComplete="email" value={email} autoFocus={autoFocus}
        onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className={inputCls} />
      <Button type="submit" className="w-full h-12" disabled={busy || !email.trim()}>
        {busy ? t("Отправляю…") : t("Отправить код")}
      </Button>
    </form>
  ) : (
    <form onSubmit={confirm} className="space-y-3">
      <p className="text-small text-subtle">{t("Код из письма на {email}. Действует 15 минут.", { email: pending })}</p>
      <Input id="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} autoFocus
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="000000"
        className={`${inputCls} tracking-[0.3em] text-center text-lg`} />
      <Button type="submit" className="w-full h-12" disabled={busy || code.length < 6}>
        {busy ? t("Проверяю…") : t("Подтвердить")}
      </Button>
      <button type="button" className="w-full text-small text-subtle py-2" onClick={() => setPending(null)}>{t("Другой адрес")}</button>
    </form>
  );
};

export default EmailBindForm;
