import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Check, ChevronDown, ListMusic, Pause, Play, Plus } from "lucide-react";
import { api, type Playlist, type PlaylistTrack } from "@/api/client";
import { playlistLinkToken } from "@/lib/linkify";
import { currentTrack, playQueue, toggle, usePlayer, type Track } from "@/lib/player";
import { readCache } from "@/lib/session-cache";
import { t as tr, tn } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { PlaylistStatsBar, reportPlaylistPlay } from "@/components/music/PlaylistStats";
import { playPlaylist } from "@/lib/playlistResume";

type Data = { playlist: Playlist; owner: string; tracks: PlaylistTrack[] };

const toQueue = (t: PlaylistTrack): Track => ({ id: t.id, raw: t.file_url, title: t.title, artist: t.artist || undefined });

/**
 * Плейлист по ссылке прямо в сообщении или посте — как карточка пака:
 * название, чей, сколько треков, «Слушать» и «Себе». «Треки» разворачивают
 * список тут же — его можно слушать с любого места и забирать треки по одному,
 * не уходя из переписки. Тап по шапке открывает страницу плейлиста.
 */
const PlaylistLinkCard = ({ url, own }: { url: string; own?: boolean }) => {
  const navigate = useNavigate();
  const token = playlistLinkToken(url);
  const [data, setData] = useState<Data | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [taken, setTaken] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const player = usePlayer();
  const playing = currentTrack();

  useEffect(() => {
    if (!token) return;
    let alive = true;
    api.getSharedPlaylist(token).then((d) => alive && setData(d)).catch(() => alive && setData(null));
    return () => { alive = false; };
  }, [token]);

  if (!token) return null;
  // Ширина не меньше 248 px: пузырь подстраивается под содержимое, и без
  // этого кнопки сжимались так, что «Слушать» переносилось посреди слова.
  const box = cn("ui-card mt-1.5 w-full min-w-[248px] max-w-[280px] rounded-lg overflow-hidden text-left", own ? "bg-black/15" : "bg-surface-2");

  // Ссылку отозвали — так и пишем, а не прячем карточку: иначе сообщение
  // выглядело бы пустым (ссылку из текста мы убираем).
  if (data === null) {
    return (
      <div className={box}>
        <div className="px-2.5 py-2 flex items-center gap-2.5">
          <span className="w-10 h-10 shrink-0 rounded-md bg-surface-3 flex items-center justify-center"><ListMusic className="w-5 h-5 opacity-60" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-small font-medium">{tr("Плейлист недоступен")}</span>
            <span className="block text-caption opacity-70">{tr("Владелец закрыл ссылку.")}</span>
          </span>
        </div>
      </div>
    );
  }

  const me = readCache<{ username?: string }>("user")?.username;
  const mine = !!data && !!me && data.owner === me;
  const name = data ? (data.playlist.is_default ? tr(data.playlist.name) : data.playlist.name) : tr("Загрузка…");
  // Трек по ссылке — «Добавить себе» в плеере тянет его с ключом ссылки; свой — уже мой.
  const queue = data?.tracks.map((x) => ({ ...toQueue(x), source: mine ? "mine" as const : "track" as const, token: token || undefined })) || [];
  const fromHere = !!playing && !!data?.tracks.some((t) => t.id === playing.id) && !player.live;

  const playAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!queue.length) return;
    if (fromHere) void toggle();
    else if (data) {
      // Уже слушал — с того места, где остановился (lib/playlistResume).
      const byId = new Map(queue.map((q) => [q.id, q]));
      void playPlaylist(data.tracks, (x) => byId.get(x.id)!, { playlistId: data.playlist.id, token }, data.playlist.resume);
      if (!mine) reportPlaylistPlay(data.playlist.id, token);
    }
  };

  const save = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (busy || saved || mine) return;
    setBusy(true);
    try {
      const copy = await api.savePlaylistCopy(token);
      setSaved(true);
      toast.success(tr("Плейлист «{name}» у вас", { name: copy.is_default ? tr(copy.name) : copy.name }));
    } catch (err: any) { toast.error(err?.message || tr("Не получилось")); }
    finally { setBusy(false); }
  };

  const take = async (t: PlaylistTrack) => {
    if (taken.has(t.id)) return;
    try {
      const r = await api.addTrackFromPublic(t.id, token);
      setTaken((s) => new Set(s).add(t.id));
      toast.success(r.already ? tr("Уже есть в «Моей музыке»") : tr("Добавлено в «Мою музыку»"));
    } catch (err: any) { toast.error(err?.message || tr("Не получилось")); }
  };

  return (
    <div className={box} onClick={(e) => e.stopPropagation()}>
      <button type="button" onClick={() => navigate(`/pl/${token}`)} className="w-full px-2.5 py-2 flex items-center gap-2.5 text-left">
        <span className="w-10 h-10 shrink-0 rounded-md bg-surface-3 flex items-center justify-center">
          <ListMusic className="w-5 h-5 text-primary" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-small font-medium truncate">{name}</span>
          <span className="block text-caption opacity-70 truncate">
            {data ? `${tr("Плейлист {owner}", { owner: data.owner })} · ${tn(data.tracks.length, "{n} трек", "{n} трека", "{n} треков")}` : " "}
          </span>
        </span>
      </button>

      {/* Прослушивания и лайк — своей строкой: в ряду кнопок им места нет,
          «Слушать» сжималась до полоски. */}
      {data && (
        <div className="px-2.5 -mt-1 pb-1.5 pl-[62px]">
          <PlaylistStatsBar id={data.playlist.id} token={token} own={mine} plays={data.playlist.plays}
            likes={data.playlist.likes} liked={data.playlist.liked} className="opacity-90 [&_*]:!text-inherit" />
        </div>
      )}
      {data && (
        <div className="px-2.5 pb-2 flex gap-1.5">
          <button type="button" onClick={playAll} disabled={!queue.length}
            className="h-8 flex-1 min-w-0 rounded-md bg-primary text-primary-foreground text-caption font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap active:opacity-90 disabled:opacity-50">
            {fromHere && player.playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            {fromHere && player.playing ? tr("Пауза") : tr("Слушать")}
          </button>
          <button type="button" onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }} disabled={!queue.length}
            aria-expanded={open}
            className="h-8 px-2.5 rounded-md bg-surface-4 text-caption font-medium flex items-center gap-1 whitespace-nowrap active:opacity-80 disabled:opacity-50">
            {tr("Треки")} <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", open && "rotate-180")} />
          </button>
          {mine || saved ? (
            <span className="h-8 px-2.5 rounded-md bg-surface-4 text-caption font-medium flex items-center gap-1 whitespace-nowrap">
              <Check className="w-3.5 h-3.5" /> {mine ? tr("Ваш") : tr("У вас")}
            </span>
          ) : (
            <button type="button" onClick={save} disabled={busy}
              className="h-8 px-2.5 rounded-md bg-surface-4 text-caption font-medium flex items-center gap-1 whitespace-nowrap active:opacity-80 disabled:opacity-50">
              <Plus className="w-3.5 h-3.5" /> {busy ? "…" : tr("Себе")}
            </button>
          )}
        </div>
      )}

      {/* Развёрнутый список: прокрутка внутри карточки, чтобы длинный
          плейлист не растягивал сообщение на весь экран. */}
      {data && open && (
        <div className="border-t border-black/10 max-h-[264px] overflow-y-auto">
          {data.tracks.map((t, i) => {
            const isNow = playing?.id === t.id && !player.live;
            return (
              <div key={t.id} className="flex items-center gap-2 px-2.5 py-1.5">
                <button type="button" onClick={(e) => { e.stopPropagation(); void playQueue(queue, i, { source: { playlistId: data.playlist.id, token } }); if (!mine) reportPlaylistPlay(data.playlist.id, token); }}
                  className="min-w-0 flex-1 flex items-center gap-2 text-left" aria-label={t.title}>
                  <span className={cn("w-7 h-7 shrink-0 rounded-md flex items-center justify-center",
                    isNow ? "bg-primary text-primary-foreground" : "bg-surface-4")}>
                    {isNow && player.playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-caption font-medium truncate">{t.title}</span>
                    {t.artist && <span className="block text-[11px] opacity-70 truncate">{t.artist}</span>}
                  </span>
                </button>
                {!mine && (
                  <button type="button" onClick={(e) => { e.stopPropagation(); void take(t); }}
                    className={cn("p-1.5 shrink-0", taken.has(t.id) ? "text-primary" : "opacity-70")}
                    aria-label={taken.has(t.id) ? tr("Добавлено в «Мою музыку»") : tr("В «Мою музыку»")}>
                    {taken.has(t.id) ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default PlaylistLinkCard;
