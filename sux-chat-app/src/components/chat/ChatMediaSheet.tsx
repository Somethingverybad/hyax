import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, Play, Pause, Mic, FileText, Download, Music2, MessageSquare, X } from "lucide-react";
import { toast } from "sonner";
import { api, type MediaKind } from "@/api/client";
import { useMediaUrl } from "@/hooks/use-media-url";
import ImageViewer from "@/components/ImageViewer";
import { playQueue, usePlayer, currentTrack, toggle as togglePlay, type Track } from "@/lib/player";
import { saveFileToDevice } from "@/lib/saveFile";
import { cn } from "@/lib/utils";
import { t, getLang } from "@/lib/i18n";

/** Сообщение с вложением — только поля, нужные этому экрану. */
interface MediaMsg {
  id: string;
  created_at: string;
  file_url?: string | null;
  file_name?: string | null;
  file_size?: number | null;
  poster_url?: string | null;
  video_url?: string | null;
  video_duration?: number | null;
  video_mirror?: boolean;
  voice_url?: string | null;
  voice_duration?: number | null;
  sender?: { id: string; username: string } | null;
}

const TABS: { kind: MediaKind; label: string }[] = [
  { kind: "photo", label: "Фото" },
  { kind: "video", label: "Видео" },
  { kind: "music", label: "Музыка" },
  { kind: "voice", label: "Голосовые" },
  { kind: "file", label: "Файлы" },
];

const EMPTY: Record<MediaKind, string> = {
  photo: "Фото пока нет",
  video: "Видео пока нет",
  music: "Музыки пока нет",
  voice: "Голосовых пока нет",
  file: "Файлов пока нет",
};

