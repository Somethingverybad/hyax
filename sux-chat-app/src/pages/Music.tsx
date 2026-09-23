import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ListMusic, Music2, Pause, Play, Plus, Trash2, ChevronLeft, Pencil,
         Shuffle, Repeat, Repeat1, SkipBack, SkipForward, X } from "lucide-react";
import BottomNav from "@/components/BottomNav";
import { SettingsCard, SettingsRow } from "@/components/settings";
import { api, type Playlist, type PlaylistTrack } from "@/api/client";
import { playQueue, usePlayer, currentTrack, fmtTime, next, prev, seek, stop, toggle,
         toggleShuffle, cycleRepeat, type Track } from "@/lib/player";
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


/**
 * Панель плеера на экране музыки: здесь она не всплывающая полоска, а часть
 * экрана — вкладка целиком отведена под музыку. Полоску (MiniPlayer) на этом
 * экране прячем, чтобы плеер не двоился.
 */
const PlayerPanel = () => {
  const s = usePlayer();
  const t = currentTrack();
  if (!t) return null;
  const frac = s.duration ? Math.min(1, s.time / s.duration) : 0;
  const RepeatIcon = s.repeat === "one" ? Repeat1 : Repeat;

  return (
    <div className="shrink-0 px-4 pb-2">
      <div className="ui-card rounded-lg bg-surface-2 border border-border p-3 space-y-2">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1">
            <span className="block text-body truncate">{t.title}</span>
            <span className="block text-caption text-subtle tabular-nums">
              {fmtTime(s.time)}{s.duration ? ` / ${fmtTime(s.duration)}` : ""}
              {s.queue.length > 1 && ` · ${s.index + 1} из ${s.queue.length}`}
            </span>
          </span>
          <button type="button" onClick={stop} className="p-2 text-subtle" aria-label="Закрыть плеер">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div
          className="h-1.5 rounded-full bg-black/20 overflow-hidden cursor-pointer"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            if (s.duration) seek(((e.clientX - r.left) / r.width) * s.duration);
          }}
        >
          <div className="h-full rounded-full bg-primary" style={{ width: `${frac * 100}%` }} />
        </div>

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={toggleShuffle}
            aria-pressed={s.shuffle}
            aria-label="Перемешать"
            className={cn("w-10 h-10 rounded-full flex items-center justify-center",
              s.shuffle ? "text-primary bg-primary/15" : "text-subtle")}
          >
            <Shuffle className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void prev()} className="w-10 h-10 rounded-full flex items-center justify-center text-foreground" aria-label="Предыдущий">
              <SkipBack className="w-5 h-5" />
            </button>
            <button type="button" onClick={() => void toggle()} className="w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center" aria-label={s.playing ? "Пауза" : "Играть"}>
              {s.playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
            </button>
            <button type="button" onClick={() => void next()} className="w-10 h-10 rounded-full flex items-center justify-center text-foreground" aria-label="Следующий">
              <SkipForward className="w-5 h-5" />
            </button>
          </div>
          <button
            type="button"
            onClick={cycleRepeat}
            aria-pressed={s.repeat !== "off"}
            aria-label={s.repeat === "one" ? "Повторять один" : s.repeat === "all" ? "Повторять всё" : "Без повтора"}
            className={cn("w-10 h-10 rounded-full flex items-center justify-center",
              s.repeat !== "off" ? "text-primary bg-primary/15" : "text-subtle")}
          >
            <RepeatIcon className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
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
        <PlayerPanel />
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
      <PlayerPanel />
      <BottomNav />
    </div>
  );
};

export default Music;
