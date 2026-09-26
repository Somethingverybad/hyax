import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Music2, Search, X } from "lucide-react";
import { api, type PlaylistTrack } from "@/api/client";
import { fmtTime } from "@/lib/player";

/**
 * Музыка из своих плейлистов — в чат без перекачивания: файл уже лежит в
 * хранилище, сообщение ссылается на него по id трека (playlist_track_id),
 * отправка мгновенная. Шторка со всем списком и поиском по названию и
 * исполнителю. Порталом на body: открывается из панели ввода с transform.
 */
const TrackPicker = ({ onPick, onClose }: { onPick: (t: PlaylistTrack) => void; onClose: () => void }) => {
  const [tracks, setTracks] = useState<PlaylistTrack[] | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    api.listAllTracks().then(setTracks).catch(() => setTracks([]));
  }, []);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!tracks) return [];
    return s ? tracks.filter((t) => t.title.toLowerCase().includes(s) || (t.artist || "").toLowerCase().includes(s)) : tracks;
  }, [tracks, q]);

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end md:items-center md:justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="ui-card relative w-full md:w-[420px] rounded-t-[16px] md:rounded-lg bg-surface-2 flex flex-col max-h-[75vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 px-4 pt-4 pb-2 space-y-2">
          <div className="md:hidden mx-auto h-1 w-9 rounded-full bg-foreground/20" aria-hidden />
          <div className="flex items-center gap-2">
            <p className="text-h2 flex-1">Из моей музыки</p>
            <button type="button" onClick={onClose} className="p-1.5 text-subtle" aria-label="Закрыть"><X className="w-4 h-4" /></button>
          </div>
          <div className="relative">
            <Search className="w-4 h-4 text-subtle absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Поиск по названию или исполнителю"
              autoFocus
              className="w-full h-10 pl-9 pr-3 rounded-md bg-surface-4 text-body outline-none"
            />
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-[calc(var(--sab)+16px)] md:pb-4 space-y-1.5">
          {tracks === null ? (
            <p className="text-small text-subtle py-2">Загрузка…</p>
          ) : tracks.length === 0 ? (
            <p className="text-small text-subtle py-2">В плейлистах пока пусто — добавляйте музыку из сообщений через «В плейлист».</p>
          ) : shown.length === 0 ? (
            <p className="text-small text-subtle py-2">Ничего не нашлось</p>
          ) : shown.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onPick(t)}
              className="w-full min-h-12 px-3 py-2 rounded-md flex items-center gap-3 text-left bg-surface-4 active:opacity-70"
            >
              <span className="w-9 h-9 rounded-md bg-primary/15 text-primary flex items-center justify-center shrink-0"><Music2 className="w-4 h-4" /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-body truncate">{t.title}</span>
                <span className="block text-caption text-subtle truncate">
                  {[t.artist, t.duration ? fmtTime(t.duration) : "", t.playlist_name].filter(Boolean).join(" · ")}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default TrackPicker;
