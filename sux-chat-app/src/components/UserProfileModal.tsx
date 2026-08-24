import { useEffect, useState } from "react";
import { X, Phone } from "lucide-react";
import Identicon from "@/components/Identicon";
import { api } from "@/api/client";

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

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-card border border-border rounded-2xl p-6 relative"
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
          <div className="py-10 text-center text-sm text-muted-foreground">Загрузка…</div>
        ) : profile ? (
          <div className="flex flex-col items-center text-center">
            <Identicon
              id={profile.id}
              avatarUrl={profile.avatar_url}
              className="w-24 h-24 rounded-2xl mb-4"
            />
            <h2 className="text-xl font-bold text-foreground break-words">
              {profile.username}
            </h2>
            {profile.bio ? (
              <p className="mt-2 text-sm text-muted-foreground whitespace-pre-wrap break-words">
                {profile.bio}
              </p>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground/60">Статус не указан</p>
            )}

            {onCall && (
              <button
                type="button"
                onClick={() => {
                  onCall();
                  onClose();
                }}
                className="mt-6 w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground rounded-xl py-3 font-medium active:opacity-90"
              >
                <Phone className="w-4 h-4" />
                Позвонить
              </button>
            )}
          </div>
        ) : (
          <div className="py-10 text-center text-sm text-muted-foreground">
            Не удалось загрузить профиль
          </div>
        )}
      </div>
    </div>
  );
};

export default UserProfileModal;
