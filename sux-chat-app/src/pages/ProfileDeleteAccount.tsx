import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import ScreenHeader from "@/components/ScreenHeader";
import { Input } from "@/components/ui/input";
import { api } from "@/api/client";
import { clearSessionCache } from "@/lib/session-cache";
import { clearMessageCache } from "@/lib/messageCache";

/**
 * Удаление аккаунта. Требование App Store (5.1.1(v)): аккаунт, созданный в
 * приложении, удаляется в нём же. Пароль — подтверждение, что это владелец,
 * а не тот, кому в руки попал разблокированный телефон.
 */
const ProfileDeleteAccount = () => {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    try {
      await api.deleteAccount(password);
      clearSessionCache();
      void clearMessageCache();
      await api.logout();
      toast.success("Аккаунт удалён");
      navigate("/auth", { replace: true });
    } catch (err: any) {
      toast.error(err?.message || "Не удалось удалить аккаунт");
      setBusy(false);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      <ScreenHeader title="Удалить аккаунт" />
      <form onSubmit={submit} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <div className="ui-card rounded-lg bg-surface-2 border border-border p-4 space-y-2">
          <p className="text-body font-medium text-destructive flex items-center gap-2"><Trash2 className="w-4 h-4" /> Это навсегда</p>
          <p className="text-small text-subtle">
            Сразу и без возможности восстановить удалятся: профиль, все ваши сообщения, личные чаты,
            «Избранное», ваши каналы, боты, паки стикеров и звуков. Группы останутся у участников,
            но без ваших сообщений. Логин освободится.
          </p>
        </div>
        <div className="space-y-2">
          <label htmlFor="del-password" className="text-small text-subtle">Пароль от аккаунта</label>
          <Input
            id="del-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-12 bg-surface-2 border-transparent rounded-md text-body focus:border-amber focus-visible:ring-0"
          />
        </div>
        <button
          type="submit"
          disabled={!password || busy}
          className="w-full h-12 rounded-md bg-destructive text-destructive-foreground font-semibold active:opacity-90 disabled:opacity-40"
        >
          {busy ? "Удаляю…" : "Удалить аккаунт навсегда"}
        </button>
      </form>
    </div>
  );
};

export default ProfileDeleteAccount;
