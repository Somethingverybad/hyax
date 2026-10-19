import { t as tr, tn } from "@/lib/i18n";
import { confirmDialog } from "@/lib/confirm";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ListMusic, Music2, Pause, Play, Plus, Trash2, ChevronLeft, Pencil, Share2, Send, Globe, Radio, Headphones, Upload, Link2, Link2Off,
         Shuffle, Repeat, Repeat1, SkipBack, SkipForward, X, Volume1, Volume2, VolumeX, Check, Loader2, FolderUp } from "lucide-react";
import BottomNav from "@/components/BottomNav";
import { SettingsCard, SettingsRow } from "@/components/settings";
import { api, type Playlist, type PlaylistTrack, type PublicPlaylist, type StationInfo } from "@/api/client";
import PublicPlaylistView from "@/components/music/PublicPlaylistView";
import StationView, { stationName } from "@/components/music/StationView";
import { joinStation, setRadioNotice, useRadio } from "@/lib/radio";
import { readCache, writeCache } from "@/lib/session-cache";
import { playlistLink, sharePlaylistLink } from "@/lib/share";
import Identicon from "@/components/Identicon";
import { playQueue, usePlayer, currentTrack, fmtTime, next, prev, seek, stop, toggle,
         toggleShuffle, cycleRepeat, setVolume, type Track } from "@/lib/player";
import { cn } from "@/lib/utils";
import { Capacitor } from "@capacitor/core";
import { clearFinished, enqueueTracks, nativeTrackUploads, pickNativeTracks, retryFailed, useTrackUploads } from "@/lib/trackUploads";
import { PlaylistStatsBar } from "@/components/music/PlaylistStats";
import ResumeButton from "@/components/music/ResumeButton";
import ShareTrackButton from "@/components/music/ShareTrackButton";
import { playPlaylist, resumeTrack } from "@/lib/playlistResume";

/**
 * Музыка: плейлисты из того, что присылали в переписке.
 *
 * Играет общий плеер приложения (@/lib/player) — та же очередь, что у
 * аудиофайлов в чате, поэтому музыка не обрывается при переходе на другой
 * экран, а мини-плеер и экран блокировки работают сами собой.
 */
const trackToQueue = (t: PlaylistTrack): Track => ({
  id: t.id, raw: t.file_url, title: t.title, artist: t.artist || undefined, source: "mine",
});

/** Трек пришёл из переписки (файл вложения), а не загружен в плейлист сам. */
const fromChat = (t: PlaylistTrack) => /^(s3:\/\/|\/media\/)messages\//.test(t.file_url);

const pluralTracks = (n: number) => tn(n, "{n} трек", "{n} трека", "{n} треков");

/** Включённая кнопка-значок в шапке плейлиста. С «!»: у форм «мягкая» и
 *  «контурная» .ui-icon-btn задаёт свой цвет и перебивал text-primary — было
 *  не понять, открыт плейлист или нет. */
const ICON_ON = "!bg-primary !text-primary-foreground !border-primary";

/** «Моя музыка» заводит сервер — её имя переводим; свои названия — как есть. */
const playlistName = (pl: Playlist) => (pl.is_default ? tr(pl.name) : pl.name);


/**
 * Панель плеера на экране музыки: здесь она не всплывающая полоска, а часть
 * экрана — вкладка целиком отведена под музыку. Полоску (MiniPlayer) на этом
 * экране прячем, чтобы плеер не двоился.
 */
