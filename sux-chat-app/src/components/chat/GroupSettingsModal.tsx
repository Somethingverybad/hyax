import { useEffect, useRef, useState } from "react";
import { X, Camera, UserPlus, Users, Check } from "lucide-react";
import Identicon from "@/components/Identicon";
import { api, mediaUrl } from "@/api/client";
import { toast } from "sonner";

interface Person { id: string; username: string; avatar_url?: string | null }

/**
 * Настройки группы. Админ (создатель) меняет название, аватар и добавляет
 * участников; остальные видят состав только на просмотр.
 */
const GroupSettingsModal = ({
  chatId,
  isAdmin,
  initialName,
  initialAvatar,
  onClose,
  onUpdated,
}: {
  chatId: string;
  isAdmin: boolean;
  initialName: string;
  initialAvatar?: string | null;
  onClose: () => void;
  onUpdated: (patch: { name?: string; avatar_url?: string | null }) => void;
}) => {
  const [name, setName] = useState(initialName);
  const [avatar, setAvatar] = useState<string | null>(initialAvatar ?? null);
  const [members, setMembers] = useState<Person[]>([]);
  const [saving, setSaving] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Person[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.getChatParticipants(chatId).then(setMembers).catch(() => {});
  }, [chatId]);

  const pickAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSaving(true);
    try {
      const up = await api.uploadFile(file);
      const updated = await api.configureGroup(chatId, { avatarUrl: up.file_url });
      setAvatar(updated.avatar_url ?? null);
      onUpdated({ avatar_url: updated.avatar_url ?? null });
      toast.success("Аватар обновлён");
    } catch (err: any) {
      toast.error(err?.message || "Не удалось загрузить аватар");
    } finally {
      setSaving(false);
    }
  };

  const saveName = async () => {
    const n = name.trim();
    if (!n || n === initialName) return;
    setSaving(true);
    try {
      const updated = await api.configureGroup(chatId, { name: n });
      onUpdated({ name: updated.name });
      toast.success("Название сохранено");
    } catch (err: any) {
      toast.error(err?.message || "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  };

  const search = async (q: string) => {
    setQuery(q);
    if (!q.trim()) { setResults([]); return; }
    try {
      const found = await api.searchUsers(q);
      const have = new Set(members.map((m) => m.id));
      setResults((Array.isArray(found) ? found : []).filter((p: Person) => !have.has(p.id)));
    } catch { setResults([]); }
  };

  const addMember = async (p: Person) => {
    try {
      await api.addChatParticipants(chatId, [p.id]);
      setMembers((prev) => [...prev, p]);
      setResults((prev) => prev.filter((r) => r.id !== p.id));
      toast.success(`${p.username} добавлен`);
    } catch (err: any) {
      toast.error(err?.message || "Не удалось добавить");
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm max-h-[85vh] overflow-y-auto bg-card border border-border rounded-2xl p-5 relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" onClick={onClose} className="absolute top-3 right-3 p-2 text-muted-foreground hover:text-foreground" aria-label="Закрыть">
          <X className="w-5 h-5" />
        </button>

        {/* Аватар */}
        <div className="flex flex-col items-center">
          <button
            type="button"
            onClick={() => isAdmin && fileRef.current?.click()}
            disabled={!isAdmin || saving}
            className="relative w-24 h-24 rounded-2xl overflow-hidden bg-secondary flex items-center justify-center"
          >
            {avatar ? (
              <img src={mediaUrl(avatar)} alt="" className="w-full h-full object-cover" />
            ) : (
              <Users className="w-10 h-10 text-primary" />
            )}
            {isAdmin && (
              <span className="absolute bottom-1 right-1 bg-primary text-primary-foreground p-1 rounded-full">
                <Camera className="w-3 h-3" />
              </span>
            )}
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={pickAvatar} />
        </div>

        {/* Название */}
        <div className="mt-4">
          {isAdmin ? (
            <div className="flex items-center gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={saveName}
                onKeyDown={(e) => e.key === "Enter" && saveName()}
                className="flex-1 bg-secondary border-2 border-border rounded-lg px-3 py-2 text-center font-semibold"
                placeholder="Название группы"
              />
              {name.trim() && name !== initialName && (
                <button type="button" onClick={saveName} className="p-2 text-primary" aria-label="Сохранить">
                  <Check className="w-5 h-5" />
                </button>
              )}
            </div>
          ) : (
            <h2 className="text-center text-xl font-bold">{name || "Группа"}</h2>
          )}
        </div>

        {/* Участники */}
        <div className="mt-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
              Участники · {members.length}
            </span>
            {isAdmin && (
              <button type="button" onClick={() => setAddOpen((v) => !v)} className="flex items-center gap-1 text-sm text-primary">
                <UserPlus className="w-4 h-4" /> Добавить
              </button>
            )}
          </div>

          {addOpen && isAdmin && (
            <div className="mb-3">
              <input
                value={query}
                onChange={(e) => search(e.target.value)}
                placeholder="Поиск по нику…"
                className="w-full bg-secondary border-2 border-border rounded-lg px-3 py-2 text-sm"
              />
              {results.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => addMember(p)}
                  className="w-full flex items-center gap-2 px-2 py-2 rounded-lg active:bg-secondary text-left"
                >
                  <Identicon id={p.id} avatarUrl={p.avatar_url} className="w-8 h-8" />
                  <span className="text-sm">{p.username}</span>
                  <UserPlus className="w-4 h-4 ml-auto text-primary" />
                </button>
              ))}
            </div>
          )}

          <div className="space-y-1">
            {members.map((m) => (
              <div key={m.id} className="flex items-center gap-2 px-2 py-1.5">
                <Identicon id={m.id} avatarUrl={m.avatar_url} className="w-8 h-8" />
                <span className="text-sm truncate">{m.username}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default GroupSettingsModal;
