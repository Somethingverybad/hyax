import { Capacitor } from "@capacitor/core";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/api/client";
import { readCache, writeCache } from "@/lib/session-cache";
import ScreenHeader from "@/components/ScreenHeader";
import { SettingsCard, SettingsRow } from "@/components/settings";
import { getSetting, setSetting } from "@/lib/settings";
import SoundPicker from "@/components/SoundPicker";
import { toast } from "sonner";
import { Music2, Library, Phone, Check, X } from "lucide-react";
import { BUILTIN_RINGTONES, ringtoneLabel, previewRingtone, resolveRingtoneUrl } from "@/lib/ringtone";
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
  // Звук звонка: встроенные варианты или любой звук из каталога.
  const [ringOpen, setRingOpen] = useState(false);
  const [ringCatalog, setRingCatalog] = useState(false);
  const [ringName, setRingName] = useState<string | null>(null);
  const stopPreview = useRef<(() => void) | null>(null);
  useEffect(() => () => { stopPreview.current?.(); }, []);
  useEffect(() => {
    const v = profile?.ringtone || "";
    if (!v.startsWith("sound:")) { setRingName(null); return; }
    api.getNotificationSounds().then((list) => setRingName(list.find((s) => s.id === v.slice(6))?.name || null)).catch(() => {});
  }, [profile?.ringtone]);
  const preview = async (value: string) => {
    stopPreview.current?.();
    stopPreview.current = previewRingtone(await resolveRingtoneUrl(value));
  };
  const setRingtone = async (value: string, name?: string) => {
    if (!profile) return;
    const ok = await patch({ ringtone: value }, { ...profile, ringtone: value }, profile);
    if (ok) toast.success(`Звонок: ${name || ringtoneLabel(value)}`);
  };

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

  // Звук отправки — локально на устройстве, без сервера.
  const [sfxSend, setSfxSend] = useState(() => getSetting("sfx_send"));

  return (
    <div className="h-screen flex flex-col bg-background">
      <ScreenHeader title="Уведомления" />

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        <SettingsCard>
          <SettingsRow
            label="Звук отправки сообщений"
            hint={sfxSend ? "Короткий звук при каждой отправке" : "Отправка без звука"}
            trailing={
              <input
                type="checkbox"
                className="w-5 h-5 accent-primary shrink-0"
                aria-label="Звук отправки сообщений"
                checked={sfxSend}
                onChange={(e) => { setSfxSend(e.target.checked); setSetting("sfx_send", e.target.checked); }}
              />
            }
          />
        </SettingsCard>

        {profile && !Capacitor.isNativePlatform() && (
          <SettingsCard>
            {/* Звук входящего звонка — пока только веб и десктоп: на телефоне
                звонит система. */}
            <SettingsRow
              icon={Phone}
              label="Звук звонка"
              hint={ringtoneLabel(profile.ringtone, ringName)}
              onClick={() => setRingOpen(true)}
            />
          </SettingsCard>
        )}

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
            <SettingsRow
              icon={Library}
              label="Паки звуков"
              hint="Базовые есть у всех, чужие — по ссылке автора"
              onClick={() => navigate("/profile/soundpacks")}
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

      {ringOpen && profile && (
        <div className="fixed inset-0 z-[80] bg-black/60 flex flex-col justify-end md:items-center md:justify-center" onClick={() => { stopPreview.current?.(); setRingOpen(false); }}>
          <div className="bg-card border-t-2 md:border-2 border-border md:rounded-lg w-full md:w-[420px] pad-safe-bottom" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
              <Phone className="w-5 h-5 text-primary" />
              <span className="font-semibold flex-1">Звук звонка</span>
              <button type="button" onClick={() => { stopPreview.current?.(); setRingOpen(false); }} aria-label="Закрыть"><X className="w-5 h-5" /></button>
            </div>
            <div className="py-1">
              {BUILTIN_RINGTONES.map((r) => {
                const on = (profile.ringtone || "") === r.id;
                return (
                  <button key={r.id || "default"} type="button" onClick={() => { void preview(r.id); void setRingtone(r.id, r.name); }}
                    className="w-full px-4 py-3 text-left text-body flex items-center gap-3 active:bg-secondary">
                    <span className="flex-1">{r.name}</span>
                    {on && <Check className="w-5 h-5 text-primary" />}
                  </button>
                );
              })}
              <button type="button" onClick={() => { stopPreview.current?.(); setRingOpen(false); setRingCatalog(true); }}
                className="w-full px-4 py-3 text-left text-body flex items-center gap-3 active:bg-secondary">
                <Library className="w-5 h-5 text-primary" />
                <span className="flex-1">{(profile.ringtone || "").startsWith("sound:") ? `Из каталога: ${ringName || "…"}` : "Выбрать из каталога звуков…"}</span>
                {(profile.ringtone || "").startsWith("sound:") && <Check className="w-5 h-5 text-primary" />}
              </button>
              <p className="px-4 py-2 text-caption text-subtle">Тап по варианту — короткий прослух. На телефоне звонит система, этот звук — для веб-версии и компьютера.</p>
            </div>
          </div>
        </div>
      )}
      {ringCatalog && profile && (
        <SoundPicker
          title="Звук звонка"
          current={(profile.ringtone || "").startsWith("sound:") ? profile.ringtone!.slice(6) : null}
          onClose={() => setRingCatalog(false)}
          onPick={async (s) => {
            setRingCatalog(false);
            await setRingtone(s ? `sound:${s.id}` : "", s ? s.name : undefined);
          }}
        />
      )}
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
