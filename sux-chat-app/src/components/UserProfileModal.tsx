import { useEffect, useState } from "react";
import { X, Phone, Share2, Copy, ChevronRight } from "lucide-react";
import SavedGallery, { SavedTile } from "@/components/SavedGallery";
import type { SavedImage } from "@/api/client";
import Identicon from "@/components/Identicon";
import { api } from "@/api/client";
import { shareProfile } from "@/lib/share";
import { toast } from "sonner";

interface UserProfile {
  id: string;
  username: string;
  avatar_url?: string | null;
  bio?: string | null;
  created_at?: string | null;
}

/**
 * Просмотр чужого профиля — только чтение: аватар, имя, статус (bio).
 * Открывается тапом по имени собеседника в шапке чата.
 */
const UserProfileModal = ({
  userId,
  onClose,
  onCall,
}: {
  userId: string;
  onClose: () => void;
  onCall?: () => void;
}) => {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState<{ count: number; items: SavedImage[] } | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    api.listSavedImages(userId, 5).then((d) => alive && setSaved(d)).catch(() => alive && setSaved({ count: 0, items: [] }));
    return () => { alive = false; };
  }, [userId]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .getProfileById(userId)
      .then((p) => alive && setProfile(p))
      .catch(() => alive && setProfile(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [userId]);

  const copy = async (value: string) => {
    try { await navigator.clipboard.writeText(value); toast.success("Скопировано"); }
    catch { toast.error("Не удалось скопировать"); }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 md:bg-black/30 flex items-end md:items-start md:justify-end md:p-4"
      onClick={onClose}
    >
      {/* Телефон — шторка снизу; десктоп — боковая панель во всю высоту, как
          колонка профиля в референсе. Поверхности: панель surface-2, карточки и
          вторичные кнопки surface-4, чтобы читались на панели. */}
      <div
        className="w-full md:w-[400px] md:max-h-full md:overflow-y-auto bg-surface-2 md:bg-surface-1 rounded-t-[16px] md:rounded-lg md:border md:border-border p-6 md:p-5 pb-[calc(var(--sab)+24px)] md:pb-5 relative"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="md:hidden absolute top-2 left-1/2 -translate-x-1/2 w-9 h-1 rounded-full bg-foreground/20" aria-hidden />
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 text-subtle hover:text-foreground"
          aria-label="Закрыть"
        >
          <X className="w-4 h-4" />
        </button>

        {loading ? (
          <div className="py-10 text-center text-small text-subtle">Загрузка…</div>
        ) : profile ? (
          <div className="space-y-6">
            <div className="flex items-center gap-5 pr-8">
              <Identicon id={profile.id} avatarUrl={profile.avatar_url} className="w-[104px] h-[104px] rounded-lg shrink-0" />
              <div className="min-w-0">
                <h2 className="text-[24px] leading-tight font-semibold text-foreground truncate">{profile.username}</h2>
                <p className="mt-2 text-body text-subtle truncate">{profile.bio ? profile.bio.split("\n")[0] : "Статус не указан"}</p>
              </div>
            </div>

            <div className="flex gap-3">
              {onCall && (
                <button
                  type="button"
                  onClick={() => { onCall(); onClose(); }}
                  className="flex-1 h-10 md:h-9 rounded-md bg-primary text-primary-foreground font-medium md:text-small flex items-center justify-center gap-2 active:opacity-90 hover:brightness-110"
                >
                  <Phone className="w-4 h-4" />
                  Позвонить
                </button>
              )}
              <button
                type="button"
                onClick={async () => {
                  const r = await shareProfile(profile.username);
                  if (r === "copied") toast.success("Профиль скопирован");
                  else if (r === "error") toast.error("Не удалось поделиться");
                }}
                className="flex-1 h-10 md:h-9 rounded-md bg-surface-4 text-foreground font-medium md:text-small flex items-center justify-center gap-2 active:opacity-90 hover:brightness-110"
              >
                <Share2 className="w-4 h-4" />
                Поделиться
              </button>
            </div>

            <div className="border-t border-border" />

            {profile.bio && (
              <div className="rounded-lg bg-surface-4 p-4">
                <p className="text-h2 mb-2">О себе</p>
                <p className="text-body text-muted-foreground whitespace-pre-wrap break-words">{profile.bio}</p>
              </div>
            )}

            {saved && saved.count > 0 && (
              <div className="rounded-lg bg-surface-4 p-4">
                <button type="button" onClick={() => setGalleryOpen(true)} className="w-full flex items-center gap-2 text-left">
                  <span className="text-h2 flex-1">Сохранёнки</span>
                  <span className="text-small text-subtle">{saved.count}</span>
                  <ChevronRight className="w-4 h-4 text-subtle" />
                </button>
                <div className="mt-3 flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {saved.items.map((it) => <SavedTile key={it.id} item={it} className="w-20 h-[98px] shrink-0" onClick={() => setGalleryOpen(true)} />)}
                </div>
              </div>
            )}

            <div className="rounded-lg bg-surface-4 p-4">
              <p className="text-h2 mb-2">Информация</p>
              {[
                ["Имя пользователя", "@" + profile.username],
                ["ID пользователя", profile.id],
                ...(profile.created_at ? [["Дата регистрации", new Date(profile.created_at).toLocaleDateString("ru-RU")]] : []),
              ].map(([label, value]) => (
                <div key={label} className="flex items-center gap-3 h-9 md:h-8">
                  <span className="text-small text-subtle w-32 shrink-0">{label}</span>
                  <span className="text-small text-muted-foreground flex-1 min-w-0 truncate">{value}</span>
                  <button type="button" onClick={() => copy(value)} className="p-1.5 text-subtle active:text-foreground" aria-label={`Скопировать: ${label}`}>
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="py-10 text-center text-small text-subtle">
            Не удалось загрузить профиль
          </div>
        )}
      </div>
      {galleryOpen && profile && (
        <SavedGallery profileId={profile.id} own={false} title={`Сохранёнки ${profile.username}`} onClose={() => setGalleryOpen(false)} />
      )}
    </div>
  );
};

export default UserProfileModal;
