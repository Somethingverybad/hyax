import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { APP_VERSION, APP_BUILD } from "@/lib/appVersion";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, mediaUrl, type NotificationSoundInfo } from "@/api/client";
import { readCache, writeCache, clearSessionCache } from "@/lib/session-cache";
import { applyServerSettings } from "@/lib/settings";
import { getLang, setLang, applyProfileLang, LANGS, LANG_NAMES, useT } from "@/lib/i18n";
import { Globe } from "lucide-react";
import BottomNav from "@/components/BottomNav";
import { toast } from "sonner";
import { shareProfile, profileLink } from "@/lib/share";
import ShareToChat from "@/components/ShareToChat";
import { useTheme } from "@/lib/theme";
import { checkForUpdate, startUpdate, describeUpdateError } from "@/lib/updateCheck";
import { clearAppCache } from "@/lib/cacheReset";
import { SettingsCard, SettingsRow } from "@/components/settings";
import { Aura, DEFAULT_AURA } from "@/components/Aura";
import { FadeImg } from "@/components/LoadingSkeleton";
import ImageCropper from "@/components/ImageCropper";

// Русские подписи — ключи словаря; переводятся в месте показа.
const SAVED_ACCESS: Record<string, string> = { all: "все", selected: "избранные", none: "только вы" };
import {
  Camera, LogOut, Share2, Copy, Pencil, Images, Bell, Lock, Palette, AtSign, Tag, AlignLeft, Trash2,
  RefreshCw, Bug, Eraser,
  Sticker, Activity, Flame, Lightbulb, Sparkles,
} from "lucide-react";
import Vibometer from "@/components/Vibometer";
import { useMint, MintIcon } from "@/themes/mint";
import { useGlassHeight } from "@/themes/mint/glass";
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
  /** Звук входящего звонка: "" — стандартный, "classic", "sound:<id>" (lib/ringtone.ts). */
  ringtone?: string;
  /** Статус «Скрыт» (Конфиденциальность). */
  hide_online?: boolean;
  /** Кто видит сохранёнки: all | selected | none. */
  saved_visibility?: "all" | "selected" | "none";
  /** Видит админские разделы (мониторинг) — приходит только в своём профиле. */
  is_admin?: boolean;
  aura_color?: string | null;
  aura_text?: string | null;
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
  const t = useT();
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
        applyServerSettings(p);
        applyProfileLang(p);
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
      toast.success(t("Аватар обновлён"));
    } catch (e: any) {
      toast.error(e?.message || t("Не удалось загрузить аватар"));
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
      toast.success(t("Обложка обновлена"));
    } catch (e: any) {
      toast.error(e?.message || t("Не удалось загрузить обложку"));
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
      toast.error(e?.message || t("Не удалось убрать обложку"));
    }
  };

  const logout = async () => {
    clearSessionCache();
    void import("@/lib/secret").then((m) => m.wipeSecretKeys());
    await api.logout();
    navigate("/auth", { replace: true });
  };

  const copy = async (value: string, failMsg: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t("Скопировано"));
    } catch {
      toast.error(failMsg);
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
  // «Поделиться профилем»: сперва предлагаем отправить внутри хуякса, а уже
  // потом системное окно — раньше был только выход наружу.
  const [shareOpen, setShareOpen] = useState(false);
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
            ? t("Установлена последняя версия. Обновления для iOS приходят через TestFlight")
            : t("Установлена последняя версия"),
        );
        return;
      }
      const r = await startUpdate(found);
      if (r.result === "installer") toast.success(t("Версия {version}: установщик запущен", { version: found.version }));
      else if (r.result === "restart") toast.success(t("Версия {version} установлена — перезапускаюсь", { version: found.version }));
      else if (r.result === "cancelled") toast(t("Установка отменена"));
      else if (r.result === "error") toast.error(describeUpdateError(r), { duration: 12000 });
      else toast.success(t("Доступна версия {version} — открываю загрузку", { version: found.version }));
    } catch {
      toast.error(t("Не удалось проверить обновления"));
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
  const mint = useMint();
  const glassRef = useRef<HTMLDivElement>(null);
  useGlassHeight(glassRef, mint);
  const bio = profile?.bio ? profile.bio.split("\n")[0] : "";

  return (
    <div className="h-screen flex flex-col bg-background">
      {mint ? (
        <div ref={glassRef} className="mint-glass shrink-0 pad-safe-top">
          <div className="mint-head !pt-[19px] !pb-[12px]">
            <span />
            <span className="mint-title">{t("Настройки")}</span>
            <button type="button" onClick={() => navigate("/profile/edit")} aria-label={t("Редактировать профиль")}
              className="mint-lime w-[56px] h-[33px] inline-flex items-center justify-center">
              <MintIcon name="pencil" size={[17, 18]} />
            </button>
          </div>
        </div>
      ) : (
      <div className="shrink-0 px-4 py-3 pad-safe-top bg-background min-h-14 flex items-center gap-2">
        <span className="text-h1 flex-1">{t("Настройки")}</span>
        <button
          type="button"
          onClick={() => navigate("/profile/edit")}
          className="w-10 h-10 -mr-2 flex items-center justify-center text-primary active:opacity-60"
          aria-label={t("Редактировать профиль")}
        >
          <Pencil className="w-5 h-5" />
        </button>
      </div>
      )}

      {/* Прокрутка и раскладка разведены намеренно. Когда overflow-y-auto и
          flex-col висели на одном блоке, его высота была ограничена экраном:
          карточки не выходили за край, а ужимались (flex-shrink по умолчанию)
          и обрезались собственным overflow-hidden — пропадали целые строки.
          Теперь скроллит внешний блок, а внутренний свободно растёт вниз. */}
      <div className="flex-1 overflow-y-auto">
        <div className={mint ? "min-h-full px-[17px] pb-4 space-y-[11px] flex flex-col" : "min-h-full px-4 pb-4 space-y-3 flex flex-col"}
          style={{ paddingBottom: "calc(16px + var(--mint-nav-space, 0px))" }}>
          <input ref={avatarRef} type="file" accept="image/*" className="hidden"
                 onChange={(e) => pickImage("avatar", e.target.files?.[0] || null)} />
          <input ref={coverRef} type="file" accept="image/*" className="hidden"
                 onChange={(e) => pickImage("cover", e.target.files?.[0] || null)} />

          {/* Обложка во всю ширину, аватар свешивается с её нижнего края —
              поэтому блок выходит за горизонтальные отступы прокрутки. */}
          <div className={mint ? "shrink-0 -mx-[17px] relative pb-[47px]" : "shrink-0 -mx-4 relative"}>
            <div className={mint ? "h-[139px] w-full bg-surface-3 overflow-hidden" : "h-36 w-full bg-surface-3 overflow-hidden"} style={mint ? { boxShadow: "0 4.3px 13.3px rgb(0 0 0 / 0.25)" } : undefined}>
              {profile?.cover_url && <FadeImg src={mediaUrl(profile.cover_url)} className="w-full h-full" />}
            </div>

            <div className="absolute top-2 right-2 flex gap-2">
              {profile?.cover_url && (
                <button
                  type="button"
                  onClick={removeCover}
                  className="w-9 h-9 rounded-full bg-black/45 text-white flex items-center justify-center active:opacity-70"
                  aria-label={t("Убрать обложку")}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
              <button
                type="button"
                onClick={() => coverRef.current?.click()}
                disabled={uploading !== null}
                className="w-9 h-9 rounded-full bg-black/45 text-white flex items-center justify-center active:opacity-70 disabled:opacity-40"
                aria-label={profile?.cover_url ? t("Сменить обложку") : t("Поставить обложку")}
              >
                <Camera className="w-4 h-4" />
              </button>
            </div>

            <button
              type="button"
              onClick={() => avatarRef.current?.click()}
              disabled={uploading !== null}
              className={mint
                ? "absolute bottom-0 left-1/2 -translate-x-1/2 w-[93px] h-[93px] rounded-[17px] bg-surface-3 border-2 border-white disabled:opacity-60"
                : "absolute -bottom-8 left-4 w-[88px] h-[88px] rounded-lg bg-surface-3 border-4 border-background disabled:opacity-60"}
              style={mint ? { boxShadow: "0 4.3px 13.3px rgb(0 0 0 / 0.25)" } : undefined}
              aria-label={t("Сменить аватар")}
            >
              <Aura active={online} owner={profile} size={mint ? 93 : 88} className="w-full h-full">
                {profile?.avatar_url ? (
                  // Размер явный: обёртка ауры высотой по содержимому, а у FadeImg
                  // содержимое абсолютное — с h-full аватар схлопывался в ноль.
                  <FadeImg src={mediaUrl(profile.avatar_url)} className={mint ? "w-[89px] h-[89px] rounded-[15px]" : "w-20 h-20 rounded-[6px]"} />
                ) : (
                  <span className="w-full h-full flex items-center justify-center text-4xl font-bold text-primary">
                    {(profile?.username || "?")[0]?.toUpperCase()}
                  </span>
                )}
              </Aura>
              <span className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-primary text-primary-foreground border-2 border-background flex items-center justify-center">
                <Camera className="w-3.5 h-3.5" />
              </span>
            </button>
          </div>

          {/* Отступ сверху — под свешивающийся аватар. */}
          <div className={mint ? "shrink-0 pt-[12px] text-center" : "shrink-0 pt-10"}>
            <div className={mint ? "flex items-center justify-center gap-2" : "flex items-center gap-2"}>
              <p className={mint ? "text-[21.3px] leading-tight font-semibold truncate" : "text-[24px] leading-tight font-semibold truncate"} style={mint ? { color: "var(--mint-title)" } : undefined}>{profile?.username || "…"}</p>
              <span className={`${mint ? "w-3 h-3" : "w-2.5 h-2.5"} shrink-0 rounded-full ${online ? (mint ? "bg-[#6ede32]" : "bg-online") : "bg-subtle"}`} title={online ? t("В сети") : t("Скрыт")} aria-hidden />
            </div>
            {(!mint || bio) && <p className={mint ? "mt-1 text-[12.7px] mint-muted truncate" : "mt-1 text-body text-subtle truncate"}>{bio || t("Статус не указан")}</p>}
            {uploading && (
              <p className="mt-1 text-caption text-subtle">
                {uploading === "cover" ? t("Загружаем обложку…") : t("Загружаем аватар…")}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={() => { if (profile?.username) setShareOpen(true); }}
            className={mint
              ? "mint-dark-pill shrink-0 h-[42px] text-[12.7px] flex items-center justify-center gap-[11px]"
              : "shrink-0 h-10 rounded-md bg-surface-4 text-foreground text-small font-medium flex items-center justify-center gap-2 active:opacity-90"}
          >
            {mint ? <MintIcon name="share" size={15} /> : <Share2 className="w-4 h-4" />}
            {t("Поделиться профилем")}
          </button>

          {profile?.id && <Vibometer profileId={profile.id} own initial={(profile as { vibe?: number }).vibe} />}

          <SettingsCard>
            <SettingsRow
              icon={Tag}
              label={t("Никнейм")}
              value={profile?.username || "…"}
              trailing={
                <button
                  type="button"
                  onClick={() => copy(profile?.username || "", t("Не удалось скопировать никнейм"))}
                  className="p-1.5 -mr-1.5 text-subtle active:text-foreground"
                  aria-label={t("Скопировать никнейм")}
                >
                  {mint ? <MintIcon name="rowCopy" size={14} /> : <Copy className="w-4 h-4" />}
                </button>
              }
            />
            <SettingsRow
              icon={AlignLeft}
              label={t("О себе")}
              value={bio || t("Не указано")}
              onClick={() => navigate("/profile/edit")}
            />
            <SettingsRow
              icon={Flame}
              label={t("Аура")}
              value={profile?.aura_text || (profile?.aura_color ? t("без подписи") : t("по умолчанию"))}
              trailing={<span className="w-3 h-3 rounded-full shrink-0" style={{ background: profile?.aura_color || DEFAULT_AURA }} aria-hidden />}
              onClick={() => navigate("/profile/aura")}
            />
            <SettingsRow
              icon={AtSign}
              label={t("Имя пользователя")}
              value={profile?.username ? "@" + profile.username : "…"}
              trailing={
                <button
                  type="button"
                  onClick={() => copy(profile?.username ? "@" + profile.username : "", t("Не удалось скопировать имя"))}
                  className="p-1.5 -mr-1.5 text-subtle active:text-foreground"
                  aria-label={t("Скопировать имя пользователя")}
                >
                  {mint ? <MintIcon name="rowCopy" size={14} /> : <Copy className="w-4 h-4" />}
                </button>
              }
            />
          </SettingsCard>

          <SettingsCard>
            <SettingsRow
              icon={Images}
              label={t("Сохранёнки")}
              hint={t("Видят: {who}", { who: t(SAVED_ACCESS[profile?.saved_visibility || "all"]) })}
              value={saved ? pluralPhotos(saved.count) : "…"}
              onClick={() => setGalleryOpen(true)}
            />
            <SettingsRow
              icon={Bell}
              label={t("Уведомления")}
              value={profile?.notify_sound ? profile.notify_sound.name : t("Обычный звук")}
              onClick={() => navigate("/profile/notifications")}
            />
            <SettingsRow
              icon={Sticker}
              label={t("Стикерпаки")}
              hint={t("Свои наборы и добавление по ссылке")}
              onClick={() => navigate("/profile/stickerpacks")}
            />
            <SettingsRow
              icon={Lock}
              label={t("Конфиденциальность")}
              onClick={() => navigate("/profile/privacy")}
            />
            <SettingsRow
              icon={Palette}
              label={t("Внешний вид")}
              value={theme.builtin ? t(theme.name) : theme.name}
              onClick={() => navigate("/profile/appearance")}
            />
            <SettingsRow
              icon={Globe}
              label={t("Язык")}
              value={LANG_NAMES[getLang()]}
              onClick={() => navigate("/profile/language")}
            />
          </SettingsCard>

          <SettingsCard>
            <SettingsRow
              icon={RefreshCw}
              label={t("Проверить обновления")}
              value={checking ? t("Проверяю…") : APP_VERSION}
              onClick={checkUpdates}
            />
            <SettingsRow
              icon={Bug}
              label={t("Сообщить о проблеме")}
              hint={t("Скриншот и лог уйдут разработчикам")}
              onClick={() => navigate("/profile/bugreport")}
            />
            <SettingsRow
              icon={Eraser}
              label={clearing ? t("Очищаю…") : confirmClear ? t("Нажми ещё раз — точно очистить") : t("Очистить кэш")}
              hint={confirmClear ? t("Ленты и медиа перекачаются, вход и тема останутся") : t("Если что-то отображается неправильно")}
              onClick={clearCache}
              danger={confirmClear}
              trailing={<span />}
            />
          </SettingsCard>

          <SettingsCard>
            <SettingsRow
              icon={Lightbulb}
              label={t("Долгий ящик")}
              hint={t("Идеи для WYX: предложить, голосовать, что уже сделано")}
              onClick={() => navigate("/profile/ideas")}
            />
          </SettingsCard>

          {profile?.is_admin && (
            <SettingsCard>
              <SettingsRow
                icon={Activity}
                label={t("Мониторинг")}
                hint={t("Онлайн, пользователи, нагрузка сервера")}
                onClick={() => navigate("/monitoring")}
              />
              <SettingsRow
                icon={Sparkles}
                label={t("Уровни вайбометра")}
                hint={t("Пороги, цвета, свечение, длина шкалы")}
                onClick={() => navigate("/profile/vibe-levels")}
              />
            </SettingsCard>
          )}

          <SettingsCard>
            <SettingsRow icon={LogOut} label={t("Выйти")} danger onClick={logout} trailing={<span />} />
          </SettingsCard>

          {/* Версия — чтобы сверить с huyax.e-tree.su/apk. Номер сборки один на
              всех платформах (число коммитов); у iOS свой счётчик в TestFlight,
              его показываем рядом, если он отличается. */}
          <div className="shrink-0 mt-auto pt-4 text-center text-caption text-subtle select-text">
            {t("WYX {version} · сборка {build}", { version: APP_VERSION, build: APP_BUILD })}
            {nativeBuild && nativeBuild !== APP_BUILD ? ` · ${platformLabel} ${nativeBuild}` : ""}
            {/* Лицензия анимированных эмодзи (CC BY 4.0) требует указать авторов. */}
            <div className="mt-1 opacity-80">{t("Анимированные эмодзи: Noto Emoji, Google, CC BY 4.0")}</div>
          </div>
        </div>
      </div>

      <ShareToChat
        open={shareOpen}
        title={t("Отправить профиль")}
        text={profile?.username ? profileLink(profile.username) : ""}
        onClose={() => setShareOpen(false)}
        onShareOutside={async () => {
          if (!profile?.username) return;
          const r = await shareProfile(profile.username);
          if (r === "copied") toast.success(t("Ссылка скопирована"));
          else if (r === "error") toast.error(t("Не удалось поделиться"));
        }}
      />

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
