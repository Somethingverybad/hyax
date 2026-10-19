import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Headphones, Heart } from "lucide-react";
import { api, type PlaylistStats } from "@/api/client";
import { t as tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Прослушивания и лайки плейлиста (chat/playlist_stats.py на сервере).
 *
 * Прослушивание — запустил чужой плейлист: со страницы плейлиста, по ссылке,
 * из карточки в чате. Сервер свои запуски и повторы в полчаса не считает; здесь
 * тоже не дёргаем его чаще раза в полчаса на плейлист. Новый счёт — событием
 * hyax:playlist-stats, его подхватывает PlaylistStatsBar на экране.
 */

const PLAY_EVERY = 30 * 60_000;
const sentAt = new Map<string, number>();
const EVENT = "hyax:playlist-stats";

export function reportPlaylistPlay(id: string, token?: string) {
  const now = Date.now();
  if (now - (sentAt.get(id) || 0) < PLAY_EVERY) return;
  sentAt.set(id, now);
  api.playlistPlayed(id, token)
    .then((st) => window.dispatchEvent(new CustomEvent(EVENT, { detail: { id, ...st } })))
    .catch(() => sentAt.delete(id));
}

/** «🎧 12 · ♥ 3». У чужого сердечко — кнопка (лайк — +5 к вайбометру
 *  создателя), у своего — просто счётчик. */
export function PlaylistStatsBar({ id, token, own, plays, likes, liked, className }: {
  id: string;
  /** Ключ ссылки — если плейлист открыт по ней (страница /pl/…, карточка в чате). */
  token?: string;
  own: boolean;
  plays?: number;
  likes?: number;
  liked?: boolean;
  className?: string;
}) {
  const [st, setSt] = useState<PlaylistStats>({ plays: plays ?? 0, likes: likes ?? 0, liked: !!liked });
  const [busy, setBusy] = useState(false);
  useEffect(() => { setSt({ plays: plays ?? 0, likes: likes ?? 0, liked: !!liked }); }, [id, plays, likes, liked]);
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<PlaylistStats & { id: string }>).detail;
      if (d?.id === id) setSt({ plays: d.plays, likes: d.likes, liked: d.liked });
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, [id]);

  const toggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (own || busy) return;
    const prev = st;
    const next = !st.liked;
    setSt({ ...st, liked: next, likes: Math.max(0, st.likes + (next ? 1 : -1)) });
    setBusy(true);
    try {
      const got = await api.likePlaylist(id, next, token);
      setSt(got);
      window.dispatchEvent(new CustomEvent(EVENT, { detail: { id, ...got } }));
    } catch (err) {
      setSt(prev);
      toast.error((err as Error).message || tr("Не получилось"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className={cn("inline-flex items-center gap-3 text-caption text-subtle", className)}>
      <span className="inline-flex items-center gap-1" title={tr("Прослушивания")} aria-label={tr("Прослушиваний: {n}", { n: st.plays })}>
        <Headphones className="w-3.5 h-3.5" /> {st.plays}
      </span>
      {own ? (
        <span className="inline-flex items-center gap-1" title={tr("Лайки")} aria-label={tr("Лайков: {n}", { n: st.likes })}>
          <Heart className="w-3.5 h-3.5" /> {st.likes}
        </span>
      ) : (
        <button type="button" onClick={(e) => void toggle(e)} disabled={busy} aria-pressed={st.liked}
          aria-label={st.liked ? tr("Убрать лайк") : tr("Лайкнуть плейлист")}
          className="inline-flex items-center gap-1 -my-1 px-1.5 py-1 rounded-md active:scale-95 transition-transform">
          <Heart className="w-4 h-4" style={st.liked ? { color: "#ff3b5c", fill: "#ff3b5c" } : undefined} />
          <span className={cn(st.liked && "text-foreground")}>{st.likes}</span>
        </button>
      )}
    </span>
  );
}
