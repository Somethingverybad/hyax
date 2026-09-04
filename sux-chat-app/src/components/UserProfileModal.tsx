import { useEffect, useState } from "react";
import { X, Phone, Share2, Copy } from "lucide-react";
import Identicon from "@/components/Identicon";
import { api } from "@/api/client";
import { shareProfile } from "@/lib/share";
import { toast } from "sonner";

interface UserProfile {
  id: string;
  username: string;
  avatar_url?: string | null;
  bio?: string | null;
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

  const copyName = async () => {
    try { await navigator.clipboard.writeText("@" + (profile?.username || "")); toast.success("Скопировано"); }
    catch { toast.error("Не удалось скопировать"); }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-end md:items-center justify-center md:p-4"
      onClick={onClose}
    >
      {/* По референсу: аватар 104, имя, ряд кнопок, карточки «О себе» и
          «Информация». На телефоне — шторка снизу, на десктопе — по центру. */}
      <div
        className="w-full md:max-w-md bg-surface-1 rounded-t-lg md:rounded-lg p-5 pb-[calc(var(--sab)+20px)] md:pb-5 relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 p-2 text-muted-foreground hover:text-foreground"
          aria-label="Закрыть"
        >
          <X className="w-5 h-5" />
        </button>

        {loading ? (
          <div className="py-10 text-center text-small text-muted-foreground">Загрузка…</div>
        ) : profile ? (
          <div className="space-y-4">
            <div className="flex items-center gap-4 pr-8">
              <Identicon id={profile.id} avatarUrl={profile.avatar_url} className="w-[104px] h-[104px] rounded-lg" />
              <div className="min-w-0">
                <h2 className="text-[26px] leading-tight font-bold text-foreground break-words">{profile.username}</h2>
                {!profile.bio && <p className="mt-1 text-small text-muted-foreground">Статус не указан</p>}
              </div>
            </div>

            <div className="flex gap-3">
              {onCall && (
                <button
                  type="button"
                  onClick={() => { onCall(); onClose(); }}
                  className="flex-1 h-11 rounded-md bg-primary text-primary-foreground font-semibold flex items-center justify-center gap-2 active:opacity-90"
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
                className="flex-1 h-11 rounded-md bg-surface-3 text-foreground font-semibold flex items-center justify-center gap-2 active:opacity-90"
              >
                <Share2 className="w-4 h-4" />
                Поделиться
              </button>
            </div>

            {profile.bio && (
              <div className="rounded-lg bg-surface-3 p-4">
                <p className="text-h2 mb-1">О себе</p>
                <p className="text-body text-muted-foreground whitespace-pre-wrap break-words">{profile.bio}</p>
              </div>
            )}

            <div className="rounded-lg bg-surface-3 p-4">
              <p className="text-h2 mb-2">Информация</p>
              <div className="flex items-center gap-3">
                <span className="text-small text-muted-foreground w-24 shrink-0">Никнейм</span>
                <span className="text-body flex-1 min-w-0 truncate">@{profile.username}</span>
                <button type="button" onClick={copyName} className="p-1.5 text-muted-foreground active:text-foreground" aria-label="Скопировать никнейм">
                  <Copy className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="py-10 text-center text-small text-muted-foreground">
            Не удалось загрузить профиль
          </div>
        )}
      </div>
    </div>
  );
};

export default UserProfileModal;
