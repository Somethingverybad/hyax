import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { X, User, Calendar } from "lucide-react";
import { api } from "@/api/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Profile {
  id: string;
  username: string;
  avatar_url?: string;
  bio?: string;
  status: string;
  created_at: string;
}

interface ProfileViewProps {
  profileId: string;
  onClose: () => void;
  isOwnProfile?: boolean;
  onEditClick?: () => void;
}

const ProfileView = ({ profileId, onClose, isOwnProfile = false, onEditClick }: ProfileViewProps) => {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadProfile();
  }, [profileId]);

  const loadProfile = async () => {
    try {
      setLoading(true);
      console.log('📥 Загрузка профиля:', profileId);
      const data = await api.getProfileById(profileId);
      console.log('✅ Профиль загружен:', data);
      setProfile(data);
    } catch (error: any) {
      console.error("❌ Error loading profile:", error);
      toast.error("Не удалось загрузить профиль");
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("ru-RU", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-card border-2 border-border rounded-2xl shadow-2xl max-w-md w-[calc(100%-2rem)] max-w-[min(28rem,calc(100vw-2rem))] max-h-[90vh] overflow-y-auto">
        {/* Заголовок */}
        <div className="sticky top-0 bg-card border-b border-border p-4 flex items-center justify-between">
          <h2 className="text-xl font-bold">Профиль</h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8 rounded-full"
          >
            <X className="w-5 h-5" />
          </Button>
        </div>

        {loading ? (
          <div className="p-8 flex items-center justify-center">
            <div className="animate-spin rounded-full h-12 w-12 border-4 border-primary border-t-transparent"></div>
          </div>
        ) : profile ? (
          <div className="p-6 space-y-6">
            {/* Аватар */}
            <div className="flex flex-col items-center gap-4">
              <div className="relative">
                {profile.avatar_url ? (
                  <img
                    src={profile.avatar_url}
                    alt={profile.username}
                    className="w-32 h-32 rounded-full object-cover border-4 border-primary shadow-lg"
                  />
                ) : (
                  <div className="w-32 h-32 rounded-full bg-gradient-primary flex items-center justify-center border-4 border-primary shadow-lg">
                    <User className="w-16 h-16 text-white" />
                  </div>
                )}
                
                {/* Индикатор статуса */}
                <div
                  className={cn(
                    "absolute bottom-2 right-2 w-6 h-6 rounded-full border-4 border-card",
                    profile.status === "online" ? "bg-green-500" : "bg-gray-400"
                  )}
                  title={profile.status === "online" ? "В сети" : "Не в сети"}
                />
              </div>

              {/* Имя пользователя */}
              <div className="text-center">
                <h3 className="text-2xl font-bold">{profile.username}</h3>
                <p className="text-sm text-muted-foreground">
                  {profile.status === "online" ? "В сети" : "Не в сети"}
                </p>
              </div>
            </div>

            {/* Статус/Bio */}
            {profile.bio && (
              <div className="bg-muted/50 rounded-xl p-4">
                <h4 className="text-sm font-semibold text-muted-foreground mb-2">О себе</h4>
                <p className="text-base whitespace-pre-wrap break-words">{profile.bio}</p>
              </div>
            )}

            {/* Дата регистрации */}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar className="w-4 h-4" />
              <span>В чате с {formatDate(profile.created_at)}</span>
            </div>

            {/* Кнопка редактирования для своего профиля */}
            {isOwnProfile && onEditClick && (
              <Button
                onClick={onEditClick}
                className="w-full bg-gradient-primary shadow-glow hover:shadow-glow-lg transition-all"
              >
                Редактировать профиль
              </Button>
            )}
          </div>
        ) : (
          <div className="p-8 text-center text-muted-foreground">
            Профиль не найден
          </div>
        )}
      </div>
    </div>
  );
};

export default ProfileView;