const PlayerPanel = ({ onLive }: { onLive?: () => void }) => {
  const s = usePlayer();
  const t = currentTrack();
  if (!t) return null;
  const frac = s.duration ? Math.min(1, s.time / s.duration) : 0;
  const RepeatIcon = s.repeat === "one" ? Repeat1 : Repeat;

  return (
    <div className="shrink-0 px-4 pb-2" style={{ marginBottom: "var(--mint-nav-space, 0px)" }}>
      <div className="ui-card rounded-lg bg-surface-2 border border-border p-3 space-y-2">
        <div className="flex items-center gap-2">
          {/* В эфире по нажатию — экран эфира. */}
          <span className={cn("min-w-0 flex-1", s.live && onLive && "cursor-pointer")} onClick={s.live ? onLive : undefined}>
            <span className="block text-body truncate">{t.title}</span>
            <span className="block text-caption text-subtle tabular-nums truncate">
              {fmtTime(s.time)}{s.duration ? ` / ${fmtTime(s.duration)}` : ""}
              {s.live ? ` · 📻 ${s.live.name}` : s.queue.length > 1 && ` · ${tr("{i} из {n}", { i: s.index + 1, n: s.queue.length })}`}
            </span>
          </span>
          <ShareTrackButton track={t} className="p-2" />
          <button type="button" onClick={stop} className="p-2 text-subtle" aria-label={tr("Закрыть плеер")}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div
          className={cn("h-1.5 rounded-full bg-black/20 overflow-hidden", !s.live && "cursor-pointer")}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            if (s.duration) seek(((e.clientX - r.left) / r.width) * s.duration);
          }}
        >
          <div className="h-full rounded-full bg-primary" style={{ width: `${frac * 100}%` }} />
        </div>

        {/* Эфир: трек и место задаёт расписание — только пауза у себя. */}
        {s.live ? (
          <div className="flex items-center justify-center">
            <button type="button" onClick={() => void toggle()} className="w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center" aria-label={s.playing ? tr("Пауза") : tr("Играть")}>
              {s.playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={toggleShuffle}
              aria-pressed={s.shuffle}
              aria-label={tr("Перемешать")}
              className={cn("w-10 h-10 rounded-full flex items-center justify-center",
                s.shuffle ? "text-primary bg-primary/15" : "text-subtle")}
            >
              <Shuffle className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => void prev()} className="w-10 h-10 rounded-full flex items-center justify-center text-foreground" aria-label={tr("Предыдущий")}>
                <SkipBack className="w-5 h-5" />
              </button>
              <button type="button" onClick={() => void toggle()} className="w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center" aria-label={s.playing ? tr("Пауза") : tr("Играть")}>
                {s.playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
              </button>
              <button type="button" onClick={() => void next()} className="w-10 h-10 rounded-full flex items-center justify-center text-foreground" aria-label={tr("Следующий")}>
                <SkipForward className="w-5 h-5" />
              </button>
            </div>
            <button
              type="button"
              onClick={cycleRepeat}
              aria-pressed={s.repeat !== "off"}
              aria-label={s.repeat === "one" ? tr("Повторять один") : s.repeat === "all" ? tr("Повторять всё") : tr("Без повтора")}
              className={cn("w-10 h-10 rounded-full flex items-center justify-center",
                s.repeat !== "off" ? "text-primary bg-primary/15" : "text-subtle")}
            >
              <RepeatIcon className="w-5 h-5" />
            </button>
          </div>
        )}
        {/* Громкость — на десктопе (на телефоне есть кнопки). */}
        <div className="hidden md:flex items-center gap-2 mt-3 justify-center" title={tr("Громкость")}>
          <button type="button" onClick={() => setVolume(s.volume > 0 ? 0 : 1)} className="w-8 h-8 flex items-center justify-center text-subtle" aria-label={s.volume > 0 ? tr("Выключить звук") : tr("Включить звук")}>
            {s.volume === 0 ? <VolumeX className="w-4 h-4" /> : s.volume < 0.5 ? <Volume1 className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <input type="range" min={0} max={1} step={0.02} value={s.volume} onChange={(e) => setVolume(Number(e.target.value))}
            className="w-40 h-1 accent-primary cursor-pointer" aria-label={tr("Громкость")} />
        </div>
      </div>
    </div>
  );
};

