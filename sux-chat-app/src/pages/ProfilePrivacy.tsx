import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import ScreenHeader from "@/components/ScreenHeader";
import { SettingsCard, SettingsRow } from "@/components/settings";
import Identicon from "@/components/Identicon";
import { api, type Profile } from "@/api/client";
import { readCache, writeCache } from "@/lib/session-cache";
import { syncNotificationSounds } from "@/lib/notificationSounds";
import { toast } from "sonner";
import { Ban, Lock, FileText, ShieldCheck, Trash2, Images } from "lucide-react";

const SAVED_ACCESS: Record<string, string> = { all: "Все", selected: "Избранные", none: "Никто" };

type Blocked = { id: string; username: string; avatar_url?: string | null };

/**
 * Конфиденциальность: чёрный список (разблокировать можно прямо отсюда — иначе
 * пришлось бы искать человека, чтобы открыть его карточку), показ паков 18+,
 * правила с политикой и удаление аккаунта.
 */
const ProfilePrivacy = () => {
  const navigate = useNavigate();
  const [list, setList] = useState<Blocked[] | null>(null);
  useEffect(() => { api.listBlocks().then(setList).catch(() => setList([])); }, []);

  const [profile, setProfile] = useState<Profile | null>(readCache<Profile>("user"));
  // Включение 18+ — в два тапа: первый показывает, что именно подтверждаешь.
  const [confirmAdult, setConfirmAdult] = useState(false);
  useEffect(() => {
    api.getCurrentUser().then((p) => { setProfile(p); writeCache("user", p); }).catch(() => {});
  }, []);

  const setAdult = async (value: boolean) => {
    if (!profile) return;
    const prev = profile;
    const next = { ...profile, allow_adult: value };
    setProfile(next); writeCache("user", next); setConfirmAdult(false);
    try {
      await api.updateProfile(prev.id, { allow_adult: value });
      // Каталог звуков изменился: паки 18+ появились или пропали.
      void syncNotificationSounds().catch(() => {});
    } catch {
      toast.error("Не удалось сохранить");
      setProfile(prev); writeCache("user", prev);
    }
  };

  /** Переключатель в профиле: рисуем сразу, при ошибке возвращаем как было. */
  const setFlag = async (key: "show_last_seen", value: boolean) => {
    if (!profile) return;
    const prev = profile;
    const next = { ...profile, [key]: value };
    setProfile(next); writeCache("user", next);
    try {
      await api.updateProfile(prev.id, { [key]: value } as any);
    } catch {
      toast.error("Не удалось сохранить");
      setProfile(prev); writeCache("user", prev);
    }
  };

  const setHidden = async (value: boolean) => {
    if (!profile) return;
    const prev = profile;
    const next = { ...profile, hide_online: value };
    setProfile(next); writeCache("user", next);
    try {
      await api.updateProfile(prev.id, { hide_online: value });
    } catch {
      toast.error("Не удалось сохранить");
      setProfile(prev); writeCache("user", prev);
    }
  };

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

        <p className="px-1 pt-2 text-small text-subtle">Статус</p>
        <SettingsCard>
          <SettingsRow
            label="Скрыть, что я в сети"
            hint={profile?.hide_online
              ? "Статус «Скрыт»: собеседники видят вас не в сети"
              : "Собеседники видят, когда вы в сети"}
            trailing={
              <input
                type="checkbox"
                className="w-5 h-5 accent-primary shrink-0"
                aria-label="Скрыть, что я в сети"
                checked={!!profile?.hide_online}
                disabled={!profile}
                onChange={(e) => setHidden(e.target.checked)}
              />
            }
          />
        </SettingsCard>

        <SettingsCard>
          <SettingsRow
            icon={Images}
            label="Кто видит сохранёнки"
            value={SAVED_ACCESS[profile?.saved_visibility || "all"]}
            onClick={() => navigate("/profile/saved-access")}
          />
        </SettingsCard>

        <SettingsCard>
          <SettingsRow
            label="Показывать время последнего входа"
            hint={profile?.show_last_seen === false
              ? "Собеседники не увидят, когда вы заходили"
              : "Собеседники видят «в сети 5 минут назад»"}
            trailing={
              <input
                type="checkbox"
                className="w-5 h-5 accent-primary shrink-0"
                aria-label="Показывать время последнего входа"
                checked={profile?.show_last_seen !== false}
                disabled={!profile || !!profile?.hide_online}
                onChange={(e) => setFlag("show_last_seen", e.target.checked)}
              />
            }
          />
        </SettingsCard>
        {profile?.hide_online && (
          <p className="px-1 text-caption text-subtle">
            Пока включено «Скрыть, что я в сети», время последнего входа не показывается никому.
          </p>
        )}

        <p className="px-1 pt-2 text-small text-subtle">Контент</p>
        <SettingsCard>
          <SettingsRow
            label="Показывать 18+"
            hint={profile?.allow_adult ? "Паки стикеров и звуков для взрослых видны" : "Паки для взрослых скрыты"}
            trailing={
              <input
                type="checkbox"
                className="w-5 h-5 accent-primary shrink-0"
                aria-label="Показывать 18+"
                checked={!!profile?.allow_adult}
                disabled={!profile}
                onChange={(e) => (e.target.checked ? setConfirmAdult(true) : setAdult(false))}
              />
            }
          />
          {confirmAdult && (
            <div className="px-4 py-3 space-y-3">
              <p className="text-small text-subtle">
                Паки с пометкой 18+ могут содержать грубую лексику и материалы для взрослых. Включая показ, вы подтверждаете, что вам есть 18 лет.
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setAdult(true)} className="flex-1 h-10 rounded-md bg-primary text-primary-foreground text-small font-medium active:opacity-90">Мне есть 18, включить</button>
                <button type="button" onClick={() => setConfirmAdult(false)} className="flex-1 h-10 rounded-md bg-surface-4 text-small font-medium active:opacity-90">Отмена</button>
              </div>
            </div>
          )}
        </SettingsCard>

        <SettingsCard>
          <SettingsRow icon={FileText} label="Правила" onClick={() => navigate("/terms")} />
          <SettingsRow icon={ShieldCheck} label="Политика конфиденциальности" onClick={() => navigate("/privacy")} />
        </SettingsCard>

        <SettingsCard>
          <SettingsRow
            icon={Trash2}
            label="Удалить аккаунт"
            hint="Безвозвратно, со всеми сообщениями"
            danger
            onClick={() => navigate("/profile/delete")}
          />
        </SettingsCard>

        <div className="ui-card rounded-lg bg-surface-2 border border-border p-4 flex gap-3">
          <Lock className="w-5 h-5 text-subtle shrink-0 mt-0.5" />
          <p className="text-small text-subtle">
            Остальные настройки — кто видит профиль и обложку — пока в разработке.
          </p>
        </div>
      </div>
    </div>
  );
};

export default ProfilePrivacy;
