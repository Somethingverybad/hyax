import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { APP_VERSION, APP_BUILD } from "@/lib/appVersion";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, mediaUrl, type NotificationSoundInfo } from "@/api/client";
import { readCache, writeCache, clearSessionCache } from "@/lib/session-cache";
import BottomNav from "@/components/BottomNav";
import { toast } from "sonner";
import { shareProfile } from "@/lib/share";
import { useTheme } from "@/lib/theme";
import { checkForUpdate, startUpdate } from "@/lib/updateCheck";
import { clearAppCache } from "@/lib/cacheReset";
import { SettingsCard, SettingsRow } from "@/components/settings";
import ImageCropper from "@/components/ImageCropper";

const SAVED_ACCESS: Record<string, string> = { all: "все", selected: "избранные", none: "только вы" };
import {
  Camera, LogOut, Share2, Copy, Pencil, Images, Bell, Lock, Palette, AtSign, Tag, AlignLeft, Trash2,
  RefreshCw, Bug, Eraser,
  Sticker,
} from "lucide-react";
import SavedGallery, { pluralPhotos } from "@/components/SavedGallery";

export interface Profile {
  id: string;
  username: string;
  avatar_url?: string | null;
  cover_url?: string | null;
  bio?: string | null;
  status?: string;
  push_preview?: boolean;
  rov_enabled?: boolean;
  notify_sound?: NotificationSoundInfo | null;
  /** Статус «Скрыт» (Конфиденциальность). */
  hide_online?: boolean;
  /** Кто видит сохранёнки: all | selected | none. */
  saved_visibility?: "all" | "selected" | "none";
}

/**
 * Профиль: обложка с аватаром, карточка имени и списки настроек.
 *
 * Разложено по макету редизайна: сам экран только показывает, а правки текста
 * уехали на «Редактировать» (/profile/edit), тумблеры — в «Уведомления».
 * Картинки (аватар и обложка) меняются прямо здесь, как на макете.
 *
 * Никнейм — это Profile.username, отображаемое имя в чатах. Логин при этом
 * не меняется: он живёт отдельно и используется только для входа.
 */
