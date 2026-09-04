import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { APP_VERSION, APP_BUILD } from "@/lib/appVersion";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, mediaUrl } from "@/api/client";
import { readCache, writeCache, clearSessionCache } from "@/lib/session-cache";
import BottomNav from "@/components/BottomNav";
import { toast } from "sonner";
import { shareProfile } from "@/lib/share";
import { Camera, LogOut, Share2, Copy, ChevronRight } from "lucide-react";
import SavedGallery, { SavedTile, pluralPhotos } from "@/components/SavedGallery";
import type { SavedImage } from "@/api/client";

interface Profile {
  id: string;
  username: string;
  avatar_url?: string | null;
  bio?: string | null;
}

/**
 * Настройки профиля: аватар, никнейм, статус.
 *
 * Никнейм — это Profile.username, отображаемое имя в чатах. Логин при этом
 * не меняется: он живёт отдельно и используется только для входа.
 * «Статус» — поле bio на сервере.
 */
const ProfilePage = () => {
  const navigate = useNavigate();
  // Стартуем из кеша сессии — экран рисуется сразу, сеть обновит фоном.
  const cached = readCache<Profile>("user");
  const [profile, setProfile] = useState<Profile | null>(cached);
  const [username, setUsername] = useState(cached?.username || "");
  const [bio, setBio] = useState(cached?.bio || "");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const p = await api.getCurrentUser();
        setProfile(p);
        setUsername(p.username || "");
        setBio(p.bio || "");
        writeCache("user", p);
      } catch {
        navigate("/auth", { replace: true });
      }
    })();
  }, [navigate]);

  const save = async () => {
    if (!profile) return;
    setSaving(true);
    try {
      const updated = await api.updateProfile(profile.id, {
        username: username.trim(),
        bio: bio.trim(),
      });
      setProfile(updated);
      writeCache("user", updated);
      toast.success("Сохранено");
    } catch (e: any) {
      toast.error(e?.message || "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  };

  const changeAvatar = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    try {
      const res = await api.uploadAvatar(file);
      setProfile((p) => (p ? { ...p, avatar_url: res.avatar_url } : p));
      toast.success("Аватар обновлён");
    } catch (e: any) {
      toast.error(e?.message || "Не удалось загрузить аватар");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const logout = async () => {
    clearSessionCache();
    await api.logout();
    navigate("/auth", { replace: true });
  };

  const dirty =
    profile !== null &&
    (username.trim() !== (profile.username || "") || bio.trim() !== (profile.bio || ""));

  // Нативный номер сборки (versionCode / CFBundleVersion): на Android совпадает
  // с APP_BUILD, на iOS — свой счётчик TestFlight.
  const [nativeBuild, setNativeBuild] = useState<string | null>(null);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    App.getInfo().then((i) => setNativeBuild(i.build)).catch(() => {});
  }, []);
  // Сохранёнки: счётчик и пять превью для карточки в профиле.
  const [saved, setSaved] = useState<{ count: number; items: SavedImage[] } | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const loadSaved = () => api.listSavedImages(undefined, 5).then(setSaved).catch(() => setSaved({ count: 0, items: [] }));
  useEffect(() => { void loadSaved(); }, []);
  const platformLabel = Capacitor.getPlatform() === "ios" ? "iOS" : "Android";

  return (
    <div className="h-screen flex flex-col bg-background">
      <div className="shrink-0 px-4 py-3 pad-safe-top bg-background min-h-14 flex items-center">
        <span className="text-h1">Профиль</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 flex flex-col">
        {/* Аватар слева, имя и статус справа — как карточка профиля в референсе.
            Смена аватара — красный бейдж-камера в углу. */}
        <div className="flex items-center gap-4">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => changeAvatar(e.target.files?.[0] || null)}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="relative w-[104px] h-[104px] shrink-0 rounded-lg bg-surface-3 disabled:opacity-60"
            aria-label="Сменить аватар"
          >
            {profile?.avatar_url ? (
              <img src={mediaUrl(profile.avatar_url)} alt="" className="w-full h-full rounded-lg object-cover" />
            ) : (
              <span className="w-full h-full flex items-center justify-center text-4xl font-bold text-primary">
                {(profile?.username || "?")[0]?.toUpperCase()}
              </span>
            )}
            <span className="absolute -bottom-1.5 -right-1.5 w-8 h-8 rounded-full bg-primary text-primary-foreground border-2 border-background flex items-center justify-center">
              <Camera className="w-4 h-4" />
            </span>
          </button>
          <div className="min-w-0">
            <p className="text-[24px] leading-tight font-semibold truncate">{profile?.username || "…"}</p>
            <p className="mt-2 text-body text-subtle truncate">{profile?.bio ? profile.bio.split("\n")[0] : "Статус не указан"}</p>
            {uploading && <p className="mt-1 text-caption text-subtle">Загрузка…</p>}
          </div>
        </div>

        <button
          type="button"
          onClick={async () => {
            if (!profile?.username) return;
            const r = await shareProfile(profile.username);
            if (r === "copied") toast.success("Профиль скопирован");
            else if (r === "error") toast.error("Не удалось поделиться");
          }}
          className="h-9 rounded-md bg-surface-4 text-foreground text-small font-medium flex items-center justify-center gap-2 active:opacity-90"
        >
          <Share2 className="w-4 h-4" />
          Поделиться профилем
        </button>

        <div className="rounded-lg bg-surface-2 p-4 space-y-3">
          <div className="space-y-1.5">
            <label className="text-small text-subtle">Никнейм</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              maxLength={50}
              className="w-full h-10 rounded-md bg-surface-4 border border-transparent px-3 text-body outline-none focus:border-amber"
            />
            <p className="text-caption text-subtle">Имя, которое видят собеседники. Логин для входа не меняется.</p>
          </div>
          <div className="space-y-1.5">
            <label className="text-small text-subtle">Статус</label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              maxLength={500}
              rows={2}
              placeholder="Например: на связи после 18:00"
              className="w-full rounded-md bg-surface-4 border border-transparent px-3 py-2 text-body outline-none resize-none focus:border-amber"
            />
          </div>
          <button
            type="button"
            onClick={save}
            disabled={saving || !dirty || username.trim().length < 2}
            className="w-full h-10 rounded-md bg-primary text-primary-foreground font-medium disabled:opacity-40"
          >
            {saving ? "Сохраняем…" : "Сохранить"}
          </button>
        </div>

        <div className="rounded-lg bg-surface-2 p-4">
          <p className="text-h2 mb-1">Информация</p>
          {[
            ["Имя пользователя", profile?.username ? "@" + profile.username : "…"],
            ["ID пользователя", profile?.id || "…"],
          ].map(([label, value]) => (
            <div key={label} className="flex items-center gap-3 h-9">
              <span className="text-small text-subtle w-32 shrink-0">{label}</span>
              <span className="text-small text-muted-foreground flex-1 min-w-0 truncate">{value}</span>
              <button
                type="button"
                onClick={async () => { try { await navigator.clipboard.writeText(value); toast.success("Скопировано"); } catch { toast.error("Не удалось скопировать"); } }}
                className="p-1.5 text-subtle active:text-foreground"
                aria-label={`Скопировать: ${label}`}
              >
                <Copy className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>

        <div className="rounded-lg bg-surface-2 p-4">
          <div className="flex items-center gap-2">
            <span className="text-h2 flex-1">Сохранёнки</span>
            <span className="text-small text-subtle">{saved ? pluralPhotos(saved.count) : "…"}</span>
          </div>
          {(saved?.items || []).length > 0 ? (
            <div className="mt-3 grid grid-cols-5 gap-1.5">
              {(saved?.items || []).map((it) => <SavedTile key={it.id} item={it} className="aspect-square w-full rounded-[8px] ring-1 ring-white/5" onClick={() => setGalleryOpen(true)} />)}
            </div>
          ) : (
            <p className="mt-2 text-small text-subtle">Открой фото в чате, тапни по нему и выбери «Добавить в сохранёнки».</p>
          )}
          <button type="button" onClick={() => setGalleryOpen(true)} className="mt-3 -mb-4 -mx-4 px-4 h-11 w-[calc(100%+32px)] border-t border-border flex items-center text-body active:bg-surface-3">
            <span className="flex-1 text-left">Все сохранёнки</span>
            <ChevronRight className="w-4 h-4 text-subtle" />
          </button>
        </div>

        <div className="rounded-lg bg-surface-2 divide-y divide-border">
          {/* Текст в уведомлениях. Выключено — сервер шлёт «Новое сообщение»
              вместо текста; сам пуш при этом всё равно зашифрован. */}
          {Capacitor.isNativePlatform() && profile && (
            <label className="flex items-center justify-between gap-3 h-14 px-4">
              <span className="min-w-0">
                <span className="block text-body">Текст в уведомлениях</span>
                <span className="block text-caption text-subtle truncate">Выключи — в пуше будет только «Новое сообщение»</span>
              </span>
              <input
                type="checkbox"
                className="w-5 h-5 accent-primary shrink-0"
                checked={profile.push_preview !== false}
                onChange={async (e) => {
                  const v = e.target.checked;
                  setProfile({ ...profile, push_preview: v });
                  try { await api.updateProfile(profile.id, { push_preview: v }); }
                  catch { toast.error("Не удалось сохранить"); setProfile({ ...profile, push_preview: !v }); }
                }}
              />
            </label>
          )}
          <button
            type="button"
            onClick={logout}
            className="w-full h-12 px-4 flex items-center gap-3 text-body text-primary active:bg-surface-3"
          >
            <LogOut className="w-5 h-5" />
            <span className="flex-1 text-left">Выйти</span>
          </button>
        </div>

        {/* Версия — чтобы сверить с huyax.e-tree.su/apk. Номер сборки один на
            всех платформах (число коммитов); у iOS свой счётчик в TestFlight,
            его показываем рядом, если он отличается. */}
        <div className="mt-auto pt-4 text-center text-caption text-subtle select-text">
          ХУЯКС {APP_VERSION} · сборка {APP_BUILD}
          {nativeBuild && nativeBuild !== APP_BUILD ? ` · ${platformLabel} ${nativeBuild}` : ""}
        </div>
      </div>

      {galleryOpen && (
        <SavedGallery own onClose={() => { setGalleryOpen(false); void loadSaved(); }} />
      )}

      <BottomNav />
    </div>
  );
};

export default ProfilePage;