const fmtDur = (s?: number | null) => (s || s === 0 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "");
const fmtSize = (b?: number | null) => {
  if (!b) return "";
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} ${t("КБ")}`;
  return `${(b / 1024 / 1024).toFixed(1)} ${t("МБ")}`;
};
const monthKey = (iso: string) => iso.slice(0, 7);
const monthTitle = (iso: string) => {
  // «октябрь 2026 г.» → «Октябрь 2026», как подпись раздела галереи.
  const s = new Date(iso).toLocaleDateString(getLang(), { month: "long", year: "numeric" }).replace(/\s*г\.$/, "");
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const dayTime = (iso: string) => new Date(iso).toLocaleString(getLang(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Разбить по месяцам — подписи «Октябрь 2026», как в галерее. */
function byMonth(items: MediaMsg[]): { key: string; title: string; items: MediaMsg[] }[] {
  const out: { key: string; title: string; items: MediaMsg[] }[] = [];
  for (const m of items) {
    const k = monthKey(m.created_at);
    const last = out[out.length - 1];
    if (last && last.key === k) last.items.push(m);
    else out.push({ key: k, title: monthTitle(m.created_at), items: [m] });
  }
  return out;
}

/**
 * «Медиа и файлы» переписки или группы: фото, видео, музыка, голосовые и
 * файлы — по разделам, новые сверху, с подгрузкой старых при прокрутке.
 * Фото открываются просмотрщиком, видео — плеером, музыка и голосовые —
 * общим плеером очередью, файлы сохраняются на устройство. «Показать в
 * чате» прокручивает переписку к сообщению.
 */
const ChatMediaSheet = ({ chatId, title, onClose, onJump }: {
  chatId: string;
  title?: string;
  onClose: () => void;
  onJump: (messageId: string) => void;
}) => {
  const [tab, setTab] = useState<MediaKind>("photo");
  const [counts, setCounts] = useState<Partial<Record<MediaKind, number>>>({});
  const [lists, setLists] = useState<Partial<Record<MediaKind, { items: MediaMsg[]; more: boolean }>>>({});
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);

  const load = useCallback(async (kind: MediaKind, older: boolean) => {
    if (loadingRef.current) return;
    const cur = lists[kind];
    if (older && (!cur || !cur.more)) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const before = older ? cur?.items[cur.items.length - 1]?.created_at : undefined;
      const r = await api.getChatMedia(chatId, kind, before);
      if (r.counts) setCounts(r.counts);
      setLists((prev) => ({
        ...prev,
        [kind]: { items: [...(older ? prev[kind]?.items || [] : []), ...(r.results as MediaMsg[])], more: r.has_more },
      }));
    } catch {
      toast.error(t("Не удалось загрузить"));
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [chatId, lists]);

  useEffect(() => {
    if (!lists[tab]) void load(tab, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, chatId]);

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 400) void load(tab, true);
  };

  const items = lists[tab]?.items || [];
  const groups = useMemo(() => byMonth(items), [items]);

  // Просмотр фото и видео.
  const [viewIndex, setViewIndex] = useState<number | null>(null);
  const [videoOpen, setVideoOpen] = useState<MediaMsg | null>(null);
  const photos = tab === "photo" ? items : [];

  // Музыка и голосовые — в общий плеер, очередью из загруженного списка.
  const play = (m: MediaMsg) => {
    const list = items;
    const queue: Track[] = list.map((x) => ({
      id: x.id,
      raw: (tab === "voice" ? x.voice_url : x.file_url) as string,
      title: tab === "voice" ? t("Голосовое") : (x.file_name || t("Аудио")).replace(/\.[^.]+$/, ""),
      artist: x.sender?.username,
    }));
    void playQueue(queue, Math.max(0, list.findIndex((x) => x.id === m.id)));
  };

  return createPortal(
    <div className="fixed inset-0 z-[75] bg-background flex flex-col" role="dialog" aria-label={t("Медиа и файлы")}>
      <div className="pad-safe-top shrink-0 border-b border-border">
        <div className="flex items-center gap-2 px-2 h-14">
          <button type="button" onClick={onClose} className="w-10 h-10 rounded-full flex items-center justify-center active:bg-surface-2" aria-label={t("Назад")}>
            <ChevronLeft className="w-6 h-6" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-body font-semibold truncate">{t("Медиа и файлы")}</div>
            {title && <div className="text-caption text-subtle truncate">{title}</div>}
          </div>
        </div>
        <div className="flex gap-1.5 px-3 pb-2 overflow-x-auto no-scrollbar" role="tablist">
          {TABS.map(({ kind, label }) => (
            <button
              key={kind}
              type="button"
              role="tab"
              aria-selected={tab === kind}
              onClick={() => setTab(kind)}
              className={cn("h-8 px-3 rounded-full text-small whitespace-nowrap shrink-0 border",
                tab === kind ? "bg-foreground text-background border-foreground" : "bg-surface-2 border-transparent text-foreground")}
            >
              {t(label)}{counts[kind] ? <span className="ml-1 opacity-60 tabular-nums">{counts[kind]}</span> : null}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto" onScroll={onScroll}>
        {!items.length && !loading && lists[tab] && (
          <p className="text-center text-small text-subtle py-16">{t(EMPTY[tab])}</p>
        )}
        {groups.map((g) => (
          <section key={g.key}>
            <div className="sticky top-0 z-10 px-4 py-1.5 text-caption font-semibold text-subtle bg-background/90 backdrop-blur">{g.title}</div>
            {tab === "photo" || tab === "video" ? (
              <div className="grid grid-cols-3 md:grid-cols-5 gap-0.5 px-0.5">
                {g.items.map((m) => (
                  <Thumb
                    key={m.id}
                    m={m}
                    video={tab === "video"}
                    onOpen={() => (tab === "photo" ? setViewIndex(photos.findIndex((x) => x.id === m.id)) : setVideoOpen(m))}
                  />
                ))}
              </div>
            ) : (
              <div className="divide-y divide-border">
                {g.items.map((m) => (
                  <Row key={m.id} m={m} kind={tab} onPlay={() => play(m)} onJump={() => onJump(m.id)} />
                ))}
              </div>
            )}
          </section>
        ))}
        {loading && <p className="text-center text-caption text-subtle py-6">{t("Загрузка…")}</p>}
        <div className="pad-safe-bottom" />
      </div>

      {viewIndex !== null && photos[viewIndex] && (
        <ImageViewer
          items={photos.map((p) => ({ raw: p.file_url as string, name: p.file_name || "photo.jpg", messageId: p.id }))}
          index={viewIndex}
          onIndex={setViewIndex}
          onClose={() => setViewIndex(null)}
          actions={[
            { label: t("Показать в чате"), icon: <MessageSquare className="w-5 h-5" />, onClick: () => { const id = photos[viewIndex].id; setViewIndex(null); onJump(id); } },
          ]}
        />
      )}
      {videoOpen && <VideoPlayer m={videoOpen} onClose={() => setVideoOpen(null)} onJump={() => { const id = videoOpen.id; setVideoOpen(null); onJump(id); }} />}
    </div>,
    document.body,
  );
};

/** Квадрат сетки: фото — сама картинка, видео — кадр-превью и длительность. */
const Thumb = ({ m, video, onOpen }: { m: MediaMsg; video: boolean; onOpen: () => void }) => {
  const raw = video ? (m.poster_url || null) : (m.file_url || null);
  const src = useMediaUrl(raw);
  const note = video && !!m.video_url;
  return (
    <button type="button" onClick={onOpen} className="relative aspect-square bg-surface-2 overflow-hidden active:opacity-80" aria-label={video ? t("Видео") : t("Фото")}>
      {src && <img src={src} alt="" loading="lazy" decoding="async" draggable={false} className={cn("absolute inset-0 w-full h-full object-cover", note && m.video_mirror && "-scale-x-100")} />}
      {video && (
        <span className="absolute left-1 bottom-1 flex items-center gap-0.5 rounded bg-black/55 text-white text-[11px] px-1 py-px">
          <Play className="w-3 h-3 fill-current" />{fmtDur(m.video_duration)}
        </span>
      )}
    </button>
  );
};

/** Строка музыки, голосового или файла. */
const Row = ({ m, kind, onPlay, onJump }: { m: MediaMsg; kind: MediaKind; onPlay: () => void; onJump: () => void }) => {
  const raw = (kind === "voice" ? m.voice_url : m.file_url) || null;
  const src = useMediaUrl(kind === "file" ? raw : null);
  const s = usePlayer();
  const cur = currentTrack();
  const mine = !!cur && cur.id === m.id;
  const playing = mine && s.playing;
  const name = kind === "voice" ? t("Голосовое") : (m.file_name || (kind === "music" ? t("Аудио") : t("Файл")));
  const sub = [m.sender?.username, dayTime(m.created_at), kind === "voice" ? fmtDur(m.voice_duration) : fmtSize(m.file_size)].filter(Boolean).join(" · ");
  const main = () => {
    if (kind === "file") { if (src) void saveFileToDevice(src, m.file_name || "file"); return; }
    if (mine) void togglePlay(); else onPlay();
  };
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <button type="button" onClick={main} className={cn("w-11 h-11 rounded-full shrink-0 flex items-center justify-center",
        kind === "file" ? "bg-surface-2 text-foreground" : "bg-primary text-primary-foreground")}
        aria-label={kind === "file" ? t("Сохранить файл") : playing ? t("Пауза") : t("Слушать")}>
        {kind === "file" ? <FileText className="w-5 h-5" />
          : playing ? <Pause className="w-5 h-5 fill-current" />
          : kind === "voice" ? <Mic className="w-5 h-5" />
          : <Music2 className="w-5 h-5" />}
      </button>
      <button type="button" onClick={main} className="min-w-0 flex-1 text-left">
        <span className={cn("block text-body truncate", mine && "text-primary")}>{name}</span>
        <span className="block text-caption text-subtle truncate">{sub}</span>
      </button>
      {kind === "file" && (
        <button type="button" onClick={main} className="w-9 h-9 rounded-full flex items-center justify-center text-subtle active:bg-surface-2" aria-label={t("Сохранить файл")}>
          <Download className="w-5 h-5" />
        </button>
      )}
      <button type="button" onClick={onJump} className="w-9 h-9 rounded-full flex items-center justify-center text-subtle active:bg-surface-2" aria-label={t("Показать в чате")} title={t("Показать в чате")}>
        <MessageSquare className="w-5 h-5" />
      </button>
    </div>
  );
};

/** Видео на весь экран: файл или видео-сообщение (зеркально, как снимали). */
const VideoPlayer = ({ m, onClose, onJump }: { m: MediaMsg; onClose: () => void; onJump: () => void }) => {
  const src = useMediaUrl((m.video_url || m.file_url) || null);
  const poster = useMediaUrl(m.poster_url || null);
  return (
    <div className="fixed inset-0 z-[90] bg-black flex flex-col" role="dialog" aria-label={t("Видео")}>
      <div className="pad-safe-top shrink-0 flex items-center justify-between px-2 h-14">
        <button type="button" onClick={onClose} className="w-10 h-10 rounded-full bg-black/55 text-white flex items-center justify-center" aria-label={t("Закрыть")}>
          <X className="w-5 h-5" />
        </button>
        <button type="button" onClick={onJump} className="h-9 px-3 rounded-full bg-black/55 text-white text-small flex items-center gap-1.5">
          <MessageSquare className="w-4 h-4" />{t("Показать в чате")}
        </button>
      </div>
      <div className="flex-1 min-h-0 flex items-center justify-center pad-safe-bottom">
        {src && (
          <video src={src} poster={poster || undefined} controls autoPlay playsInline
            className={cn("max-w-full max-h-full", m.video_url && m.video_mirror && "-scale-x-100")} />
        )}
      </div>
    </div>
  );
};

export default ChatMediaSheet;

