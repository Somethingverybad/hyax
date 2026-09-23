import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ListMusic, Music2, Pause, Play, Plus, Trash2, ChevronLeft, Pencil, Share2, Send,
         Shuffle, Repeat, Repeat1, SkipBack, SkipForward, X } from "lucide-react";
import BottomNav from "@/components/BottomNav";
import { SettingsCard, SettingsRow } from "@/components/settings";
import { api, type Playlist, type PlaylistTrack } from "@/api/client";
import { readCache, writeCache } from "@/lib/session-cache";
import { sharePlaylistLink } from "@/lib/share";
import Identicon from "@/components/Identicon";
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
  // Из кеша — сразу, сеть только обновляет: иначе вкладка каждый раз
  // открывалась с «Загрузка…», хотя список не меняется от захода к заходу.
  const [lists, setLists] = useState<Playlist[] | null>(() => readCache<Playlist[]>("playlists"));
  const [open, setOpen] = useState<Playlist | null>(null);
  const [tracks, setTracks] = useState<PlaylistTrack[] | null>(null);
  const cachedTracks = (id: string) =>
    (readCache<Record<string, PlaylistTrack[]>>("playlistTracks") || {})[id] || null;
  const rememberTracks = (id: string, rows: PlaylistTrack[]) => {
    const all = readCache<Record<string, PlaylistTrack[]>>("playlistTracks") || {};
    // Держим только последние десять плейлистов: кеш не должен расти без края.
    const next = { ...all, [id]: rows };
    const keys = Object.keys(next);
    if (keys.length > 10) delete next[keys[0]];
    writeCache("playlistTracks", next);
  };
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const player = usePlayer();
  const playing = currentTrack();
  // Трек, который отправляем в чат: пока он выбран, открыта шторка выбора чата.
  const [sendFor, setSendFor] = useState<PlaylistTrack | null>(null);
  const [chats, setChats] = useState<{ id: string; title: string; avatar?: string | null }[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api.listPlaylists()
      .then((rows) => { setLists(rows); writeCache("playlists", rows); })
      .catch(() => setLists((l) => l ?? []));
  useEffect(() => { load(); }, []);

  const openList = async (pl: Playlist) => {
    setOpen(pl);
    setTracks(cachedTracks(pl.id));  // из кеша — мгновенно, дальше обновим
    try {
      const r = await api.getPlaylist(pl.id);
      setOpen(r.playlist);
      setTracks(r.tracks);
      rememberTracks(pl.id, r.tracks);
    } catch {
      if (!cachedTracks(pl.id)) { toast.error("Не удалось открыть плейлист"); setOpen(null); }
    }
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

  /** Ссылка на плейлист: ключ берём у сервера, дальше системное «Поделиться». */
  const share = async (pl: Playlist) => {
    try {
      const token = pl.share_token || (await api.sharePlaylist(pl.id));
      setOpen({ ...pl, share_token: token });
      const how = await sharePlaylistLink(pl.name, token);
      if (how === "copied") toast.success("Ссылка скопирована");
      if (how === "error") toast.error("Не удалось поделиться");
      load();
    } catch (e: any) { toast.error(e?.message || "Не получилось"); }
  };

  const unshare = async (pl: Playlist) => {
    try {
      await api.unsharePlaylist(pl.id);
      setOpen({ ...pl, share_token: "" });
      toast.success("Ссылка отозвана");
      load();
    } catch { toast.error("Не получилось"); }
  };

  /** Отправить трек в чат: список чатов берём тот же, что в списке переписок. */
  const pickChat = async (t: PlaylistTrack) => {
    setSendFor(t);
    if (chats) return;
    try {
      const rows = await api.getChats();
      const me = readCache<{ id: string }>("user")?.id;
      setChats(rows
        .filter((c: any) => c.kind !== "channel")
        .map((c: any) => ({
          id: c.id,
          title: c.name || (c.participants || []).find((p: any) => p.id !== me)?.username || "Чат",
          avatar: (c.participants || []).find((p: any) => p.id !== me)?.avatar_url || null,
        })));
    } catch { setChats([]); }
  };

  const sendTo = async (chatId: string) => {
    if (!sendFor || busy) return;
    setBusy(true);
    try {
      await api.sendTrackToChat(chatId, { file_url: sendFor.file_url, title: sendFor.title });
      toast.success("Отправлено");
      setSendFor(null);
    } catch (e: any) { toast.error(e?.message || "Не получилось"); }
    finally { setBusy(false); }
  };

  const removeTrack = async (t: PlaylistTrack) => {
    if (!open) return;
    const before = tracks || [];
    setTracks(before.filter((x) => x.id !== t.id));
    try {
      await api.removeTrack(open.id, t.id);
      rememberTracks(open.id, before.filter((x) => x.id !== t.id));
      load();
    }
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
          <button
            type="button"
            onClick={() => void (open.share_token ? unshare(open) : share(open))}
            className={cn("ui-icon-btn p-2", open.share_token ? "text-primary" : "text-muted-foreground")}
            aria-label={open.share_token ? "Закрыть доступ по ссылке" : "Поделиться плейлистом"}
          >
            <Share2 className="w-4 h-4" />
          </button>
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
                      <span className="flex items-center">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); void pickChat(t); }}
                          className="p-2 text-subtle active:text-primary"
                          aria-label="Отправить в чат"
                        >
                          <Send className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); void removeTrack(t); }}
                          className="p-2 text-subtle active:text-destructive"
                          aria-label="Убрать из плейлиста"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </span>
                    }
                  />
                );
              })}
            </SettingsCard>
          )}
        </div>
        {open.share_token && (
          <p className="px-4 pb-2 text-caption text-subtle">
            Плейлист открыт по ссылке. Нажмите значок «поделиться» ещё раз, чтобы отозвать её.
          </p>
        )}
        <PlayerPanel />
        <BottomNav />
        {sendFor && (
          <div className="fixed inset-0 z-[75] flex items-end" onClick={() => setSendFor(null)}>
            <div className="absolute inset-0 bg-black/40" />
            <div
              className="ui-card relative w-full rounded-t-[16px] bg-surface-2 p-4 pb-[calc(var(--sab)+20px)] space-y-2 max-h-[70vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mx-auto h-1 w-9 rounded-full bg-foreground/20" aria-hidden />
              <p className="text-h2">Отправить в чат</p>
              <p className="text-caption text-subtle truncate">{sendFor.title}</p>
              {chats === null ? (
                <p className="text-small text-subtle">Загрузка…</p>
              ) : chats.length === 0 ? (
                <p className="text-small text-subtle">Пока некуда отправлять — нет чатов.</p>
              ) : chats.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  disabled={busy}
                  onClick={() => void sendTo(c.id)}
                  className="w-full min-h-12 px-3 rounded-md flex items-center gap-3 text-left bg-surface-4 active:opacity-70 disabled:opacity-50"
                >
                  <Identicon id={c.id} avatarUrl={c.avatar} className="w-8 h-8 rounded-md shrink-0" />
                  <span className="flex-1 text-body truncate">{c.title}</span>
                </button>
              ))}
            </div>
          </div>
        )}
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
