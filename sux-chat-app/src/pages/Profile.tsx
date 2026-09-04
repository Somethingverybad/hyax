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
import { Camera, LogOut, Share2 } from "lucide-react";

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
  const platformLabel = Capacitor.getPlatform() === "ios" ? "iOS" : "Android";

  return (
    <div className="h-screen flex flex-col bg-background">
      <div className="shrink-0 px-4 py-3 pad-safe-top bg-background min-h-14 flex items-center">
        <span className="text-h1">Профиль</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
        {/* Аватар: квадрат, по тапу — замена */}
        <div className="flex justify-center">
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
            className="relative w-[104px] h-[104px] rounded-lg bg-surface-3 overflow-hidden disabled:opacity-60"
            aria-label="Сменить аватар"
          >
            {profile?.avatar_url ? (
              <img
                src={mediaUrl(profile.avatar_url)}
                alt=""
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="w-full h-full flex items-center justify-center text-4xl font-bold text-primary">
                {(profile?.username || "?")[0]?.toUpperCase()}
              </span>
            )}
            <span className="absolute bottom-0 inset-x-0 bg-primary text-primary-foreground text-[10px] font-semibold py-1 flex items-center justify-center gap-1">
              <Camera className="w-3 h-3" />
              {uploading ? "Загрузка…" : "Сменить"}
            </span>
          </button>
        </div>

        <div className="space-y-1.5">
          <label className="text-small text-muted-foreground uppercase tracking-wide">Никнейм</label>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            maxLength={50}
            className="w-full h-11 rounded-md bg-surface-2 border border-border px-3.5 text-body outline-none focus:border-amber"
          />
          <p className="text-caption text-subtle">
            Имя, которое видят собеседники. Логин для входа не меняется.
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-small text-muted-foreground uppercase tracking-wide">Статус</label>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="Например: на связи после 18:00"
            className="w-full rounded-md bg-surface-2 border border-border px-3.5 py-2.5 text-body outline-none resize-none focus:border-amber"
          />
        </div>

        <button
          type="button"
          onClick={save}
          disabled={saving || !dirty || username.trim().length < 2}
          className="w-full h-11 rounded-md bg-primary text-primary-foreground font-semibold disabled:opacity-40"
        >
          {saving ? "Сохраняем…" : "Сохранить"}
        </button>

        <button
          type="button"
          onClick={async () => {
            if (!profile?.username) return;
            const r = await shareProfile(profile.username);
            if (r === "copied") toast.success("Профиль скопирован");
            else if (r === "error") toast.error("Не удалось поделиться");
          }}
          className="w-full h-11 rounded-md flex items-center justify-center gap-2 bg-surface-2 text-foreground font-semibold"
        >
          <Share2 className="w-4 h-4" />
          Поделиться профилем
        </button>

        {/* Текст в уведомлениях. Выключено — сервер шлёт «Новое сообщение»
            вместо текста; сам пуш при этом всё равно зашифрован. */}
        {Capacitor.isNativePlatform() && profile && (
          <label className="flex items-center justify-between gap-3 p-4 rounded-lg bg-surface-1">
            <span>
              <span className="block text-h2">Текст в уведомлениях</span>
              <span className="block text-small text-muted-foreground">Выключи — в пуше будет только «Новое сообщение»</span>
            </span>
            <input
              type="checkbox"
              className="w-5 h-5 accent-primary"
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
          className="w-full h-11 rounded-md flex items-center justify-center gap-2 bg-surface-1 text-primary font-semibold"
        >
          <LogOut className="w-4 h-4" />
          Выйти
        </button>

        {/* Версия — чтобы сверить с huyax.e-tree.su/apk. Номер сборки один на
            всех платформах (число коммитов); у iOS свой счётчик в TestFlight,
            его показываем рядом, если он отличается. */}
        <div className="text-center text-caption text-subtle pb-2 select-text">
          ХУЯКС {APP_VERSION} · сборка {APP_BUILD}
          {nativeBuild && nativeBuild !== APP_BUILD ? ` · ${platformLabel} ${nativeBuild}` : ""}
        </div>
      </div>

      <BottomNav />
    </div>
  );
};

export default ProfilePage;
