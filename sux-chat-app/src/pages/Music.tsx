import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ListMusic, Music2, Pause, Play, Plus, Trash2, ChevronLeft, Pencil } from "lucide-react";
import BottomNav from "@/components/BottomNav";
import { SettingsCard, SettingsRow } from "@/components/settings";
import { api, type Playlist, type PlaylistTrack } from "@/api/client";
import { playQueue, usePlayer, currentTrack, fmtTime, type Track } from "@/lib/player";
import { cn } from "@/lib/utils";

/**
 * Музыка: плейлисты из того, что присылали в переписке.
 *
 * Играет общий плеер приложения (@/lib/player) — та же очередь, что у
 * аудиофайлов в чате, поэтому музыка не обрывается при переходе на другой
 * экран, а мини-плеер и экран блокировки работают сами собой.
 */
const trackToQueue = (t: PlaylistTrack): Track => ({
  id: t.id, raw: t.file_url, title: t.title, artist: t.artist || undefined,
});

const pluralTracks = (n: number) => {
  const d = n % 10, dd = n % 100;
  if (d === 1 && dd !== 11) return `${n} трек`;
  if (d >= 2 && d <= 4 && (dd < 10 || dd >= 20)) return `${n} трека`;
  return `${n} треков`;
};

const Music = () => {
  const [lists, setLists] = useState<Playlist[] | null>(null);
  const [open, setOpen] = useState<Playlist | null>(null);
  const [tracks, setTracks] = useState<PlaylistTrack[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const player = usePlayer();
  const playing = currentTrack();

  const load = () => api.listPlaylists().then(setLists).catch(() => setLists([]));
  useEffect(() => { load(); }, []);

  const openList = async (pl: Playlist) => {
    setOpen(pl); setTracks(null);
    try {
      const r = await api.getPlaylist(pl.id);
      setOpen(r.playlist); setTracks(r.tracks);
    } catch { toast.error("Не удалось открыть плейлист"); setOpen(null); }
  };

  const create = async () => {
    const value = name.trim();
    if (!value) return;
    try {
      const pl = await api.createPlaylist(value);
      setName(""); setCreating(false);
      setLists((l) => [...(l || []), pl]);
      void openList(pl);
    } catch (e: any) { toast.error(e?.message || "Не получилось"); }
  };

  const rename = async (pl: Playlist) => {
    const value = prompt("Название плейлиста", pl.name)?.trim();
    if (!value || value === pl.name) return;
    try {
      const next = await api.renamePlaylist(pl.id, value);
      setOpen(next); load();
    } catch (e: any) { toast.error(e?.message || "Не получилось"); }
  };

  const remove = async (pl: Playlist) => {
    if (!confirm(`Удалить плейлист «${pl.name}»? Сама музыка в переписке останется.`)) return;
    try {
      await api.deletePlaylist(pl.id);
      setOpen(null); load();
    } catch (e: any) { toast.error(e?.message || "Не получилось"); }
  };

  const removeTrack = async (t: PlaylistTrack) => {
    if (!open) return;
    const before = tracks || [];
    setTracks(before.filter((x) => x.id !== t.id));
    try { await api.removeTrack(open.id, t.id); load(); }
    catch { toast.error("Не удалось убрать трек"); setTracks(before); }
  };

  // ── Плейлист целиком
  if (open) {
    return (
      <div className="h-screen flex flex-col bg-background">
        <div className="shrink-0 px-2 py-3 pad-safe-top bg-background border-b border-border min-h-14 flex items-center gap-2">
          <button type="button" onClick={() => { setOpen(null); load(); }} className="ui-icon-btn p-2" aria-label="Назад">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="text-h2 flex-1 truncate">{open.name}</span>
          <button type="button" onClick={() => rename(open)} className="ui-icon-btn p-2 text-muted-foreground" aria-label="Переименовать">
            <Pencil className="w-4 h-4" />
          </button>
          {!open.is_default && (
            <button type="button" onClick={() => remove(open)} className="ui-icon-btn p-2 text-destructive" aria-label="Удалить плейлист">
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {tracks === null ? (
            <p className="text-small text-subtle">Загрузка…</p>
          ) : tracks.length === 0 ? (
            <div className="ui-card rounded-lg bg-surface-2 border border-border p-4 text-small text-subtle">
              Пусто. Музыка добавляется из переписки: удерживайте аудиофайл в чате и выберите «В плейлист».
            </div>
          ) : (
            <SettingsCard>
              {tracks.map((t, i) => {
                const isNow = playing?.id === t.id;
                return (
                  <SettingsRow
                    key={t.id}
                    leading={
                      <span className={cn("w-9 h-9 rounded-md flex items-center justify-center shrink-0",
                        isNow ? "bg-primary text-primary-foreground" : "bg-surface-4 text-muted-foreground")}>
                        {isNow && player.playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                      </span>
                    }
                    label={t.title}
                    hint={t.artist || (t.source ? undefined : "Сообщение удалено, музыка осталась")}
                    value={isNow && player.duration ? fmtTime(player.time) : undefined}
                    onClick={() => void playQueue(tracks.map(trackToQueue), i)}
                    trailing={
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); void removeTrack(t); }}
                        className="p-2 text-subtle active:text-destructive"
                        aria-label="Убрать из плейлиста"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    }
                  />
                );
              })}
            </SettingsCard>
          )}
        </div>
        <BottomNav />
      </div>
    );
  }

  // ── Список плейлистов
  return (
    <div className="h-screen flex flex-col bg-background">
      <div className="shrink-0 px-4 py-3 pad-safe-top bg-background border-b border-border min-h-14 flex items-center gap-2">
        <span className="text-h1 flex-1">Музыка</span>
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center"
          aria-label="Новый плейлист"
        >
          <Plus className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {creating && (
          <div className="ui-card rounded-lg bg-surface-2 border border-border p-3 flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void create(); }}
              placeholder="Название плейлиста"
              autoFocus
              className="flex-1 h-10 px-3 rounded-md bg-surface-4 outline-none text-body min-w-0"
            />
            <button type="button" onClick={() => void create()} className="h-10 px-4 rounded-md bg-primary text-primary-foreground text-small font-medium">
              Создать
            </button>
          </div>
        )}

        {lists === null ? (
          <p className="text-small text-subtle">Загрузка…</p>
        ) : (
          <SettingsCard>
            {lists.map((pl) => (
              <SettingsRow
                key={pl.id}
                icon={pl.is_default ? Music2 : ListMusic}
                label={pl.name}
                value={pluralTracks(pl.tracks_count || 0)}
                onClick={() => void openList(pl)}
              />
            ))}
          </SettingsCard>
        )}

        <p className="px-1 text-caption text-subtle">
          Музыка берётся из переписки: удерживайте аудиофайл в чате и выберите «В плейлист».
        </p>
      </div>
      <BottomNav />
    </div>
  );
};

export default Music;
