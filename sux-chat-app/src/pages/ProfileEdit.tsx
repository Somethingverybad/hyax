import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/api/client";
import { readCache, writeCache } from "@/lib/session-cache";
import ScreenHeader from "@/components/ScreenHeader";
import { toast } from "sonner";
import type { Profile } from "./Profile";

const BIO_LIMIT = 500;

/**
 * Правка профиля: никнейм и «о себе». Картинки (аватар, обложка) меняются на
 * самом экране профиля — там они и показаны, незачем держать загрузку в двух
 * местах.
 *
 * Никнейм — отображаемое имя в чатах (Profile.username). Логин для входа
 * лежит отдельно, в User.username, и отсюда не меняется.
 */
const ProfileEdit = () => {
  const navigate = useNavigate();
  const cached = readCache<Profile>("user");
  const [profile, setProfile] = useState<Profile | null>(cached);
  const [username, setUsername] = useState(cached?.username || "");
  const [bio, setBio] = useState(cached?.bio || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const p = await api.getCurrentUser();
        setProfile(p);
        // Поля не перетираем, если пользователь уже начал печатать: ответ сети
        // может прийти позже первого нажатия.
        setUsername((v) => (v ? v : p.username || ""));
        setBio((v) => (v ? v : p.bio || ""));
        writeCache("user", p);
      } catch {
        navigate("/auth", { replace: true });
      }
    })();
  }, [navigate]);

  const dirty =
    profile !== null &&
    (username.trim() !== (profile.username || "") || bio.trim() !== (profile.bio || ""));
  const valid = username.trim().length >= 2;

  const save = async () => {
    if (!profile || !dirty || !valid) return;
    setSaving(true);
    try {
      const updated = await api.updateProfile(profile.id, {
        username: username.trim(),
        bio: bio.trim(),
      });
      writeCache("user", updated);
      toast.success("Сохранено");
      navigate(-1);
    } catch (e: any) {
      toast.error(e?.message || "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      <ScreenHeader
        title="Редактировать"
        left={
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="px-2 h-10 text-body text-primary active:opacity-60"
          >
            Отмена
          </button>
        }
        right={
          <button
            type="button"
            onClick={save}
            disabled={saving || !dirty || !valid}
            className="px-2 h-10 text-body font-medium text-primary active:opacity-60 disabled:opacity-40"
          >
            {saving ? "Сохраняем…" : "Сохранить"}
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        <div className="rounded-lg bg-surface-2 border border-border p-4 space-y-1.5">
          <label className="text-small text-subtle" htmlFor="edit-username">Никнейм</label>
          <input
            id="edit-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            maxLength={50}
            className="w-full h-10 rounded-md bg-surface-4 border border-transparent px-3 text-body outline-none focus:border-amber"
          />
          <p className="text-caption text-subtle">
            Имя, которое видят собеседники. Логин для входа не меняется.
          </p>
          {!valid && (
            <p className="text-caption text-destructive">Никнейм короче 2 символов</p>
          )}
        </div>

        <div className="rounded-lg bg-surface-2 border border-border p-4 space-y-1.5">
          <label className="text-small text-subtle" htmlFor="edit-bio">О себе</label>
          <textarea
            id="edit-bio"
            value={bio}
            onChange={(e) => setBio(e.target.value.slice(0, BIO_LIMIT))}
            rows={3}
            placeholder="Например: на связи после 18:00"
            className="w-full rounded-md bg-surface-4 border border-transparent px-3 py-2 text-body outline-none resize-none focus:border-amber"
          />
          <p className="text-caption text-subtle text-right tabular-nums">
            {bio.length}/{BIO_LIMIT}
          </p>
        </div>

        <p className="px-1 text-caption text-subtle">
          Аватар и обложка меняются на экране профиля — по кнопке с камерой.
        </p>
      </div>
    </div>
  );
};

export default ProfileEdit;