const Music = () => {
  // Из кеша — сразу, сеть только обновляет: иначе вкладка каждый раз
  // открывалась с «Загрузка…», хотя список не меняется от захода к заходу.
  const [lists, setLists] = useState<Playlist[] | null>(() => readCache<Playlist[]>("playlists"));
  // Открытые плейлисты собеседников — отдельным списком под своими.
  const [shared, setShared] = useState<PublicPlaylist[] | null>(() => readCache<PublicPlaylist[]>("publicPlaylists"));
  const [openShared, setOpenShared] = useState<PublicPlaylist | null>(null);
  // Эфиры: свои и собеседников/каналов; каналы, от которых я могу вести эфир.
  const [stations, setStations] = useState<StationInfo[] | null>(() => readCache<StationInfo[]>("stations"));
  const [airChannels, setAirChannels] = useState<{ id: string; name: string; avatar_url?: string | null }[]>([]);
  const [openStation, setOpenStation] = useState<StationInfo | null>(null);
  // Выбор «от себя / от канала» при запуске эфира.
  const [airPick, setAirPick] = useState<Playlist | null>(null);
  const radio = useRadio();
  // Загрузка своих треков в открытый плейлист: файлы по одному, счётчик — в кнопке.
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  // Очередь загрузки (lib/trackUploads): живёт выше экрана, оборванное повторяет.
  const queue = useTrackUploads();
  const [dragOver, setDragOver] = useState(false);
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
  const loadShared = () =>
    api.listPublicPlaylists()
      .then((rows) => { setShared(rows); writeCache("publicPlaylists", rows); })
      .catch(() => setShared((l) => l ?? []));
  const loadStations = () =>
    api.listStations()
      .then((r) => { setStations(r.stations); setAirChannels(r.channels); writeCache("stations", r.stations); })
      .catch(() => setStations((l) => l ?? []));
  useEffect(() => { load(); loadShared(); loadStations(); }, []);
  // «Эфир закончился» — тостом, пока открыта вкладка.
  useEffect(() => {
    setRadioNotice((msg) => { toast(msg); loadStations(); });
    return () => setRadioNotice(null);
  }, []);
  // Слушаю эфир, а его карточки в списке нет — открыть экран по плееру.
  const openLive = () => {
    const d = radio.data?.station;
    if (d) setOpenStation(d);
  };

  const openList = async (pl: Playlist) => {
    setOpen(pl);
    setTracks(cachedTracks(pl.id));  // из кеша — мгновенно, дальше обновим
    try {
      const r = await api.getPlaylist(pl.id);
      setOpen(r.playlist);
      setTracks(r.tracks);
      rememberTracks(pl.id, r.tracks);
    } catch {
      if (!cachedTracks(pl.id)) { toast.error(tr("Не удалось открыть плейлист")); setOpen(null); }
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
    } catch (e: any) { toast.error(e?.message || tr("Не получилось")); }
  };

  const rename = async (pl: Playlist) => {
    const value = prompt(tr("Название плейлиста"), pl.name)?.trim();
    if (!value || value === pl.name) return;
    try {
      const next = await api.renamePlaylist(pl.id, value);
      setOpen(next); load();
    } catch (e: any) { toast.error(e?.message || tr("Не получилось")); }
  };

  const remove = async (pl: Playlist) => {
    if (!(await confirmDialog(tr("Удалить плейлист «{name}»? Сама музыка в переписке останется.", { name: playlistName(pl) })))) return;
    try {
      await api.deletePlaylist(pl.id);
      setOpen(null); load();
    } catch (e: any) { toast.error(e?.message || tr("Не получилось")); }
  };

  /** Ссылка на плейлист: ключ берём у сервера, дальше системное «Поделиться». */
  const share = async (pl: Playlist) => {
    try {
      const token = pl.share_token || (await api.sharePlaylist(pl.id));
      setOpen({ ...pl, share_token: token });
      const how = await sharePlaylistLink(pl.name, token);
      if (how === "copied") toast.success(tr("Ссылка скопирована"));
      if (how === "error") toast.error(tr("Не удалось поделиться"));
      load();
    } catch (e: any) { toast.error(e?.message || tr("Не получилось")); }
  };

  /** Поделиться плейлистом: в чат или канал — карточкой, наружу — ссылкой. */
  const [shareSheet, setShareSheet] = useState(false);
  const [sharePick, setSharePick] = useState(false);

  const sendPlaylistTo = async (chatId: string) => {
    if (!open || busy) return;
    setBusy(true);
    try {
      const token = open.share_token || (await api.sharePlaylist(open.id));
      setOpen((o) => (o ? { ...o, share_token: token } : o));
      await api.sendMessage(chatId, playlistLink(token));
      toast.success(tr("Отправлено"));
      setSharePick(false);
      load();
    } catch (e: any) { toast.error(e?.message || tr("Не получилось")); }
    finally { setBusy(false); }
  };

  /** Свои треки — с устройства прямо в плейлист: файлами, папкой (на
   *  компьютере и в браузере) или перетаскиванием файлов и папок. */
  const uploadFiles = (list: File[]) => {
    if (!open || !list.length) return;
    const n = enqueueTracks(list, open.id);
    if (!n) toast.error(tr("Музыки не нашлось — поддерживаются MP3, M4A, FLAC, WAV, OGG, OPUS"));
    else if (n < list.length) toast(tr("Музыки — {n} из {all}, остальное пропущено", { n, all: list.length }));
  };
  /** Кнопки «Загрузить» и «Папку»: на телефоне со сборкой, где есть плагин, —
   *  системный выбор и фоновая отправка (идёт и при заблокированном экране). */
  const pickTracks = (folder: boolean) => {
    if (!nativeTrackUploads) { (folder ? folderInput : fileInput).current?.click(); return; }
    if (!open) return;
    pickNativeTracks(open.id, folder).then((n) => {
      if (n === 0) toast.error(tr("Музыки не нашлось — поддерживаются MP3, M4A, FLAC, WAV, OGG, OPUS"));
    }).catch((e) => toast.error(tr((e as Error).message || "Не удалось открыть выбор файлов")));
  };
  // Перетащили файлы или папки — обходим папки целиком (вложенные тоже).
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const entries = [...e.dataTransfer.items].map((it) => it.webkitGetAsEntry?.()).filter(Boolean) as FileSystemEntry[];
    if (!entries.length) { uploadFiles([...e.dataTransfer.files]); return; }
    const out: File[] = [];
    const walk = async (en: FileSystemEntry): Promise<void> => {
      if (en.isFile) { out.push(await new Promise<File>((ok, fail) => (en as FileSystemFileEntry).file(ok, fail))); return; }
      const reader = (en as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((ok, fail) => reader.readEntries(ok, fail));
        if (!batch.length) break;
        for (const child of batch) await walk(child);
      }
    };
    for (const en of entries) await walk(en).catch(() => {});
    uploadFiles(out);
  };
  // Трек дошёл — список перечитываем (не чаще раза в секунду).
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const on = (e: Event) => {
      const id = (e as CustomEvent<{ playlistId: string }>).detail?.playlistId;
      if (t) return;
      t = setTimeout(() => { t = null; if (open && open.id === id) void openList(open); load(); }, 1000);
    };
    window.addEventListener("hyax:track-uploaded", on);
    return () => { window.removeEventListener("hyax:track-uploaded", on); if (t) clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open?.id]);

  /** Запустить эфир плейлиста: от себя или от канала, где я админ. */
  const startAir = async (pl: Playlist, channelId?: string) => {
    setAirPick(null);
    const current = (stations || []).find((st) => st.mine && (channelId ? st.channel?.id === channelId : !st.channel));
    if (current && current.playlist_id !== pl.id &&
        !(await confirmDialog(tr("Сейчас в эфире «{now}». Поставить вместо него «{name}»?", { now: stationName(current), name: playlistName(pl) }), { ok: tr("Поставить"), danger: false }))) return;
    setBusy(true);
    try {
      const st = await api.startStation(pl.id, channelId);
      toast.success(tr("Эфир запущен"));
      loadStations();
      setOpen(null);
      setOpenStation(st.station);
      void joinStation(st.station.id, st);
    } catch (e: any) { toast.error(e?.message || tr("Не получилось")); }
    finally { setBusy(false); }
  };

  /** Открыть плейлист собеседникам (видят его во вкладке «Музыка») или закрыть. */
  const togglePublic = async (pl: Playlist) => {
    const want = !pl.is_public;
    setOpen({ ...pl, is_public: want });
    try {
      const next = await api.setPlaylistPublic(pl.id, want);
      setOpen((o) => (o && o.id === pl.id ? { ...o, is_public: next.is_public } : o));
      toast.success(want ? tr("Плейлист видят ваши собеседники") : tr("Плейлист снова только ваш"));
      load();
    } catch (e: any) {
      setOpen((o) => (o && o.id === pl.id ? { ...o, is_public: pl.is_public } : o));
      toast.error(e?.message || tr("Не получилось"));
    }
  };

  const unshare = async (pl: Playlist) => {
    try {
      await api.unsharePlaylist(pl.id);
      setOpen({ ...pl, share_token: "" });
      toast.success(tr("Ссылка отозвана"));
      load();
    } catch { toast.error(tr("Не получилось")); }
  };

  /** Отправить трек в чат: список чатов берём тот же, что в списке переписок. */
  const pickChat = async (t: PlaylistTrack) => {
    setSendFor(t);
    await ensureChats();
  };

  const ensureChats = async () => {
    if (chats) return;
    try {
      const rows = await api.getChats();
      const me = readCache<{ id: string }>("user")?.id;
      // Секретные — только с шифрованием на устройстве, Стена — не чат.
      setChats(rows
        .filter((c: any) => !["channel", "secret", "wall"].includes(c.kind))
        .map((c: any) => ({
          id: c.id,
          title: c.name || (c.participants || []).find((p: any) => p.id !== me)?.username || tr("Чат"),
          avatar: (c.participants || []).find((p: any) => p.id !== me)?.avatar_url || null,
        })));
    } catch { setChats([]); }
  };

  const sendTo = async (chatId: string) => {
    if (!sendFor || busy) return;
    setBusy(true);
    try {
      await api.sendTrackToChat(chatId, { file_url: sendFor.file_url, title: sendFor.title });
      toast.success(tr("Отправлено"));
      setSendFor(null);
    } catch (e: any) { toast.error(e?.message || tr("Не получилось")); }
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
    catch { toast.error(tr("Не удалось убрать трек")); setTracks(before); }
  };

  // ── Эфир
  if (openStation) {
    return (
      <div className="h-screen flex flex-col bg-background nav-rail-pad">
        <StationView item={openStation} onBack={() => { setOpenStation(null); loadStations(); }} />
        <PlayerPanel />
        <BottomNav />
      </div>
    );
  }

  // ── Открытый плейлист собеседника
  if (openShared) {
    return (
      <div className="h-screen flex flex-col bg-background nav-rail-pad">
        <PublicPlaylistView
          item={openShared}
          onBack={() => { setOpenShared(null); loadShared(); }}
          onSaved={(pl) => { setOpenShared(null); load(); void openList(pl); }}
        />
        <PlayerPanel onLive={openLive} />
        <BottomNav />
      </div>
    );
  }

  // ── Плейлист целиком
  if (open) {
    return (
      <div className="h-screen flex flex-col bg-background nav-rail-pad">
        <div className="shrink-0 px-2 py-3 pad-safe-top bg-background border-b border-border min-h-14 flex items-center gap-2">
          <button type="button" onClick={() => { setOpen(null); load(); }} className="ui-icon-btn p-2" aria-label={tr("Назад")}>
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="text-h2 flex-1 truncate">{playlistName(open)}</span>
          <button
            type="button"
            onClick={() => void togglePublic(open)}
            aria-pressed={!!open.is_public}
            className={cn("ui-icon-btn p-2", open.is_public ? ICON_ON : "text-muted-foreground")}
            aria-label={open.is_public ? tr("Сделать плейлист личным") : tr("Открыть плейлист собеседникам")}
          >
            <Globe className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setShareSheet(true)}
            aria-pressed={!!open.share_token}
            className={cn("ui-icon-btn p-2", open.share_token ? ICON_ON : "text-muted-foreground")}
            aria-label={tr("Поделиться плейлистом")}
          >
            <Share2 className="w-4 h-4" />
          </button>
          <button type="button" onClick={() => rename(open)} className="ui-icon-btn p-2 text-muted-foreground" aria-label={tr("Переименовать")}>
            <Pencil className="w-4 h-4" />
          </button>
          {!open.is_default && (
            <button type="button" onClick={() => remove(open)} className="ui-icon-btn p-2 text-destructive" aria-label={tr("Удалить плейлист")}>
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3" style={{ paddingBottom: "calc(16px + var(--mint-nav-space, 0px))" }}>
          {tracks === null ? (
            <p className="text-small text-subtle">{tr("Загрузка…")}</p>
          ) : tracks.length === 0 ? (
            <div className="ui-card rounded-lg bg-surface-2 border border-border p-4 text-small text-subtle">
              {tr("Пусто. Загрузите свои треки кнопкой ниже или добавьте музыку из переписки: удерживайте аудиофайл в чате и выберите «В плейлист».")}
            </div>
          ) : (
            <>
            {/* Прослушивания и лайки — от других; у личного плейлиста их нет, строку не показываем. */}
            {(open.is_public || !!open.share_token || !!open.plays || !!open.likes) && (
              <PlaylistStatsBar id={open.id} own plays={open.plays} likes={open.likes} className="px-1" />
            )}
            {(() => {
              const at = resumeTrack(tracks, open.id, open.resume);
              return at && open.resume ? (
                <ResumeButton track={at} position={open.resume.position}
                  onClick={() => void playPlaylist(tracks, trackToQueue, { playlistId: open.id }, open.resume)} />
              ) : null;
            })()}
            {(() => {
              // Этот плейлист уже в эфире (от меня или от канала) — кнопка ведёт в эфир.
              const air = (stations || []).find((st) => st.mine && st.playlist_id === open.id);
              return air ? (
                <button type="button" onClick={() => { setOpen(null); setOpenStation(air); }}
                  className="w-full h-11 rounded-md bg-destructive text-destructive-foreground font-medium flex items-center justify-center gap-2 active:opacity-90">
                  <Radio className="w-4 h-4" /> {tr("В эфире")} · {tn(air.listeners, "{n} слушает", "{n} слушают", "{n} слушают")}
                </button>
              ) : (
                <button type="button" disabled={busy}
                  onClick={() => (airChannels.length ? setAirPick(open) : void startAir(open))}
                  className="w-full h-11 rounded-md border border-border font-medium flex items-center justify-center gap-2 active:opacity-80 disabled:opacity-50">
                  <Radio className="w-4 h-4" /> {tr("Запустить эфир")}
                </button>
              );
            })()}
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
                    hint={t.artist || (!t.source && fromChat(t) ? tr("Сообщение удалено, музыка осталась") : undefined)}
                    value={isNow && player.duration ? fmtTime(player.time) : undefined}
                    onClick={() => void playQueue(tracks.map(trackToQueue), i, { source: { playlistId: open.id } })}
                    trailing={
                      <span className="flex items-center">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); void pickChat(t); }}
                          className="p-2 text-subtle active:text-primary"
                          aria-label={tr("Отправить в чат")}
                        >
                          <Send className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); void removeTrack(t); }}
                          className="p-2 text-subtle active:text-destructive"
                          aria-label={tr("Убрать из плейлиста")}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </span>
                    }
                  />
                );
              })}
            </SettingsCard>
            </>
          )}
          {tracks !== null && (
            <>
              <input ref={fileInput} type="file" accept="audio/*,.mp3,.m4a,.aac,.flac,.wav,.ogg,.opus" multiple hidden
                onChange={(e) => { const l = [...(e.target.files || [])]; e.target.value = ""; uploadFiles(l); }} />
              {/* Папка (и вложенные) — где браузер умеет выбирать папки: компьютер и веб. */}
              <input ref={folderInput} type="file" multiple hidden {...{ webkitdirectory: "", directory: "" }}
                onChange={(e) => { const l = [...(e.target.files || [])]; e.target.value = ""; uploadFiles(l); }} />
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => void onDrop(e)}
                className={cn("flex gap-2 rounded-md", dragOver && "ring-2 ring-primary ring-offset-2 ring-offset-background")}
              >
                <button type="button" onClick={() => pickTracks(false)}
                  className="flex-1 h-11 rounded-md border border-dashed border-border text-small font-medium flex items-center justify-center gap-2 active:opacity-80">
                  <Upload className="w-4 h-4" /> {tr("Загрузить свои треки")}
                </button>
                {(canPickFolder || nativeTrackUploads) && (
                  <button type="button" onClick={() => pickTracks(true)}
                    className="h-11 px-3 rounded-md border border-dashed border-border text-small font-medium flex items-center justify-center gap-2 active:opacity-80">
                    <FolderUp className="w-4 h-4" /> {tr("Папку")}
                  </button>
                )}
              </div>
              {canPickFolder && <p className="px-1 -mt-1 text-caption text-subtle">{tr("Можно перетащить сюда файлы или папки.")}</p>}
              <UploadQueueBar />
            </>
          )}
          {/* Подписи — в прокрутке: под ней отступ на нижнюю панель, а снаружи
              плавающая панель «Мяты» их закрывала. */}
          {open.is_public && (
            <p className="px-1 text-caption text-subtle">
              {tr("Плейлист видят ваши собеседники по личной переписке: могут слушать и сохранить себе. Нажмите значок глобуса, чтобы закрыть.")}
            </p>
          )}
          {open.share_token && (
            <p className="px-1 text-caption text-subtle">
              {tr("Плейлист открыт по ссылке: его слушают и сохраняют все, у кого она есть, — в том числе карточкой в сообщениях и постах. Закрыть ссылку — в «Поделиться».")}
            </p>
          )}
        </div>
        <PlayerPanel onLive={openLive} />
        <BottomNav />
        {shareSheet && (
          <div className="fixed inset-0 z-[75] flex items-end" onClick={() => setShareSheet(false)}>
            <div className="absolute inset-0 bg-black/40" />
            <div className="ui-card relative w-full rounded-t-[16px] bg-surface-2 p-4 pb-[calc(var(--sab)+20px)] space-y-2"
              onClick={(e) => e.stopPropagation()}>
              <div className="mx-auto h-1 w-9 rounded-full bg-foreground/20" aria-hidden />
              <p className="text-h2">{tr("Поделиться плейлистом")}</p>
              <p className="text-caption text-subtle">{tr("В чате или посте плейлист появится карточкой: его можно послушать, развернуть и сохранить себе.")}</p>
              <button type="button" onClick={() => { setShareSheet(false); setSharePick(true); void ensureChats(); }}
                className="w-full min-h-12 px-3 rounded-md flex items-center gap-3 text-left bg-surface-4 active:opacity-70">
                <Send className="w-5 h-5 text-primary shrink-0" /><span className="flex-1 text-body">{tr("Отправить в чат")}</span>
              </button>
              <button type="button" onClick={() => { setShareSheet(false); void share(open); }}
                className="w-full min-h-12 px-3 rounded-md flex items-center gap-3 text-left bg-surface-4 active:opacity-70">
                <Link2 className="w-5 h-5 text-primary shrink-0" /><span className="flex-1 text-body">{tr("Поделиться ссылкой")}</span>
              </button>
              {open.share_token && (
                <button type="button" onClick={() => { setShareSheet(false); void unshare(open); }}
                  className="w-full min-h-12 px-3 rounded-md flex items-center gap-3 text-left bg-surface-4 active:opacity-70 text-destructive">
                  <Link2Off className="w-5 h-5 shrink-0" />
                  <span className="flex-1">
                    <span className="block text-body">{tr("Закрыть ссылку")}</span>
                    <span className="block text-caption opacity-80">{tr("Карточки в сообщениях перестанут открываться")}</span>
                  </span>
                </button>
              )}
            </div>
          </div>
        )}
        {sharePick && (
          <div className="fixed inset-0 z-[75] flex items-end" onClick={() => setSharePick(false)}>
            <div className="absolute inset-0 bg-black/40" />
            <div className="ui-card relative w-full rounded-t-[16px] bg-surface-2 p-4 pb-[calc(var(--sab)+20px)] space-y-2 max-h-[70vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}>
              <div className="mx-auto h-1 w-9 rounded-full bg-foreground/20" aria-hidden />
              <p className="text-h2">{tr("Отправить в чат")}</p>
              <p className="text-caption text-subtle truncate">{playlistName(open)}</p>
              {/* Свои каналы — тоже: плейлист уйдёт постом. */}
              {airChannels.map((c) => (
                <button key={c.id} type="button" disabled={busy} onClick={() => void sendPlaylistTo(c.id)}
                  className="w-full min-h-12 px-3 rounded-md flex items-center gap-3 text-left bg-surface-4 active:opacity-70 disabled:opacity-50">
                  <Identicon id={c.id} avatarUrl={c.avatar_url} className="w-8 h-8 rounded-md shrink-0" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-body truncate">{c.name}</span>
                    <span className="block text-caption text-subtle">{tr("Канал")}</span>
                  </span>
                </button>
              ))}
              {chats === null ? (
                <p className="text-small text-subtle">{tr("Загрузка…")}</p>
              ) : chats.map((c) => (
                <button key={c.id} type="button" disabled={busy} onClick={() => void sendPlaylistTo(c.id)}
                  className="w-full min-h-12 px-3 rounded-md flex items-center gap-3 text-left bg-surface-4 active:opacity-70 disabled:opacity-50">
                  <Identicon id={c.id} avatarUrl={c.avatar} className="w-8 h-8 rounded-md shrink-0" />
                  <span className="flex-1 text-body truncate">{c.title}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {airPick && (
          <div className="fixed inset-0 z-[75] flex items-end" onClick={() => setAirPick(null)}>
            <div className="absolute inset-0 bg-black/40" />
            <div
              className="ui-card relative w-full rounded-t-[16px] bg-surface-2 p-4 pb-[calc(var(--sab)+20px)] space-y-2 max-h-[70vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mx-auto h-1 w-9 rounded-full bg-foreground/20" aria-hidden />
              <p className="text-h2">{tr("От чьего имени эфир?")}</p>
              <p className="text-caption text-subtle">{tr("Свой эфир видят собеседники по личке, эфир канала — его подписчики.")}</p>
              <button type="button" disabled={busy} onClick={() => void startAir(airPick)}
                className="w-full min-h-12 px-3 rounded-md flex items-center gap-3 text-left bg-surface-4 active:opacity-70 disabled:opacity-50">
                <Radio className="w-5 h-5 text-primary shrink-0" />
                <span className="flex-1 text-body">{tr("От себя")}</span>
              </button>
              {airChannels.map((c) => (
                <button key={c.id} type="button" disabled={busy} onClick={() => void startAir(airPick, c.id)}
                  className="w-full min-h-12 px-3 rounded-md flex items-center gap-3 text-left bg-surface-4 active:opacity-70 disabled:opacity-50">
                  <Identicon id={c.id} avatarUrl={c.avatar_url} className="w-8 h-8 rounded-md shrink-0" />
                  <span className="flex-1 text-body truncate">{c.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {sendFor && (
          <div className="fixed inset-0 z-[75] flex items-end" onClick={() => setSendFor(null)}>
            <div className="absolute inset-0 bg-black/40" />
            <div
              className="ui-card relative w-full rounded-t-[16px] bg-surface-2 p-4 pb-[calc(var(--sab)+20px)] space-y-2 max-h-[70vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mx-auto h-1 w-9 rounded-full bg-foreground/20" aria-hidden />
              <p className="text-h2">{tr("Отправить в чат")}</p>
              <p className="text-caption text-subtle truncate">{sendFor.title}</p>
              {chats === null ? (
                <p className="text-small text-subtle">{tr("Загрузка…")}</p>
              ) : chats.length === 0 ? (
                <p className="text-small text-subtle">{tr("Пока некуда отправлять — нет чатов.")}</p>
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
    <div className="h-screen flex flex-col bg-background nav-rail-pad">
      <div className="shrink-0 px-4 py-3 pad-safe-top bg-background border-b border-border min-h-14 flex items-center gap-2">
        <span className="text-h1 flex-1">{tr("Музыка")}</span>
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center"
          aria-label={tr("Новый плейлист")}
        >
          <Plus className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3" style={{ paddingBottom: "calc(16px + var(--mint-nav-space, 0px))" }}>
        {creating && (
          <div className="ui-card rounded-lg bg-surface-2 border border-border p-3 flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void create(); }}
              placeholder={tr("Название плейлиста")}
              autoFocus
              className="flex-1 h-10 px-3 rounded-md bg-surface-4 outline-none text-body min-w-0"
            />
            <button type="button" onClick={() => void create()} className="h-10 px-4 rounded-md bg-primary text-primary-foreground text-small font-medium">{tr("Создать")}</button>
          </div>
        )}

        {/* Эфиры — сверху: это то, что идёт прямо сейчас. Свой — тоже здесь. */}
        {!!stations?.length && (
          <>
            <p className="px-1 text-small font-semibold text-subtle">{tr("В эфире")}</p>
            <SettingsCard>
              {stations.map((st) => {
                const src = st.channel ? { id: st.channel.id, avatar: st.channel.avatar_url, name: st.channel.name }
                                       : { id: st.owner.id, avatar: st.owner.avatar_url, name: st.mine ? tr("Ваш эфир") : st.owner.username };
                const listening = radio.stationId === st.id;
                return (
                  <SettingsRow
                    key={st.id}
                    leading={
                      <span className="relative shrink-0">
                        <Identicon id={src.id} avatarUrl={src.avatar} className="w-9 h-9 rounded-md" />
                        <span className={cn("absolute -right-1 -bottom-1 w-4 h-4 rounded-full ring-2 ring-background flex items-center justify-center",
                          st.paused ? "bg-surface-4" : "bg-destructive")}>
                          <Radio className="w-2.5 h-2.5 text-white" />
                        </span>
                      </span>
                    }
                    label={stationName(st)}
                    hint={`${src.name}${st.now_title ? ` · ${st.paused ? tr("пауза") : "▶"} ${st.now_title}` : ""}`}
                    value={<span className={cn("inline-flex items-center gap-1", listening && "text-primary")}><Headphones className="w-3.5 h-3.5" />{st.listeners}</span>}
                    onClick={() => setOpenStation(st)}
                  />
                );
              })}
            </SettingsCard>
          </>
        )}

        {lists === null ? (
          <p className="text-small text-subtle">{tr("Загрузка…")}</p>
        ) : (
          <SettingsCard>
            {lists.map((pl) => (
              <SettingsRow
                key={pl.id}
                icon={pl.is_default ? Music2 : ListMusic}
                label={playlistName(pl)}
                hint={[pl.is_public ? tr("Видят собеседники") : null, playsHint(pl.plays, pl.likes)].filter(Boolean).join(" · ") || undefined}
                value={pluralTracks(pl.tracks_count || 0)}
                onClick={() => void openList(pl)}
              />
            ))}
          </SettingsCard>
        )}

        <p className="px-1 text-caption text-subtle">
          {tr("Музыка берётся из переписки: удерживайте аудиофайл в чате и выберите «В плейлист».")}
        </p>

        <p className="px-1 pt-3 text-small font-semibold text-subtle">{tr("Плейлисты собеседников")}</p>
        {shared === null ? (
          <p className="px-1 text-small text-subtle">{tr("Загрузка…")}</p>
        ) : shared.length === 0 ? (
          <p className="px-1 text-caption text-subtle">
            {tr("Пока никто из собеседников не открыл свои плейлисты. Свой можно открыть значком глобуса в плейлисте.")}
          </p>
        ) : (
          <SettingsCard>
            {shared.map((pl) => (
              <SettingsRow
                key={pl.id}
                leading={<Identicon id={pl.owner.id} avatarUrl={pl.owner.avatar_url} className="w-9 h-9 rounded-md shrink-0" />}
                label={pl.is_default ? tr(pl.name) : pl.name}
                hint={[pl.owner.username, playsHint(pl.plays, pl.likes)].filter(Boolean).join(" · ")}
                value={pluralTracks(pl.tracks_count || 0)}
                onClick={() => setOpenShared(pl)}
              />
            ))}
          </SettingsCard>
        )}
      </div>
      <PlayerPanel onLive={openLive} />
      <BottomNav />
    </div>
  );
};


/** «12 прослушиваний · ♥ 3» в строке списка — только то, что есть. */
const playsHint = (plays?: number, likes?: number) =>
  [plays ? tn(plays, "{n} прослушивание", "{n} прослушивания", "{n} прослушиваний") : null, likes ? `♥ ${likes}` : null]
    .filter(Boolean).join(" · ") || null;

/** Выбор папки браузером — где он это умеет (компьютер и веб); на телефоне — плагином (nativeTrackUploads). */
const canPickFolder = typeof HTMLInputElement !== "undefined" && "webkitdirectory" in HTMLInputElement.prototype && !Capacitor.isNativePlatform();

/** Полоса загрузки: сколько из скольких, текущий трек с процентами, ошибки. */
const UploadQueueBar = () => {
  const { items, preparing } = useTrackUploads();
  // Выбор сделан, плагин копирует файлы (папка может быть большой).
  if (!items.length && preparing) {
    return (
      <div className="rounded-md bg-surface-2 border border-border px-3 py-2.5 flex items-center gap-2 text-small">
        <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" /> {tr("Готовлю файлы…")}
      </div>
    );
  }
  if (!items.length) return null;
  const done = items.filter((x) => x.status === "done").length;
  const failed = items.filter((x) => x.status === "error");
  const active = items.find((x) => x.status === "uploading") || items.find((x) => x.status === "queued");
  const total = items.length;
  const finished = !active;
  return (
    <div className="rounded-md bg-surface-2 border border-border px-3 py-2.5 space-y-1.5">
      <div className="flex items-center gap-2 text-small">
        {finished ? <Check className="w-4 h-4 text-primary shrink-0" /> : <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />}
        <span className="flex-1 min-w-0 truncate">
          {finished ? tr("Загружено {n} из {all}", { n: done, all: total }) : tr("Загружаю {i} из {n}", { i: Math.min(done + failed.length + 1, total), n: total })}
          {active && <span className="text-subtle"> · {active.name}{active.status === "uploading" ? ` · ${active.progress}%` : ""}</span>}
        </span>
        {finished && <button type="button" onClick={clearFinished} className="text-caption text-subtle underline underline-offset-2 shrink-0">{tr("Готово")}</button>}
      </div>
      <div className="h-1 rounded-full bg-black/15 overflow-hidden">
        <div className="h-full bg-primary transition-[width] duration-200" style={{ width: `${Math.round(((done + (active?.status === "uploading" ? active.progress / 100 : 0)) / total) * 100)}%` }} />
      </div>
      {failed.length > 0 && (
        <div className="flex items-center gap-2 text-caption">
          <span className="flex-1 min-w-0 truncate text-destructive">{tr("Не загрузилось: {n}", { n: failed.length })} — {failed[0].name}: {failed[0].error}</span>
          <button type="button" onClick={retryFailed} className="underline underline-offset-2 shrink-0">{tr("Повторить")}</button>
        </div>
      )}
    </div>
  );
};

export default Music;