const ProfilePage = () => {
  const navigate = useNavigate();
  const theme = useTheme();
  // Стартуем из кеша сессии — экран рисуется сразу, сеть обновит фоном.
  const cached = readCache<Profile>("user");
  const [profile, setProfile] = useState<Profile | null>(cached);
  const [uploading, setUploading] = useState<"avatar" | "cover" | null>(null);
  const avatarRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);
  // Выбранная, но ещё не кадрированная картинка: пока она здесь, открыт кадратор.
  // kind решает форму рамки и куда уйдёт результат.
  const [cropping, setCropping] = useState<{ file: File; kind: "avatar" | "cover" } | null>(null);

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

  const pickImage = (kind: "avatar" | "cover", file: File | null) => {
    const input = kind === "avatar" ? avatarRef.current : coverRef.current;
    if (input) input.value = "";
    if (file) setCropping({ file, kind });
  };

  const changeAvatar = async (file: File | null) => {
    if (!file) return;
    setCropping(null);
    setUploading("avatar");
    try {
      const res = await api.uploadAvatar(file);
      setProfile((p) => {
        if (!p) return p;
        const next = { ...p, avatar_url: res.avatar_url };
        writeCache("user", next);
        return next;
      });
      toast.success("Аватар обновлён");
    } catch (e: any) {
      toast.error(e?.message || "Не удалось загрузить аватар");
    } finally {
      setUploading(null);
    }
  };

  const changeCover = async (file: File | null) => {
    if (!file) return;
    setCropping(null);
    setUploading("cover");
    try {
      const res = await api.uploadCover(file);
      setProfile((p) => {
        if (!p) return p;
        const next = { ...p, cover_url: res.cover_url };
        writeCache("user", next);
        return next;
      });
      toast.success("Обложка обновлена");
    } catch (e: any) {
      toast.error(e?.message || "Не удалось загрузить обложку");
    } finally {
      setUploading(null);
    }
  };

  const removeCover = async () => {
    try {
      await api.removeCover();
      setProfile((p) => {
        if (!p) return p;
        const next = { ...p, cover_url: null };
        writeCache("user", next);
        return next;
      });
    } catch (e: any) {
      toast.error(e?.message || "Не удалось убрать обложку");
    }
  };

  const logout = async () => {
    clearSessionCache();
    await api.logout();
    navigate("/auth", { replace: true });
  };

  const copy = async (value: string, what: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Скопировано");
    } catch {
      toast.error(`Не удалось скопировать ${what}`);
    }
  };

  // Нативный номер сборки (versionCode / CFBundleVersion): на Android совпадает
  // с APP_BUILD, на iOS — свой счётчик TestFlight.
  const [nativeBuild, setNativeBuild] = useState<string | null>(null);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    App.getInfo().then((i) => setNativeBuild(i.build)).catch(() => {});
  }, []);
  const platformLabel = Capacitor.getPlatform() === "ios" ? "iOS" : "Android";

  // Сохранёнки: на экране только счётчик, сама сетка — в галерее.
  const [saved, setSaved] = useState<{ count: number } | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const loadSaved = () =>
    api.listSavedImages(undefined, 1).then((r) => setSaved({ count: r.count })).catch(() => setSaved({ count: 0 }));
  useEffect(() => { void loadSaved(); }, []);

  // Проверка обновлений вручную. Плашка на экране чатов показывается сама,
  // но она одноразовая (закрыл — до следующей версии не вернётся), а спросить
  // «а есть ли новая» человек хочет тогда, когда сам решил.
  const [checking, setChecking] = useState(false);
  const checkUpdates = async () => {
    if (checking) return;
    setChecking(true);
    try {
      const found = await checkForUpdate();
      if (!found) {
        toast.success(
          Capacitor.getPlatform() === "ios"
            ? "Установлена последняя версия. Обновления для iOS приходят через TestFlight"
            : "Установлена последняя версия",
        );
        return;
      }
      const r = await startUpdate(found);
      if (r === "installer") toast.success(`Версия ${found.version}: установщик запущен`);
      else if (r === "error") toast.error("Не удалось скачать обновление");
      else toast.success(`Доступна версия ${found.version} — открываю загрузку`);
    } catch {
      toast.error("Не удалось проверить обновления");
    } finally {
      setChecking(false);
    }
  };

  // Сброс кеша — в два тапа: первый переводит строку в режим подтверждения,
  // второй чистит. Без модалки: она тут тяжелее самого действия, а случайный
  // тап всего лишь заставит перекачать ленты.
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  useEffect(() => {
    if (!confirmClear) return;
    const t = setTimeout(() => setConfirmClear(false), 4000);
    return () => clearTimeout(t);
  }, [confirmClear]);
  const clearCache = async () => {
    if (clearing) return;
    if (!confirmClear) { setConfirmClear(true); return; }
    setClearing(true);
    await clearAppCache(); // сам перезагрузит приложение
  };

  // Своя точка: зелёная — «В сети», серая — выбран статус «Скрыт».
  const online = !profile?.hide_online;
  const bio = profile?.bio ? profile.bio.split("\n")[0] : "";

  return (
    <div className="h-screen flex flex-col bg-background">
      <div className="shrink-0 px-4 py-3 pad-safe-top bg-background min-h-14 flex items-center gap-2">
        <span className="text-h1 flex-1">Профиль</span>
        <button
          type="button"
          onClick={() => navigate("/profile/edit")}
          className="w-10 h-10 -mr-2 flex items-center justify-center text-primary active:opacity-60"
          aria-label="Редактировать профиль"
        >
          <Pencil className="w-5 h-5" />
        </button>
      </div>

      {/* Прокрутка и раскладка разведены намеренно. Когда overflow-y-auto и
          flex-col висели на одном блоке, его высота была ограничена экраном:
          карточки не выходили за край, а ужимались (flex-shrink по умолчанию)
          и обрезались собственным overflow-hidden — пропадали целые строки.
          Теперь скроллит внешний блок, а внутренний свободно растёт вниз. */}
      <div className="flex-1 overflow-y-auto">
        <div className="min-h-full px-4 pb-4 space-y-3 flex flex-col">
          <input ref={avatarRef} type="file" accept="image/*" className="hidden"
                 onChange={(e) => pickImage("avatar", e.target.files?.[0] || null)} />
          <input ref={coverRef} type="file" accept="image/*" className="hidden"
                 onChange={(e) => pickImage("cover", e.target.files?.[0] || null)} />

          {/* Обложка во всю ширину, аватар свешивается с её нижнего края —
              поэтому блок выходит за горизонтальные отступы прокрутки. */}
          <div className="shrink-0 -mx-4 relative">
            <div className="h-36 w-full bg-surface-3 overflow-hidden">
              {profile?.cover_url && (
                <img src={mediaUrl(profile.cover_url)} alt="" className="w-full h-full object-cover" />
              )}
            </div>

            <div className="absolute top-2 right-2 flex gap-2">
              {profile?.cover_url && (
                <button
                  type="button"
                  onClick={removeCover}
                  className="w-9 h-9 rounded-full bg-black/45 text-white flex items-center justify-center active:opacity-70"
                  aria-label="Убрать обложку"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
              <button
                type="button"
                onClick={() => coverRef.current?.click()}
                disabled={uploading !== null}
                className="w-9 h-9 rounded-full bg-black/45 text-white flex items-center justify-center active:opacity-70 disabled:opacity-40"
                aria-label={profile?.cover_url ? "Сменить обложку" : "Поставить обложку"}
              >
                <Camera className="w-4 h-4" />
              </button>
            </div>

            <button
              type="button"
              onClick={() => avatarRef.current?.click()}
              disabled={uploading !== null}
              className="absolute -bottom-8 left-4 w-[88px] h-[88px] rounded-lg bg-surface-3 border-4 border-background disabled:opacity-60"
              aria-label="Сменить аватар"
            >
              {profile?.avatar_url ? (
                <img src={mediaUrl(profile.avatar_url)} alt="" className="w-full h-full rounded-[6px] object-cover" />
              ) : (
                <span className="w-full h-full flex items-center justify-center text-4xl font-bold text-primary">
                  {(profile?.username || "?")[0]?.toUpperCase()}
                </span>
              )}
              <span className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-primary text-primary-foreground border-2 border-background flex items-center justify-center">
                <Camera className="w-3.5 h-3.5" />
              </span>
            </button>
          </div>

          {/* Отступ сверху — под свешивающийся аватар. */}
          <div className="shrink-0 pt-10">
            <div className="flex items-center gap-2">
              <p className="text-[24px] leading-tight font-semibold truncate">{profile?.username || "…"}</p>
              <span className={`w-2.5 h-2.5 shrink-0 rounded-full ${online ? "bg-online" : "bg-subtle"}`} title={online ? "В сети" : "Скрыт"} aria-hidden />
            </div>
            <p className="mt-1 text-body text-subtle truncate">{bio || "Статус не указан"}</p>
            {uploading && (
              <p className="mt-1 text-caption text-subtle">
                {uploading === "cover" ? "Загружаем обложку…" : "Загружаем аватар…"}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={async () => {
              if (!profile?.username) return;
              const r = await shareProfile(profile.username);
              if (r === "copied") toast.success("Профиль скопирован");
              else if (r === "error") toast.error("Не удалось поделиться");
            }}
            className="shrink-0 h-10 rounded-md bg-surface-4 text-foreground text-small font-medium flex items-center justify-center gap-2 active:opacity-90"
          >
            <Share2 className="w-4 h-4" />
            Поделиться профилем
          </button>

          <SettingsCard>
            <SettingsRow
              icon={Tag}
              label="Никнейм"
              value={profile?.username || "…"}
              trailing={
                <button
                  type="button"
                  onClick={() => copy(profile?.username || "", "никнейм")}
                  className="p-1.5 -mr-1.5 text-subtle active:text-foreground"
                  aria-label="Скопировать никнейм"
                >
                  <Copy className="w-4 h-4" />
                </button>
              }
            />
            <SettingsRow
              icon={AlignLeft}
              label="О себе"
              value={bio || "Не указано"}
              onClick={() => navigate("/profile/edit")}
            />
            <SettingsRow
              icon={AtSign}
              label="Имя пользователя"
              value={profile?.username ? "@" + profile.username : "…"}
              trailing={
                <button
                  type="button"
                  onClick={() => copy(profile?.username ? "@" + profile.username : "", "имя")}
                  className="p-1.5 -mr-1.5 text-subtle active:text-foreground"
                  aria-label="Скопировать имя пользователя"
                >
                  <Copy className="w-4 h-4" />
                </button>
              }
            />
          </SettingsCard>

          <SettingsCard>
            <SettingsRow
              icon={Images}
              label="Сохранёнки"
              hint={`Видят: ${SAVED_ACCESS[profile?.saved_visibility || "all"]}`}
              value={saved ? pluralPhotos(saved.count) : "…"}
              onClick={() => setGalleryOpen(true)}
            />
            <SettingsRow
              icon={Bell}
              label="Уведомления"
              value={profile?.notify_sound ? profile.notify_sound.name : "Обычный звук"}
              onClick={() => navigate("/profile/notifications")}
            />
            <SettingsRow
              icon={Sticker}
              label="Стикерпаки"
              hint="Свои наборы и импорт из Telegram"
              onClick={() => navigate("/profile/stickerpacks")}
            />
            <SettingsRow
              icon={Lock}
              label="Конфиденциальность"
              onClick={() => navigate("/profile/privacy")}
            />
            <SettingsRow
              icon={Palette}
              label="Внешний вид"
              value={theme.name}
              onClick={() => navigate("/profile/appearance")}
            />
          </SettingsCard>

          <SettingsCard>
            <SettingsRow
              icon={RefreshCw}
              label="Проверить обновления"
              value={checking ? "Проверяю…" : APP_VERSION}
              onClick={checkUpdates}
            />
            <SettingsRow
              icon={Bug}
              label="Сообщить о проблеме"
              hint="Скриншот и лог уйдут разработчикам"
              onClick={() => navigate("/profile/bugreport")}
            />
            <SettingsRow
              icon={Eraser}
              label={clearing ? "Очищаю…" : confirmClear ? "Нажми ещё раз — точно очистить" : "Очистить кэш"}
              hint={confirmClear ? "Ленты и медиа перекачаются, вход и тема останутся" : "Если что-то отображается неправильно"}
              onClick={clearCache}
              danger={confirmClear}
              trailing={<span />}
            />
          </SettingsCard>

          <SettingsCard>
            <SettingsRow icon={LogOut} label="Выйти" danger onClick={logout} trailing={<span />} />
          </SettingsCard>

          {/* Версия — чтобы сверить с huyax.e-tree.su/apk. Номер сборки один на
              всех платформах (число коммитов); у iOS свой счётчик в TestFlight,
              его показываем рядом, если он отличается. */}
          <div className="shrink-0 mt-auto pt-4 text-center text-caption text-subtle select-text">
            WhoYaX {APP_VERSION} · сборка {APP_BUILD}
            {nativeBuild && nativeBuild !== APP_BUILD ? ` · ${platformLabel} ${nativeBuild}` : ""}
          </div>
        </div>
      </div>

      {cropping && (
        <ImageCropper
          file={cropping.file}
          aspect={cropping.kind === "cover" ? 3 : 1}
          outWidth={cropping.kind === "cover" ? 1200 : 640}
          onCancel={() => setCropping(null)}
          onDone={(cropped) => void (cropping.kind === "cover" ? changeCover(cropped) : changeAvatar(cropped))}
        />
      )}

      {galleryOpen && (
        <SavedGallery own onClose={() => { setGalleryOpen(false); void loadSaved(); }} />
      )}

      <BottomNav />
    </div>
  );
};

export default ProfilePage;
