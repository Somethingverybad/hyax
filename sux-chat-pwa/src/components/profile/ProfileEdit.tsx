import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { X, User, Upload, Loader2 } from "lucide-react";
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

interface ProfileEditProps {
  onClose: () => void;
  onSaved: () => void;
}

const ProfileEdit = ({ onClose, onSaved }: ProfileEditProps) => {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [bio, setBio] = useState("");
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    try {
      setLoading(true);
      const data = await api.getMyProfile();
      setProfile(data);
      setBio(data.bio || "");
      setAvatarPreview(data.avatar_url || null);
    } catch (error: any) {
      console.error("Error loading profile:", error);
      toast.error("Не удалось загрузить профиль");
    } finally {
      setLoading(false);
    }
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Проверяем размер файла (макс. 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Файл слишком большой (макс. 5MB)");
      return;
    }

    // Проверяем тип файла
    if (!file.type.startsWith("image/")) {
      toast.error("Можно загружать только изображения");
      return;
    }

    setAvatarFile(file);
    
    // Создаем превью
    const reader = new FileReader();
    reader.onload = (e) => {
      setAvatarPreview(e.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    try {
      setSaving(true);

      // Загружаем аватар если выбран новый
      if (avatarFile) {
        await api.uploadAvatar(avatarFile);
        toast.success("Аватар обновлен");
      }

      // Обновляем bio
      if (bio !== profile?.bio) {
        await api.updateMyProfile(bio);
        toast.success("Профиль обновлен");
      }

      onSaved();
      onClose();
    } catch (error: any) {
      console.error("Error saving profile:", error);
      toast.error("Ошибка сохранения профиля: " + (error.message || "Неизвестная ошибка"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-card border-2 border-border rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        {/* Заголовок */}
        <div className="sticky top-0 bg-card border-b border-border p-4 flex items-center justify-between">
          <h2 className="text-xl font-bold">Редактировать профиль</h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8 rounded-full"
            disabled={saving}
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
              <div className="relative group">
                {avatarPreview ? (
                  <img
                    src={avatarPreview}
                    alt={profile.username}
                    className="w-32 h-32 rounded-full object-cover border-4 border-primary shadow-lg"
                  />
                ) : (
                  <div className="w-32 h-32 rounded-full bg-gradient-primary flex items-center justify-center border-4 border-primary shadow-lg">
                    <User className="w-16 h-16 text-white" />
                  </div>
                )}
                
                {/* Кнопка загрузки аватара */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className={cn(
                    "absolute inset-0 rounded-full bg-black/50 flex items-center justify-center",
                    "opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                  )}
                  disabled={saving}
                >
                  <Upload className="w-8 h-8 text-white" />
                </button>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleAvatarChange}
                className="hidden"
              />

              <p className="text-sm text-muted-foreground text-center">
                Нажмите на аватар, чтобы изменить<br />
                (макс. 5MB, PNG, JPG, GIF, WebP)
              </p>
            </div>

            {/* Имя пользователя (только для чтения) */}
            <div>
              <label className="text-sm font-semibold text-muted-foreground mb-2 block">
                Имя пользователя
              </label>
              <div className="bg-muted/50 rounded-xl p-3 text-base">
                {profile.username}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Имя пользователя нельзя изменить
              </p>
            </div>

            {/* Статус/Bio */}
            <div>
              <label className="text-sm font-semibold text-muted-foreground mb-2 block">
                О себе
              </label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Расскажите о себе..."
                maxLength={500}
                rows={4}
                className={cn(
                  "w-full bg-muted/50 rounded-xl p-3 text-base resize-none",
                  "border-2 border-transparent focus:border-primary focus:outline-none",
                  "transition-colors"
                )}
                disabled={saving}
              />
              <p className="text-xs text-muted-foreground mt-1 text-right">
                {bio.length} / 500
              </p>
            </div>

            {/* Кнопки */}
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={onClose}
                className="flex-1"
                disabled={saving}
              >
                Отмена
              </Button>
              <Button
                onClick={handleSave}
                className="flex-1 bg-gradient-primary shadow-glow hover:shadow-glow-lg transition-all"
                disabled={saving}
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Сохранение...
                  </>
                ) : (
                  "Сохранить"
                )}
              </Button>
            </div>
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

export default ProfileEdit;
