import { Capacitor } from "@capacitor/core";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/api/client";
import { readCache, writeCache } from "@/lib/session-cache";
import ScreenHeader from "@/components/ScreenHeader";
import { SettingsCard, SettingsRow } from "@/components/settings";
import SoundPicker from "@/components/SoundPicker";
import { toast } from "sonner";
import { Music2 } from "lucide-react";
import type { Profile } from "./Profile";

/** Переключатель-галочка в строке настроек. */
const Toggle = ({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) => (
  <input
    type="checkbox"
    className="w-5 h-5 accent-primary shrink-0"
    checked={checked}
    aria-label={label}
    onChange={(e) => onChange(e.target.checked)}
  />
);

/**
 * Уведомления: свой звук и то, что видно и слышно на чужих устройствах.
 * Раньше эти тумблеры лежали прямо на экране профиля.
 */
const ProfileNotifications = () => {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(readCache<Profile>("user"));
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const p = await api.getCurrentUser();
        setProfile(p);
        writeCache("user", p);
      } catch {
        navigate("/auth", { replace: true });
      }
    })();
  }, [navigate]);

  /** Оптимистично меняем локально, при ошибке откатываем.
   *  Возвращает, удалось ли сохранить: иначе поверх сообщения об ошибке
   *  вылезал бы ещё и «успех». */
  const patch = async (patchData: Record<string, unknown>, next: Profile, prev: Profile) => {
    setProfile(next);
    writeCache("user", next);
    try {
      await api.updateProfile(prev.id, patchData);
      return true;
    } catch {
      toast.error("Не удалось сохранить");
      setProfile(prev);
      writeCache("user", prev);
      return false;
    }
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      <ScreenHeader title="Уведомления" />

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {profile && (
          <SettingsCard>
            {/* «Мой звук»: собеседники получают пуши о моих сообщениях с этим
                звуком (если у сообщения нет своего аудио-стикера). */}
            <SettingsRow
              icon={Music2}
              label="Мой звук уведомлений"
              hint={
                profile.notify_sound
                  ? `${profile.notify_sound.name} — так звучат мои сообщения у других`
                  : "Обычный — выбери свой, его услышат собеседники"
              }
              onClick={() => setPickerOpen(true)}
            />
          </SettingsCard>
        )}

        {profile && (
          <SettingsCard>
            {/* Р.Ё.В: вибрация, которую шлёт собеседник, пока держит палец.
                Выключено — сервер такие сигналы до нас не доводит. */}
            <SettingsRow
              label="Принимать Р.Ё.В"
              hint="Вибрация, пока собеседник держит палец"
              trailing={
                <Toggle
                  label="Принимать Р.Ё.В"
                  checked={profile.rov_enabled !== false}
                  onChange={(v) => patch({ rov_enabled: v }, { ...profile, rov_enabled: v }, profile)}
                />
              }
            />
            {/* Текст в уведомлениях. Выключено — сервер шлёт «Новое сообщение»
                вместо текста; сам пуш при этом всё равно зашифрован. */}
            {Capacitor.isNativePlatform() && (
              <SettingsRow
                label="Текст в уведомлениях"
                hint="Выключи — в пуше будет только «Новое сообщение»"
                trailing={
                  <Toggle
                    label="Текст в уведомлениях"
                    checked={profile.push_preview !== false}
                    onChange={(v) => patch({ push_preview: v }, { ...profile, push_preview: v }, profile)}
                  />
                }
              />
            )}
          </SettingsCard>
        )}
      </div>

      {pickerOpen && profile && (
        <SoundPicker
          title="Мой звук уведомлений"
          current={profile.notify_sound?.id || null}
          onClose={() => setPickerOpen(false)}
          onPick={async (s) => {
            setPickerOpen(false);
            const ok = await patch(
              { notify_sound_id: s ? s.id : null },
              { ...profile, notify_sound: s },
              profile,
            );
            if (ok) toast.success(s ? `Теперь твои сообщения звучат как «${s.name}»` : "Обычный звук");
          }}
        />
      )}
    </div>
  );
};

export default ProfileNotifications;
