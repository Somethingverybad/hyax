import { useState } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { api } from "@/api/client";

/**
 * «Забыли пароль?» на экране входа. Два шага: ник или почта → код из письма
 * и новый пароль. Сервер отвечает одинаково, есть у аккаунта почта или нет,
 * поэтому подсказываем: без привязанной почты письмо не придёт.
 */
const ForgotPassword = ({ initialLogin, onClose, onDone }: { initialLogin?: string; onClose: () => void; onDone: (login: string) => void }) => {
  const [login, setLogin] = useState(initialLogin || "");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<0 | 1>(0);
  const [busy, setBusy] = useState(false);

  const inputCls = "h-12 bg-surface-2 border-transparent rounded-md text-body focus:border-amber focus-visible:ring-0";

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!login.trim() || busy) return;
    setBusy(true);
    try {
      await api.forgotPassword(login.trim());
      setStep(1);
      toast.success("Если к аккаунту привязана почта, код уже в пути");
    } catch (err: any) { toast.error(err?.message || "Не удалось отправить код"); }
    finally { setBusy(false); }
  };

  const reset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length < 6 || password.length < 6 || busy) return;
    setBusy(true);
    try {
      await api.resetPassword(login.trim(), code, password);
      toast.success("Пароль изменён — войдите с новым");
      onDone(login.trim());
    } catch (err: any) { toast.error(err?.message || "Не удалось сменить пароль"); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end md:items-center justify-center" onClick={onClose}>
      <div className="w-full md:max-w-md bg-card border-t-2 md:border-2 border-border md:rounded-lg p-5 pad-safe-bottom space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <h2 className="text-h2 flex-1">Восстановить пароль</h2>
          <button type="button" onClick={onClose} aria-label="Закрыть"><X className="w-5 h-5" /></button>
        </div>
        {step === 0 ? (
          <form onSubmit={send} className="space-y-3">
            <p className="text-small text-subtle">
              Код придёт на почту, привязанную в настройках профиля. Если почты нет — восстановить пароль не получится.
            </p>
            <Label htmlFor="fp-login" className="text-small font-normal text-subtle">Ник или почта</Label>
            <Input id="fp-login" autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} className={inputCls} />
            <Button type="submit" className="w-full h-12" disabled={busy || !login.trim()}>{busy ? "Отправляю…" : "Отправить код"}</Button>
          </form>
        ) : (
          <form onSubmit={reset} className="space-y-3">
            <Label htmlFor="fp-code" className="text-small font-normal text-subtle">Код из письма</Label>
            <Input id="fp-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="000000"
              className={`${inputCls} tracking-[0.3em] text-center text-lg`} />
            <Label htmlFor="fp-password" className="text-small font-normal text-subtle">Новый пароль</Label>
            <Input id="fp-password" type="password" autoComplete="new-password" value={password}
              onChange={(e) => setPassword(e.target.value)} className={inputCls} />
            <Button type="submit" className="w-full h-12" disabled={busy || code.length < 6 || password.length < 6}>
              {busy ? "Сохраняю…" : "Сменить пароль"}
            </Button>
            <button type="button" className="w-full text-small text-subtle py-2" onClick={() => setStep(0)}>Отправить код ещё раз</button>
          </form>
        )}
      </div>
    </div>
  );
};

export default ForgotPassword;
