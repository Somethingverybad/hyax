import { useEffect, useState } from "react";
import ScreenHeader from "@/components/ScreenHeader";
import { SettingsCard } from "@/components/settings";
import Identicon from "@/components/Identicon";
import { api } from "@/api/client";
import { toast } from "sonner";
import { Ban, Lock } from "lucide-react";

type Blocked = { id: string; username: string; avatar_url?: string | null };

/**
 * Конфиденциальность. Пока здесь одно: чёрный список. Разблокировать можно
 * прямо отсюда — иначе пришлось бы искать человека, чтобы открыть его карточку.
 */
const ProfilePrivacy = () => {
  const [list, setList] = useState<Blocked[] | null>(null);
  useEffect(() => { api.listBlocks().then(setList).catch(() => setList([])); }, []);

  const unblock = async (b: Blocked) => {
    try {
      await api.unblockUser(b.id);
      setList((l) => (l || []).filter((x) => x.id !== b.id));
      toast.success(`${b.username} разблокирован`);
    } catch (e: any) { toast.error(e?.message || "Не получилось"); }
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      <ScreenHeader title="Конфиденциальность" />
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        <p className="px-1 text-small text-subtle flex items-center gap-2"><Ban className="w-4 h-4" /> Заблокированные</p>
        <SettingsCard>
          {list === null ? (
            <div className="px-4 py-4 text-small text-subtle">Загрузка…</div>
          ) : list.length === 0 ? (
            <div className="px-4 py-4 text-small text-subtle">Никого. Заблокировать можно из карточки пользователя — его сообщения и пуши перестанут приходить.</div>
          ) : list.map((b) => (
            <div key={b.id} className="min-h-14 px-4 py-2 flex items-center gap-3">
              <Identicon id={b.id} avatarUrl={b.avatar_url} className="w-9 h-9 rounded-md shrink-0" />
              <span className="flex-1 text-body truncate">{b.username}</span>
              <button type="button" onClick={() => unblock(b)} className="text-small text-primary active:opacity-60">Разблокировать</button>
            </div>
          ))}
        </SettingsCard>

        <div className="rounded-lg bg-surface-2 border border-border p-4 flex gap-3">
          <Lock className="w-5 h-5 text-subtle shrink-0 mt-0.5" />
          <p className="text-small text-subtle">
            Остальные настройки — кто видит профиль, обложку и время последнего входа — пока в разработке.
          </p>
        </div>
      </div>
    </div>
  );
};

export default ProfilePrivacy;
