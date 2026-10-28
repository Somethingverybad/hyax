import { signedIn } from "@/lib/signedIn";
import { t } from "@/lib/i18n";
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
import { petsHidden, setPetsHidden } from "@/lib/pets";
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
  const [petsHiddenNow, setPetsHiddenNow] = useState(petsHidden);
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
  // Подписи встроенных звонков (lib/ringtone) — русские ключи словаря;
  // название звука из каталога — как его назвал автор, не переводим.
  const ringLabel = (value: string | undefined) =>
    (value || "").startsWith("sound:") && ringName ? ringName : t(ringtoneLabel(value, ringName));
  const setRingtone = async (value: string, name?: string) => {
    if (!profile) return;
    const ok = await patch({ ringtone: value }, { ...profile, ringtone: value }, profile);
    if (ok) toast.success(t("Звонок: {name}", { name: name || ringLabel(value) }));
  };

  useEffect(() => {
    (async () => {
      try {
        const p = await api.getCurrentUser();
        setProfile(p);
        writeCache("user", p);
      } catch {
        // Сеть подвела — остаёмся с кэшем; на вход только без токена (lib/signedIn).
        if (!signedIn()) navigate("/auth", { replace: true });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      toast.error(t("Не удалось сохранить"));
      setProfile(prev);
      writeCache("user", prev);
      return false;
    }
  };

  // Звук отправки — локально на устройстве, без сервера.
  const [sfxSend, setSfxSend] = useState(() => getSetting("sfx_send"));

  return (
    <div className="h-screen flex flex-col bg-background">
      <ScreenHeader title={t("Уведомления")} />

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        <SettingsCard>
          <SettingsRow
            label={t("Звук отправки сообщений")}
            hint={t("Звук при нажатии кнопки отправки. Выключите — сообщения будут уходить без звука")}
            trailing={
              <input
                type="checkbox"
                className="w-5 h-5 accent-primary shrink-0"
                aria-label={t("Звук отправки сообщений")}
                checked={sfxSend}
                onChange={(e) => { setSfxSend(e.target.checked); setSetting("sfx_send", e.target.checked); }}
              />
            }
          />
        </SettingsCard>

        {profile && (
          <SettingsCard>
            {/* Звук входящих: выключен — обычные сообщения приходят без звука
                (пуши и звук в приложении), а звук, который мне отправили
                специально (аудио-стикер), играет всё равно. */}
            <SettingsRow
              label={t("Звук входящих сообщений")}
              hint={profile.notify_silent
                ? t("Выключен — сообщения приходят без звука. Звук, который вам отправили специально, всё равно проиграется")
                : t("Включён — у сообщений звук отправителя или обычный")}
              trailing={
                <Toggle
                  label={t("Звук входящих сообщений")}
                  checked={!profile.notify_silent}
                  onChange={async (v) => {
                    if (!(await patch({ notify_silent: !v }, { ...profile, notify_silent: !v }, profile))) return;
                    // Выключил звук — сервер списал вайб (VIBE_SILENT), включил — вернул.
                    if (!v) toast(t("Вы вообще не вайбитесь — штраф −99999 к вайбометру"));
                    else toast.success(t("Вот теперь вы вайбитесь! Вайб вернули целиком"));
                  }}
                />
              }
            />
          </SettingsCard>
        )}

        {profile && !Capacitor.isNativePlatform() && (
          <SettingsCard>
            {/* Звук входящего звонка — пока только веб и десктоп: на телефоне
                звонит система. */}
            <SettingsRow
              icon={Phone}
              label={t("Звук звонка")}
              hint={ringLabel(profile.ringtone)}
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
              label={t("Мой звук уведомлений")}
              hint={
                profile.notify_sound
                  ? t("{name} — так звучат мои сообщения у других", { name: profile.notify_sound.name })
                  : t("Обычный — выбери свой, его услышат собеседники")
              }
              onClick={() => setPickerOpen(true)}
            />
            <SettingsRow
              icon={Library}
              label={t("Паки звуков")}
              hint={t("Базовые есть у всех, чужие — по ссылке автора")}
              onClick={() => navigate("/profile/soundpacks")}
            />
          </SettingsCard>
        )}

        {profile && (
          <SettingsCard>
            {/* Р.Ё.В: вибрация, которую шлёт собеседник, пока держит палец.
                Выключено — сервер такие сигналы до нас не доводит. */}
            <SettingsRow
              label={t("Принимать Р.Ё.В")}
              hint={t("У кнопки записи в чате есть режим Р.Ё.В.: пока собеседник держит её, ваш телефон вибрирует. Выключите, если не хотите получать такие вибрации")}
              trailing={
                <Toggle
                  label={t("Принимать Р.Ё.В")}
                  checked={profile.rov_enabled !== false}
                  onChange={(v) => patch({ rov_enabled: v }, { ...profile, rov_enabled: v }, profile)}
                />
              }
            />
            {/* Посты собеседников на Стене (chat/wall_notify.py). Отдельных
                авторов глушат в меню их поста — «Не уведомлять о постах». */}
            <SettingsRow
              label={t("Посты собеседников на Стене")}
              hint={t("Пуш, когда тот, с кем у вас есть личный чат, пишет на Стене. Отдельного автора можно заглушить в меню его поста")}
              trailing={
                <Toggle
                  label={t("Посты собеседников на Стене")}
                  checked={profile.notify_wall !== false}
                  onChange={(v) => patch({ notify_wall: v }, { ...profile, notify_wall: v }, profile)}
                />
              }
            />
            {/* Питомец: сутки без ухода — пуш (chat/pets.py), не чаще раза в сутки. */}
            <SettingsRow
              label={t("Напоминания питомца")}
              hint={t("Если сутки не ухаживали — питомец напомнит о себе, раз в день")}
              trailing={
                <Toggle
                  label={t("Напоминания питомца")}
                  checked={profile.notify_pet !== false}
                  onChange={(v) => patch({ notify_pet: v }, { ...profile, notify_pet: v }, profile)}
                />
              }
            />
            {/* Чужие питомцы в переписке — только на этом устройстве. */}
            <SettingsRow
              label={t("Питомцы в чатах")}
              hint={t("Питомцы собеседников гуляют по сообщениям. Выключите, если отвлекают (на этом устройстве)")}
              trailing={<Toggle label={t("Питомцы в чатах")} checked={!petsHiddenNow} onChange={(v) => { setPetsHidden(!v); setPetsHiddenNow(!v); }} />}
            />
            {/* Текст в уведомлениях. Выключено — сервер шлёт «Новое сообщение»
                вместо текста; сам пуш при этом всё равно зашифрован. */}
            {Capacitor.isNativePlatform() && (
              <SettingsRow
                label={t("Текст в уведомлениях")}
                hint={t("Выключи — в пуше будет только «Новое сообщение»")}
                trailing={
                  <Toggle
                    label={t("Текст в уведомлениях")}
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
              <span className="font-semibold flex-1">{t("Звук звонка")}</span>
              <button type="button" onClick={() => { stopPreview.current?.(); setRingOpen(false); }} aria-label={t("Закрыть")}><X className="w-5 h-5" /></button>
            </div>
            <div className="py-1">
              {BUILTIN_RINGTONES.map((r) => {
                const on = (profile.ringtone || "") === r.id;
                return (
                  <button key={r.id || "default"} type="button" onClick={() => { void preview(r.id); void setRingtone(r.id, t(r.name)); }}
                    className="w-full px-4 py-3 text-left text-body flex items-center gap-3 active:bg-secondary">
                    <span className="flex-1">{t(r.name)}</span>
                    {on && <Check className="w-5 h-5 text-primary" />}
                  </button>
                );
              })}
              <button type="button" onClick={() => { stopPreview.current?.(); setRingOpen(false); setRingCatalog(true); }}
                className="w-full px-4 py-3 text-left text-body flex items-center gap-3 active:bg-secondary">
                <Library className="w-5 h-5 text-primary" />
                <span className="flex-1">{(profile.ringtone || "").startsWith("sound:") ? t("Из каталога: {name}", { name: ringName || "…" }) : t("Выбрать из каталога звуков…")}</span>
                {(profile.ringtone || "").startsWith("sound:") && <Check className="w-5 h-5 text-primary" />}
              </button>
              <p className="px-4 py-2 text-caption text-subtle">{t("Тап по варианту — короткий прослух. На телефоне звонит система, этот звук — для веб-версии и компьютера.")}</p>
            </div>
          </div>
        </div>
      )}
      {ringCatalog && profile && (
        <SoundPicker
          title={t("Звук звонка")}
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
          title={t("Мой звук уведомлений")}
          current={profile.notify_sound?.id || null}
          onClose={() => setPickerOpen(false)}
          onPick={async (s) => {
            setPickerOpen(false);
            const ok = await patch(
              { notify_sound_id: s ? s.id : null },
              { ...profile, notify_sound: s },
              profile,
            );
            if (ok) toast.success(s ? t("Теперь твои сообщения звучат как «{name}»", { name: s.name }) : t("Обычный звук"));
          }}
        />
      )}
    </div>
  );
};

export default ProfileNotifications;
