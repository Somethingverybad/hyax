import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ListMusic, Music2, Plus } from "lucide-react";
import { api, type Playlist } from "@/api/client";

/**
 * Куда добавить музыку из сообщения: шторка со списком плейлистов и полем
 * «новый». «Моя музыка» заводится сама, поэтому список пустым не бывает.
 */
const PlaylistPicker = ({ message, onClose }: {
  message: { id: string; file_name?: string | null } | null;
  onClose: () => void;
}) => {
  const [lists, setLists] = useState<Playlist[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!message) return;
    setLists(null);
    api.listPlaylists().then(setLists).catch(() => setLists([]));
  }, [message?.id]);

  if (!message) return null;

  const add = async (playlistId?: string, playlistName?: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await api.addTrackFromMessage(message.id, playlistId);
      toast.success(r.already ? "Уже в плейлисте" : `Добавлено в «${playlistName || r.playlist.name}»`);
      onClose();
    } catch (e: any) {
      toast.error(e?.message || "Не удалось добавить");
    } finally { setBusy(false); }
  };

  const createAndAdd = async () => {
    const value = name.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      const pl = await api.createPlaylist(value);
      setName("");
      setBusy(false);
      await add(pl.id, pl.name);
    } catch (e: any) {
      setBusy(false);
      toast.error(e?.message || "Не получилось");
    }
  };

  return (
    <div className="fixed inset-0 z-[75] flex items-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="ui-card relative w-full rounded-t-[16px] bg-surface-2 p-4 pb-[calc(var(--sab)+20px)] space-y-3 max-h-[70vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto h-1 w-9 rounded-full bg-foreground/20" aria-hidden />
        <p className="text-h2">В плейлист</p>
        <p className="text-caption text-subtle truncate">{message.file_name || "Аудиофайл"}</p>

        {lists === null ? (
          <p className="text-small text-subtle">Загрузка…</p>
        ) : (
          <div className="space-y-1">
            {lists.map((pl) => (
              <button
                key={pl.id}
                type="button"
                disabled={busy}
                onClick={() => void add(pl.id, pl.name)}
                className="w-full min-h-12 px-3 rounded-md flex items-center gap-3 text-left bg-surface-4 active:opacity-70 disabled:opacity-50"
              >
                {pl.is_default ? <Music2 className="w-5 h-5 text-primary shrink-0" /> : <ListMusic className="w-5 h-5 text-primary shrink-0" />}
                <span className="flex-1 text-body truncate">{pl.name}</span>
                <span className="text-small text-subtle">{pl.tracks_count ?? 0}</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void createAndAdd(); }}
            placeholder="Новый плейлист"
            className="flex-1 h-10 px-3 rounded-md bg-surface-4 outline-none text-body min-w-0"
          />
          <button
            type="button"
            onClick={() => void createAndAdd()}
            disabled={!name.trim() || busy}
            className="h-10 px-3 rounded-md bg-primary text-primary-foreground flex items-center gap-1 text-small font-medium disabled:opacity-50"
          >
            <Plus className="w-4 h-4" /> Создать
          </button>
        </div>
      </div>
    </div>
  );
};

export default PlaylistPicker;
