import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import { api, mediaUrl, type NotificationSoundInfo } from "@/api/client";
import { useMediaUrl } from "@/hooks/use-media-url";
import { cn } from "@/lib/utils";
import { type ReactionSummary } from "@/lib/reactions";
import { ReactionBar, ReactionPicker, applyReaction, sendReaction } from "@/components/chat/Reactions";
import ImageViewer, { type ViewerItem } from "@/components/ImageViewer";
import { toast } from "sonner";
import { X, Send, Radio, Users, Eye, MessageCircle, Music2, Check, Settings, Trash2, ChevronLeft, UserPlus, Paperclip, Image as ImageIcon, Video, FileText, SwitchCamera, Triangle, Bookmark, Download, Share2, ChevronRight, Bell, BellOff, Pencil } from "lucide-react";
import { playSfx } from "@/lib/sfx";
import { shareChannel, sharePost, channelLink } from "@/lib/share";
import ShareToChat from "@/components/ShareToChat";
import { Linkify, packLinkKind, profileLinkName, channelLinkRef } from "@/lib/linkify";
import PackLinkCard from "./PackLinkCard";
import ChannelLinkCard from "./ChannelLinkCard";
import PhotoEditor from "@/components/PhotoEditor";
import { saveFileToDevice } from "@/lib/saveFile";
import ProfileLinkCard from "./ProfileLinkCard";
import { playQueue, type Track } from "@/lib/player";
import SoundPickerSheet from "@/components/SoundPicker";
import { compressImage } from "@/lib/compressImage";
import { readPosts, writePosts } from "@/lib/messageCache";
import { useMediaRecorder } from "@/hooks/use-media-recorder";
import { LivePreview, MessageFile, MessageAudioFile, MessageVideoFile, VideoNote, MediaSkeleton, AlbumGrid, isImageFile, isAudioFile, isVideoFile, dimsOf } from "@/components/chat/media";

interface Channel {
  id: string; name: string; username?: string | null; description?: string;
  avatar_url?: string | null; subscribers_count?: number; sign_posts?: boolean;
  my_role?: "owner" | "admin" | "subscriber" | null; creator?: string | null;
  /** Зеркало Telegram-канала: @канал там и состояние подключения. */
  tg_username?: string | null; tg_state?: "" | "pending" | "active" | "error";
  /** Звук уведомлений канала: с ним подписчики слышат новые посты. */
  notify_sound?: NotificationSoundInfo | null;
  /** Я выключил уведомления этого канала. */
  muted?: boolean;
  admins?: { id: string; username: string; role: string; is_bot?: boolean }[];
}

interface Post {
  id: string; content?: string; created_at: string; file_url?: string; file_name?: string | null; poster_url?: string | null;
  file_width?: number | null; file_height?: number | null; album_id?: string | null;
  video_url?: string; video_duration?: number | null; video_mirror?: boolean;
  download_only?: boolean; sender?: { id: string; username: string };
  reactions?: ReactionSummary[]; reactions_total?: number;
  comments_count?: number; views_count?: number;
  sound?: { name: string } | null;
  /** Клиентские поля: пост показан до ответа сервера, _progress — загрузка вложения (100 — ждём сервер).
   *  _failed + _retry — не ушло: пост остаётся с «Повторить»/«Удалить», снятое не теряется. */
  _pending?: boolean; _progress?: number | null; _failed?: boolean; _retry?: () => void;
  /** Ключ рендера временной карточки: переживает замену на настоящий пост,
   *  чтобы React не пересоздавал карточку (см. addPending.confirm). */
  _key?: string;
}


const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

/** Медиа поста — теми же компонентами, что и в переписке: video_url — это
 *  видео-«треугольник», file_url — картинка, видеофайл или файл строкой
 *  (download_only — всегда строкой, даже если это картинка). */
const PostImage = ({ raw, dims, onOpen }: { raw: string; dims?: { w: number; h: number } | null; onOpen?: (url: string) => void }) => {
  const url = useMediaUrl(raw);
  const [loaded, setLoaded] = useState(false);
  // Бокс по соотношению сторон с сервера (не выше 320px) — пост не растёт
  // скачком, когда картинка докачалась; внутри до этого плывёт скелетон.
  const style = dims ? { aspectRatio: `${dims.w} / ${dims.h}`, maxHeight: 320 } : { height: 160 };
  return (
    <div className="mt-2 relative w-full rounded-md overflow-hidden bg-black/20" style={style}>
      {!loaded && <MediaSkeleton className="absolute inset-0" />}
      {url && (
        <img src={url} alt="" loading="lazy" onLoad={() => setLoaded(true)} onClick={() => onOpen?.(url)}
          className={cn("w-full h-full object-contain cursor-zoom-in transition-opacity duration-200", loaded ? "opacity-100" : "opacity-0")} />
      )}
    </div>
  );
};

const PostMedia = ({ post, album, onOpenImage, onPlayAudio }: { post: Post; album?: Post[]; onOpenImage?: (url: string, post: Post) => void; onPlayAudio?: (p: Post) => void }) => {
  // Альбом одной публикации: картинки и видео — сеткой, музыка и файлы —
  // строками под ней, всё в одном посте.
  if (album && album.length > 1) {
    const media = album.filter((p) => !p.download_only && (isImageFile(p.file_name, p.file_url) || isVideoFile(p.file_name, p.file_url)) && !isAudioFile(p.file_name, p.file_url));
    const audio = album.filter((p) => isAudioFile(p.file_name, p.file_url));
    const rest = album.filter((p) => !media.includes(p) && !audio.includes(p));
    return (
      <div className="mt-2 space-y-1.5">
        {media.length > 0 && (
        <AlbumGrid
          items={media.map((p) => ({
            id: p.id,
            raw: p.file_url || "",
            name: p.file_name ?? null,
            dims: dimsOf(p.file_width, p.file_height),
            poster: p.poster_url ?? null,
            pending: p._pending,
            progress: p._progress ?? null,
            failed: p._failed,
          }))}
          onOpen={(url, name, id) => {
            const target = album.find((p) => p.id === id) || post;
            onOpenImage?.(url, target);
          }}
        />
        )}
        {audio.map((p) => (
          <MessageAudioFile key={p.id} raw={p.file_url as string} name={p.file_name || null}
            isOwn={false} onSave={(url, name) => void saveFileToDevice(url, name)} onPlay={() => onPlayAudio?.(p)} />
        ))}
        {rest.map((p) => (
          <MessageFile key={p.id} raw={p.file_url as string} name={p.file_name || null}
            isOwn={false} onSave={(url, name) => void saveFileToDevice(url, name)} />
        ))}
      </div>
    );
  }
  if (post.video_url) {
    return (
      <div className="mt-2">
        <VideoNote url={post.video_url} seconds={post.video_duration || 0} own={false} mirror={post.video_mirror} />
      </div>
    );
  }
  if (!post.file_url) return null;
  if (!post.download_only && isImageFile(post.file_name, post.file_url)) return <PostImage raw={post.file_url} dims={dimsOf(post.file_width, post.file_height)} onOpen={(url) => onOpenImage?.(url, post)} />;
  if (isAudioFile(post.file_name, post.file_url)) {
    return <div className="mt-2"><MessageAudioFile raw={post.file_url} name={post.file_name || null} isOwn={false} onSave={(url, name) => void saveFileToDevice(url, name)} onPlay={() => onPlayAudio?.(post)} /></div>;
  }
  if (!post.download_only && isVideoFile(post.file_name, post.file_url)) {
    return <div className="mt-2"><MessageVideoFile raw={post.file_url} dims={dimsOf(post.file_width, post.file_height)} poster={post.poster_url} /></div>;
  }
  return (
    <div className="mt-2">
      <MessageFile raw={post.file_url} name={post.file_name || null} isOwn={false} onSave={(url, name) => void saveFileToDevice(url, name)} />
    </div>
  );
};

interface ChannelViewProps {
  channelId: string;
  userId: string;
  onBack?: () => void;
  onDeleted?: () => void;
}

/** «1 подписчик», «2 подписчика», «5 подписчиков». */
const pluralSubs = (n: number) => {
  const m10 = n % 10, m100 = n % 100;
  const w = m10 === 1 && m100 !== 11 ? "подписчик" : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? "подписчика" : "подписчиков";
  return `${n} ${w}`;
};

const ChannelView = ({ channelId, userId, onBack, onDeleted }: ChannelViewProps) => {
  // Просмотр картинок канала: список всех картинок ленты и позиция в нём.
  const [viewer, setViewer] = useState<{ items: ViewerItem[]; index: number } | null>(null);
  const openViewer = (postId: string) => {
    const items: ViewerItem[] = posts
      .filter((p) => p.file_url && !p.download_only && isImageFile(p.file_name, p.file_url))
      .map((p) => ({ raw: p.file_url as string, name: p.file_name || "image", messageId: p.id }));
    const index = Math.max(0, items.findIndex((x) => x.messageId === postId));
    if (items.length) setViewer({ items, index });
  };
  const [channel, setChannel] = useState<Channel | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  // Удаление поста — как сообщений в чате: пост сразу исчезает, пять секунд
  // висит «Отменить», и только потом уходит запрос. Пока висит — пост лишь
  // спрятан (hiddenIds), чтобы отмена вернула его на место без перезагрузки.
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());
  const [undoBar, setUndoBar] = useState<Post | null>(null);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitDelete = (id: string) => {
    api.removeMessage(id, "all").catch(() => toast.error("Не удалось удалить пост"));
    setPosts((prev) => prev.filter((p) => p.id !== id));
    setHiddenIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
  };
  const startDelete = (post: Post) => {
    if (deleteTimerRef.current) { clearTimeout(deleteTimerRef.current); deleteTimerRef.current = null; }
    if (undoBar) commitDelete(undoBar.id);
    setHiddenIds((prev) => new Set(prev).add(post.id));
    setUndoBar(post);
    deleteTimerRef.current = setTimeout(() => {
      commitDelete(post.id);
      setUndoBar(null);
      deleteTimerRef.current = null;
    }, 5000);
  };
  const undoDelete = () => {
    if (deleteTimerRef.current) { clearTimeout(deleteTimerRef.current); deleteTimerRef.current = null; }
    if (undoBar) setHiddenIds((prev) => { const n = new Set(prev); n.delete(undoBar.id); return n; });
    setUndoBar(null);
  };
  // Ушли из канала с висящей «Отменить» — удаление доводим до конца.
  useEffect(() => () => {
    if (deleteTimerRef.current && undoBar) { clearTimeout(deleteTimerRef.current); api.removeMessage(undoBar.id, "all").catch(() => {}); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [soundOpen, setSoundOpen] = useState(false);
  const [sound, setSound] = useState<NotificationSoundInfo | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [commentsFor, setCommentsFor] = useState<Post | null>(null);
  const [reactPickFor, setReactPickFor] = useState<string | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  // «Поделиться постом»: шторка с чатами (пересылка — весь альбом одним
  // пузырём, как в переписке) и большая кнопка наружу — ссылкой на пост.
  const [shareFor, setShareFor] = useState<Post | null>(null);
  const forwardPost = async (post: Post, chatId: string, title: string) => {
    const list = post.album_id ? posts.filter((p) => p.album_id === post.album_id) : [post];
    const ids = list.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)).map((p) => p.id);
    try {
      if (ids.length === 1) await api.forwardMessage(ids[0], chatId);
      else await api.forwardMany(ids, chatId);
      toast.success(title === "Избранное" ? "Добавлено в избранное" : `Отправлено: ${title}`);
    } catch (e: any) {
      toast.error(e?.message || "Не удалось переслать");
    }
  };
  const sharePostOutside = async (post: Post) => {
    if (!channel) return;
    const r = await sharePost(channel, post.id, post.content);
    if (r === "copied") toast.success("Ссылка скопирована");
    else if (r === "error") toast.error("Не удалось поделиться");
  };
  // Пришли по ссылке на пост (PublicChannel положил id в sessionStorage):
  // после загрузки ленты прокручиваем к нему и подсвечиваем.
  const openPostRef = useRef<string | null>(null);
  useEffect(() => {
    try {
      const id = sessionStorage.getItem("hyax:openPost");
      if (id) { openPostRef.current = id; sessionStorage.removeItem("hyax:openPost"); }
    } catch { /* приватный режим */ }
  }, [channelId]);
  useEffect(() => {
    const id = openPostRef.current;
    if (!id || !posts.some((p) => p.id === id)) return;
    openPostRef.current = null;
    setTimeout(() => {
      const el = feedRef.current?.querySelector<HTMLElement>(`[data-post-id="${id}"]`);
      if (!el) return;
      el.scrollIntoView({ block: "center" });
      el.classList.add("msg-flash");
      setTimeout(() => el.classList.remove("msg-flash"), 1200);
    }, 120);
  }, [posts]);

  // Вложение к посту: фото (сжимаем на месте), видео (пережмёт сервер) или
  // файл (как есть, строкой со скачиванием).
  const [attachOpen, setAttachOpen] = useState(false);
  // Обёртка кнопки-скрепки и её меню: тапы внутри неё меню не закрывают.
  const attachRef = useRef<HTMLDivElement>(null);
  // Вложения поста: несколько фото/видео уходят альбомом, музыка играет
  // плеером, лишнее убирается крестиком до публикации.
  type AttachMode = "photo" | "video" | "audio" | "file";
  interface Attach { id: string; file: File; mode: AttachMode; url: string }
  const [attachments, setAttachments] = useState<Attach[]>([]);
  // Редактор фото (рисовалка, кадр, поворот) для вложения поста.
  const [editFor, setEditFor] = useState<Attach | null>(null);
  const applyEdit = (target: Attach, edited: File) => {
    const url = URL.createObjectURL(edited);
    setAttachments((prev) => prev.map((x) => x.id === target.id ? { ...x, file: edited, url } : x));
    URL.revokeObjectURL(target.url);
    setEditFor(null);
  };
  const dropAttachment = (id: string) => setAttachments((prev) => {
    const gone = prev.find((a) => a.id === id);
    if (gone?.url) URL.revokeObjectURL(gone.url);
    return prev.filter((a) => a.id !== id);
  });
  // Пост с вложением встаёт в ленту сразу, из локального blob, с прогрессом
  // загрузки внутри — раньше до ответа сервера ничего не появлялось.
  const addPending = (post: Omit<Post, "id" | "created_at">) => {
    const id = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setPosts((prev) => [...prev, { ...post, id, created_at: new Date().toISOString(), _pending: true }]);
    setTimeout(() => feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" }), 60);
    return {
      id,
      progress: (p: number | null) => setPosts((prev) => prev.map((x) => (x.id === id ? { ...x, _progress: p } : x))),
      drop: () => setPosts((prev) => prev.filter((x) => x.id !== id)),
      /** Сервер принял пост: временная карточка превращается в настоящий пост
       *  на том же месте. Раньше её никто не убирал — после перехода ленты на
       *  приращения (sync по since) она оставалась висеть с «публикация…»
       *  рядом с пришедшим постом, пока не перезайдёшь в канал. Если sync или
       *  сокет успели принести пост раньше — просто убираем карточку. */
      confirm: (real?: Post | null) => setPosts((prev) => {
        if (!real?.id || prev.some((x) => x.id === real.id)) return prev.filter((x) => x.id !== id);
        return prev.map((x) => (x.id === id ? { ...real, _key: id } : x));
      }),
      fail: (retry: () => void) => setPosts((prev) => prev.map((x) => (x.id === id ? { ...x, _failed: true, _progress: null, _retry: retry } : x))),
      restart: () => setPosts((prev) => prev.map((x) => (x.id === id ? { ...x, _failed: false, _progress: 0 } : x))),
    };
  };

  /** Загрузка + публикация видео-«треугольника»; при ошибке пост остаётся с повтором. */
  const publishNote = async (temp: ReturnType<typeof addPending>, file: File, seconds: number, mirror: boolean) => {
    try {
      temp.restart();
      const uploaded = await api.uploadFile(file, undefined, (p) => temp.progress(p));
      temp.progress(100);
      temp.confirm(await api.sendMessageWithVideo(channelId, uploaded.file_url, seconds, mirror));
      await sync();
      setTimeout(() => feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" }), 60);
    } catch {
      toast.error("Не удалось опубликовать видео — нажми «Повторить»");
      temp.fail(() => void publishNote(temp, file, seconds, mirror));
    }
  };
  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  // Видео-«треугольник»: тап — начать запись, тап — закончить и опубликовать.
  const { recording, seconds: recSeconds, stream: recStream, start: startRec, stop: stopRec } = useMediaRecorder();
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [recBusy, setRecBusy] = useState(false);

  const pick = async (e: React.ChangeEvent<HTMLInputElement>, mode: AttachMode) => {
    const list = Array.from(e.target.files || []);
    e.target.value = "";
    await acceptFiles(list, mode);
  };
  const acceptFiles = async (list: File[], mode?: AttachMode) => {
    for (const f of list) await acceptFile(f, mode);
  };
  /** Файл из меню, перетаскивания или буфера; режим — из MIME, если не задан. Лимита нет. */
  const acceptFile = async (file: File, mode?: AttachMode) => {
    mode = mode ?? (file.type.startsWith("image/") ? "photo"
      : file.type.startsWith("video/") ? "video"
      : file.type.startsWith("audio/") ? "audio" : "file");
    const prepared = mode === "photo" ? await compressImage(file) : file;
    setAttachments((prev) => [...prev, { id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, file: prepared, mode, url: URL.createObjectURL(prepared) }]);
  };
  // Десктоп: перетащить файл в окно канала или вставить из буфера — только админу.
  const [dragOver, setDragOver] = useState(false);
  const dragDepthRef = useRef(0);
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer?.types || []).includes("Files");
  const onDragEnter = (e: React.DragEvent) => { if (!isAdmin || !hasFiles(e)) return; e.preventDefault(); dragDepthRef.current++; setDragOver(true); };
  const onDragOver = (e: React.DragEvent) => { if (!isAdmin || !hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; };
  const onDragLeave = (e: React.DragEvent) => { if (!hasFiles(e)) return; dragDepthRef.current = Math.max(0, dragDepthRef.current - 1); if (!dragDepthRef.current) setDragOver(false); };
  const onDrop = (e: React.DragEvent) => {
    if (!isAdmin || !hasFiles(e)) return;
    e.preventDefault(); dragDepthRef.current = 0; setDragOver(false);
    void acceptFiles(Array.from(e.dataTransfer.files || []));
  };
  const onPasteFile = (e: React.ClipboardEvent) => {
    const list = Array.from(e.clipboardData?.files || []);
    if (!list.length) return;
    e.preventDefault();
    void acceptFiles(list);
  };

  const toggleNote = async () => {
    if (recBusy) return;
    if (!recording) {
      setRecBusy(true);
      const ok = await startRec("video", facing);
      setRecBusy(false);
      if (!ok) toast.error("Нет доступа к камере");
      return;
    }
    setRecBusy(true);
    let temp: ReturnType<typeof addPending> | null = null;
    try {
      const result = await stopRec(false);
      if (!result) return;
      setSending(true);
      const mirror = facing === "user";
      temp = addPending({ video_url: URL.createObjectURL(result.file), video_duration: result.seconds, video_mirror: mirror, _progress: 0 });
      await publishNote(temp, result.file, result.seconds, mirror);
    } catch {
      temp?.drop();
      toast.error("Не удалось записать видео");
    } finally {
      setSending(false);
      setRecBusy(false);
    }
  };

  const cancelNote = async () => {
    if (!recording) return;
    await stopRec(true);
  };

  const isAdmin = channel?.my_role === "owner" || channel?.my_role === "admin";
  const subscribed = !!channel?.my_role;

  // Лента канала живёт по тем же правилам, что и переписка (см. messageCache):
  // при входе рисуем из IndexedDB, сеть догоняет приращением по since, старые
  // страницы подтягиваются при прокрутке вверх. Раньше каждый вход (и каждый
  // тик поллинга) тянул последние 50 постов целиком.
  const syncedAtRef = useRef<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const hasMoreRef = useRef(false);
  hasMoreRef.current = hasMore;
  const loadingOlderRef = useRef(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const scrollAdjustRef = useRef<{ height: number; top: number } | null>(null);
  const viewedRef = useRef<Set<string>>(new Set());

  /** Просмотр отмечаем один раз на пост за сессию (дедуп есть и на сервере). */
  const markViews = (list: Post[]) => {
    list.forEach((p) => {
      if (p._pending || viewedRef.current.has(p.id)) return;
      viewedRef.current.add(p.id);
      api.markPostView(p.id);
    });
  };

  /** Слияние с тем, что уже на экране: правки применяем, удалённые убираем,
   *  неподтверждённые (публикующиеся) посты не трогаем. */
  const applyPosts = (incoming: Post[], deleted: string[] = [], mode: "merge" | "prepend" = "merge") => {
    setPosts((prev) => {
      const gone = new Set(deleted);
      const byId = new Map(prev.filter((p) => !gone.has(p.id)).map((p) => [p.id, p]));
      for (const d of incoming) {
        const local = byId.get(d.id);
        byId.set(d.id, local ? { ...local, ...d, _pending: false } : d);
      }
      const merged = [...byId.values()].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
      if (mode === "merge" && JSON.stringify(merged) === JSON.stringify(prev)) return prev;
      return merged;
    });
    markViews(incoming);
  };

  /** Приращение с сервера; initial — первая страница, когда кэша нет. */
  const sync = useCallback(async (initial = false) => {
    try {
      const since = syncedAtRef.current;
      const r = await api.getChannelPosts(channelId, since && !initial ? { since } : { limit: 50 });
      syncedAtRef.current = r.now;
      if (!since || initial) { setHasMore(r.has_more); hasMoreRef.current = r.has_more; }
      if (r.posts.length || r.deleted.length) applyPosts(r.posts, r.deleted);
      setPosts((prev) => { void writePosts(channelId, prev, r.now, hasMoreRef.current); return prev; });
    } catch {
      /* сеть подождёт: на экране то, что уже есть */
    }
  }, [channelId]);

  /** Страница старее первого загруженного — при прокрутке к верху ленты. */
  const loadOlder = async () => {
    if (loadingOlderRef.current || !hasMoreRef.current) return;
    const first = posts.find((p) => !p._pending);
    if (!first) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const r = await api.getChannelPosts(channelId, { before: first.created_at, limit: 50 });
      const el = feedRef.current;
      if (el) scrollAdjustRef.current = { height: el.scrollHeight, top: el.scrollTop };
      setHasMore(r.has_more);
      hasMoreRef.current = r.has_more;
      if (r.posts.length) applyPosts(r.posts, [], "prepend");
    } catch {
      /* ignore */
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  };

  /** Очередь плеера — аудио-посты канала по порядку. */
  const playAudioFrom = (p: Post) => {
    const audios = posts.filter((x) => x.file_url && isAudioFile(x.file_name, x.file_url));
    const queue: Track[] = audios.map((x) => ({
      id: x.id,
      raw: x.file_url as string,
      title: (x.file_name || "Аудио").replace(/\.[^.]+$/, ""),
      artist: x.sender?.username,
    }));
    void playQueue(queue, Math.max(0, audios.findIndex((x) => x.id === p.id)));
  };

  const onFeedScroll = () => {
    const el = feedRef.current;
    if (el && el.scrollTop < 160 && hasMoreRef.current && !loadingOlderRef.current) void loadOlder();
  };

  // Подгрузили страницу сверху — удерживаем на месте то, что было на экране.
  useLayoutEffect(() => {
    const a = scrollAdjustRef.current;
    const el = feedRef.current;
    if (!a || !el) return;
    scrollAdjustRef.current = null;
    el.scrollTop = a.top + (el.scrollHeight - a.height);
  }, [posts]);

  /** Вход в канал: встаём чуть выше низа и плавно доезжаем — как в чате. */
  const scrollFeedOnOpen = () => {
    setTimeout(() => {
      const el = feedRef.current;
      if (!el) return;
      const start = el.scrollHeight - el.clientHeight * 2.2;
      if (start < 240) { el.scrollTo({ top: el.scrollHeight }); return; }
      el.scrollTop = start;
      requestAnimationFrame(() => el.scrollTo({ top: el.scrollHeight, behavior: "smooth" }));
    }, 60);
  };

  // Меню вложений закрывается тапом вне него. Тап по самому пункту меню
  // игнорируем: на телефоне pointerdown приходит раньше click, и если закрыть
  // меню уже на pointerdown, React уберёт кнопку до click — выбор файла так и
  // не откроется (ровно так и было на iOS).
  useEffect(() => {
    if (!attachOpen) return;
    const onDown = (e: PointerEvent) => {
      if (attachRef.current && attachRef.current.contains(e.target as Node)) return;
      setAttachOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [attachOpen]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setPosts([]);
    setHasMore(false);
    syncedAtRef.current = null;
    viewedRef.current = new Set();
    (async () => {
      const cached = await readPosts(channelId);
      if (!alive) return;
      const fromCache = !!cached?.messages?.length;
      if (fromCache) {
        syncedAtRef.current = cached!.syncedAt;
        setHasMore(cached!.hasMore);
        hasMoreRef.current = cached!.hasMore;
        setPosts(cached!.messages as Post[]);
        setLoading(false);
        scrollFeedOnOpen();
      }
      try {
        const ch = await api.getChannel(channelId);
        if (alive) setChannel(ch);
      } catch {
        /* канал мог быть удалён */
      }
      await sync(!fromCache);
      if (!alive) return;
      setLoading(false);
      if (!fromCache) scrollFeedOnOpen();
    })();
    // Лёгкий поллинг: с since он почти ничего не стоит.
    const t = setInterval(() => { void sync(); }, 9000);
    return () => { alive = false; clearInterval(t); };
  }, [channelId, sync]);

  // Звук пуша для поста выбираем той же шторкой, что «мой звук» и звук
  // канала: там поиск и паки, а каталог уже под сотню звуков.
  const openSounds = () => setSoundOpen((v) => !v);

  const publish = async () => {
    const body = text.trim();
    // Пост может быть и одним звуком — без текста и вложений.
    if ((!body && !attachments.length && !sound) || sending) return;
    setSending(true);
    const list = attachments;
    setAttachments([]);
    setText("");
    const snd = sound;
    setSound(null);
    try {
      if (!list.length) {
        await api.sendMessage(channelId, body, snd?.id);
      } else {
        // Выбранное разом — один пост с общим album_id (фото, видео и музыка
        // вместе); больше ALBUM_MAX за раз не кладём, остальное уходит
        // следующим постом.
        const ALBUM_MAX = 10;
        const chunks: Attach[][] = [];
        for (let i = 0; i < list.length; i += ALBUM_MAX) chunks.push(list.slice(i, i + ALBUM_MAX));
        for (let ci = 0; ci < chunks.length; ci++) {
        const chunk = chunks[ci];
        const album = chunk.length > 1 ? (crypto.randomUUID?.() || `alb-${Date.now()}-${ci}`) : null;
        for (let k = 0; k < chunk.length; k++) {
          const att = chunk[k];
          const i = ci * ALBUM_MAX + k;
          const temp = addPending({
            content: i === 0 ? body || undefined : undefined,
            file_url: att.url,
            file_name: att.file.name,
            download_only: att.mode === "file",
            album_id: album,
            sound: i === 0 && snd ? { name: snd.name } : null,
            _progress: 0,
          });
          try {
            const uploaded = await api.uploadFile(att.file, att.mode === "video" ? "video" : undefined, (p) => temp.progress(p));
            temp.progress(100);
            temp.confirm(await api.sendMessageWithFile(
              channelId,
              { file_url: uploaded.file_url, file_name: uploaded.file_name, file_size: uploaded.file_size, width: uploaded.width, height: uploaded.height, poster_url: uploaded.poster_url ?? null, album_id: album },
              i === 0 ? body || undefined : undefined,
              i === 0 ? snd?.id : undefined,
              undefined,
              att.mode === "file",
            ));
          } catch {
            toast.error(`Не удалось опубликовать «${att.file.name}»`);
            temp.drop();
          }
        }
        }
      }
      await sync();
      setTimeout(() => feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" }), 60);
    } catch {
      toast.error("Не удалось опубликовать");
    } finally {
      setSending(false);
    }
  };

  /** Реакция на пост — тем же модулем и тем же запросом, что в переписке:
   *  пост канала это тоже сообщение (см. components/chat/Reactions.tsx). */
  const react = (post: Post, emoji: string) => {
    setReactPickFor(null);
    const before = posts.find((p) => p.id === post.id)?.reactions;
    const set = (rows: ReactionSummary[] | undefined) =>
      setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, reactions: rows } : p)));
    set(applyReaction(before, emoji));
    void sendReaction(post.id, emoji, set, () => set(before));
  };

  const subscribe = async () => {
    try {
      const ch = await api.subscribeChannel(channelId);
      setChannel((c) => (c ? { ...c, ...ch } : ch));
    } catch {
      toast.error("Не удалось подписаться");
    }
  };

  const leave = async () => {
    try {
      await api.leaveChannel(channelId);
      setChannel((c) => (c ? { ...c, my_role: null, subscribers_count: Math.max(0, (c.subscribers_count || 1) - 1) } : c));
      setInfoOpen(false);
    } catch {
      toast.error("Ошибка");
    }
  };

  const removeChannel = async () => {
    if (!confirm(`Удалить канал «${channel?.name}»? Это необратимо.`)) return;
    try {
      await api.deleteChannel(channelId);
      onDeleted?.();
      onBack?.();
    } catch {
      toast.error("Не удалось удалить");
    }
  };

  const avatarUrl = channel?.avatar_url ? mediaUrl(channel.avatar_url) : null;

  // Соседние посты одного альбома рисуем одной сеткой на первом из них.
  const albumsById = new Map<string, Post[]>();
  for (const p of posts) {
    if (!p.album_id) continue;
    const list = albumsById.get(p.album_id) || [];
    list.push(p);
    albumsById.set(p.album_id, list);
  }
  const albumTail = new Set<string>();
  albumsById.forEach((list) => list.slice(1).forEach((p) => albumTail.add(p.id)));
  const feedPosts = posts.filter((p) => !albumTail.has(p.id) && !hiddenIds.has(p.id));

  return (
    <div className="flex-1 flex flex-col h-full bg-background min-w-0 relative" onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      {dragOver && (
        <div className="absolute inset-2 z-40 rounded-xl border-2 border-dashed border-primary bg-background/80 flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <Paperclip className="w-8 h-8 mx-auto text-primary" />
            <p className="mt-2 text-body font-semibold">Отпусти — прикреплю к посту</p>
          </div>
        </div>
      )}
      {/* Шапка */}
      <div className="flex items-center gap-3 px-3 pad-safe-top py-2 border-b border-border shrink-0">
        {onBack && (
          <button type="button" onClick={onBack} className="p-2 -ml-2" aria-label="Назад">
            <ChevronLeft className="w-6 h-6" />
          </button>
        )}
        <button type="button" onClick={() => setInfoOpen(true)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="w-10 h-10 shrink-0 rounded-md object-cover" />
          ) : (
            <span className="w-10 h-10 shrink-0 rounded-full bg-surface-3 flex items-center justify-center">
              <Radio className="w-5 h-5 text-primary" />
            </span>
          )}
          <span className="min-w-0">
            <span className="block text-h1 truncate">{channel?.name || "Канал"}</span>
            <span className="block text-small text-muted-foreground truncate">
              {pluralSubs(channel?.subscribers_count ?? 0)}{channel?.username ? ` · @${channel.username}` : ""}
            </span>
          </span>
        </button>
        {channel?.my_role === "owner" && (
          <button type="button" onClick={() => setInfoOpen(true)} className="p-1" aria-label="Настройки">
            <Settings className="w-5 h-5 text-muted-foreground" />
          </button>
        )}
      </div>

      {/* Лента */}
      <div ref={feedRef} onScroll={onFeedScroll} className="flex-1 overflow-y-auto px-3 py-3 space-y-3 md:px-6 [&>*]:md:max-w-[720px]">
        {hasMore && (
          <div className="flex justify-center">
            <button type="button" onClick={() => void loadOlder()} disabled={loadingOlder}
              className="text-xs text-muted-foreground px-3 py-1 bg-surface-2 rounded-full disabled:opacity-60">
              {loadingOlder ? "Загружаю…" : "Показать старые посты"}
            </button>
          </div>
        )}
        {loading ? (
          <p className="text-center text-sm text-muted-foreground py-10">Загрузка…</p>
        ) : posts.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-10">
            {channel?.tg_state === "pending" ? "Подключаем канал из Telegram — посты появятся в течение минуты"
              : channel?.tg_state === "error" ? "Не удалось подключить канал из Telegram"
              : isAdmin ? "Постов пока нет. Опубликуйте первый." : "В канале пока пусто"}
          </p>
        ) : (
          feedPosts.map((post) => (
            <div key={post._key ?? post.id} data-post-id={post.id} className="bg-surface-2 rounded-lg overflow-hidden">
              <div className="px-4 py-3">
                {channel?.sign_posts && post.sender && (
                  <p className="text-body font-semibold mb-1">{post.sender.username}</p>
                )}
                {post.content && <p className="text-body whitespace-pre-wrap break-words"><Linkify text={post.content} /></p>}
                {(() => {
                  // Пак или тема по ссылке в посте — плиткой с «Добавить себе»,
                  // профиль — карточкой с «Написать». Текст поста не трогаем.
                  const link = (post.content || "").match(/https?:\/\/\S+/g)?.find((u) => packLinkKind(u) || profileLinkName(u) || channelLinkRef(u));
                  if (!link) return null;
                  return profileLinkName(link) ? <ProfileLinkCard url={link} /> : channelLinkRef(link) ? <ChannelLinkCard url={link} /> : <PackLinkCard url={link} />;
                })()}
                <PostMedia post={post} album={post.album_id ? albumsById.get(post.album_id) : undefined}
                  onOpenImage={(_url, p) => openViewer(p.id)}
                  onPlayAudio={playAudioFrom} />
                {post._pending && post._failed && (
                  <div className="mt-2 flex items-center gap-3 text-caption">
                    <span className="text-destructive font-medium">Не опубликовано</span>
                    {post._retry && <button type="button" onClick={post._retry} className="underline text-foreground">Повторить</button>}
                    <button type="button" onClick={() => setPosts((prev) => prev.filter((x) => x.id !== post.id))} className="underline text-subtle">Удалить</button>
                  </div>
                )}
                {post._pending && !post._failed && post._progress != null && (
                  <div className="mt-2 flex items-center gap-2 text-caption text-subtle">
                    <div className="flex-1 h-1 rounded-full bg-black/20 overflow-hidden">
                      <div className="h-full bg-primary transition-[width] duration-150" style={{ width: `${Math.max(3, post._progress)}%` }} />
                    </div>
                    <span className="tabular-nums shrink-0">{post._progress < 100 ? `${post._progress}%` : "публикация…"}</span>
                  </div>
                )}
                <div className="flex items-center gap-4 mt-2 text-caption text-subtle">
                  <span>{post._pending ? "отправка" : fmtTime(post.created_at)}</span>
                  <span className="flex items-center gap-1"><Eye className="w-3.5 h-3.5" />{post.views_count ?? 0}</span>
                  {post.sound && <span className="flex items-center gap-1"><Music2 className="w-3.5 h-3.5" />{post.sound.name}</span>}
                </div>
              </div>
              {/* Реакции + комментарии */}
              <div className="flex items-center gap-2 px-3 py-2 border-t border-border flex-wrap">
                <ReactionBar
                  reactions={post.reactions}
                  onToggle={(emoji) => subscribed ? react(post, emoji) : toast.error("Подпишитесь, чтобы реагировать")}
                />
                <button
                  type="button"
                  onClick={() => subscribed ? setReactPickFor(post.id) : toast.error("Подпишитесь, чтобы реагировать")}
                  aria-label="Добавить реакцию"
                  className="h-8 px-2.5 text-small rounded-full bg-surface-4 text-muted-foreground inline-flex items-center"
                >
                  ＋
                </button>
                <button
                  type="button"
                  onClick={() => setCommentsFor(post)}
                  className="ml-auto h-8 rounded-full bg-surface-4 inline-flex items-center gap-1 px-2.5 text-small text-muted-foreground"
                >
                  <MessageCircle className="w-4 h-4" />
                  {post.comments_count ?? 0}
                </button>
                {!post._pending && (
                  <button
                    type="button"
                    onClick={() => setShareFor(post)}
                    aria-label="Поделиться постом"
                    className="h-8 w-8 rounded-full bg-surface-4 inline-flex items-center justify-center text-muted-foreground"
                  >
                    <Share2 className="w-4 h-4" />
                  </button>
                )}
                {isAdmin && !post._pending && (
                  <button
                    type="button"
                    onClick={() => startDelete(post)}
                    aria-label="Удалить пост"
                    className="h-8 w-8 rounded-full bg-surface-4 inline-flex items-center justify-center text-muted-foreground active:text-destructive"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Композер (админ) или кнопка подписки */}
      {isAdmin ? (
        <div className="pad-safe-bottom px-3 py-2 shrink-0">
          {undoBar && (
            <div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-foreground text-background px-3 py-2">
              <span className="text-sm">Пост удалён</span>
              <button type="button" onClick={undoDelete} className="text-sm font-semibold underline">Отменить</button>
            </div>
          )}
          {sound && (
            <div className="flex items-center gap-2 mb-2 text-xs text-muted-foreground">
              <Music2 className="w-3.5 h-3.5" /> Звук пуша: <b className="text-foreground">{sound.name}</b>
              <button type="button" onClick={() => setSound(null)} className="ml-1"><X className="w-3.5 h-3.5" /></button>
            </div>
          )}
          {attachments.length > 10 && (
            <p className="mb-1 text-caption text-subtle">Выбрано {attachments.length} — уйдут по 10 в посте</p>
          )}
          {attachments.length > 0 && (
            <div className="flex gap-2 mb-2 overflow-x-auto pb-1">
              {attachments.map((a) => (
                <div key={a.id} className="relative shrink-0 w-20 h-20 rounded-lg overflow-hidden bg-surface-2 border border-border">
                  {a.mode === "photo" ? (
                    <button type="button" onClick={() => setEditFor(a)} disabled={sending} className="w-full h-full" aria-label="Редактировать фото">
                      <img src={a.url} alt="" className="w-full h-full object-cover" />
                      <span className="absolute bottom-0.5 left-0.5 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center"><Pencil className="w-3 h-3" /></span>
                    </button>
                  ) : a.mode === "video" ? (
                    <video src={a.url} muted playsInline className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-1 px-1 text-center">
                      {a.mode === "audio" ? <Music2 className="w-5 h-5 text-primary" /> : <FileText className="w-5 h-5 text-primary" />}
                      <span className="text-[10px] leading-tight text-muted-foreground line-clamp-2 break-all">{a.file.name}</span>
                    </div>
                  )}
                  <button type="button" onClick={() => dropAttachment(a.id)} disabled={sending}
                    className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center" aria-label={`Убрать ${a.file.name}`}>
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {recording && (
            <div className="flex items-center gap-3 mb-2">
              <LivePreview stream={recStream} dimmed={false} facing={facing} />
              <div className="flex-1 text-sm">
                <p className="font-semibold text-primary">Запись · {String(Math.floor(recSeconds / 60)).padStart(2, "0")}:{String(recSeconds % 60).padStart(2, "0")}</p>
                <p className="text-muted-foreground text-xs">Тап по треугольнику — опубликовать</p>
              </div>
              <button type="button" onClick={cancelNote} className="p-2 text-muted-foreground" aria-label="Отменить"><X className="w-5 h-5" /></button>
            </div>
          )}
          <input ref={photoInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => pick(e, "photo")} />
          <input ref={videoInputRef} type="file" accept="video/*" multiple className="hidden" onChange={(e) => pick(e, "video")} />
          <input ref={audioInputRef} type="file" accept="audio/*,.mp3,.m4a,.aac,.ogg,.oga,.opus,.wav,.flac" multiple className="hidden" onChange={(e) => pick(e, "audio")} />
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => pick(e, "file")} />
          <div className="flex items-end gap-2">
            <div ref={attachRef} className="relative shrink-0">
              <button type="button" onClick={() => setAttachOpen((v) => !v)} disabled={sending || recording} className={cn("w-11 h-11 rounded-md bg-surface-2 border border-border flex items-center justify-center", attachments.length > 0 && "text-primary border-primary")} aria-label="Прикрепить">
                <Paperclip className="w-5 h-5" />
              </button>
              {attachOpen && (
                <div className="absolute bottom-full left-0 mb-2 w-44 bg-surface-1 border border-border rounded-lg overflow-hidden z-10">
                  <button type="button" className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left active:bg-secondary" onClick={() => { setAttachOpen(false); photoInputRef.current?.click(); }}>
                    <ImageIcon className="w-4 h-4 text-primary" /> Фото
                  </button>
                  <button type="button" className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left active:bg-secondary" onClick={() => { setAttachOpen(false); videoInputRef.current?.click(); }}>
                    <Video className="w-4 h-4 text-primary" /> Видео
                  </button>
                  <button type="button" className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left active:bg-secondary" onClick={() => { setAttachOpen(false); audioInputRef.current?.click(); }}>
                    <Music2 className="w-4 h-4 text-primary" /> Музыка
                  </button>
                  <button type="button" className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left active:bg-secondary" onClick={() => { setAttachOpen(false); fileInputRef.current?.click(); }}>
                    <FileText className="w-4 h-4 text-primary" /> Файл
                  </button>
                </div>
              )}
            </div>
            <button type="button" onClick={openSounds} disabled={recording} className={cn("w-11 h-11 shrink-0 rounded-md bg-surface-2 border border-border flex items-center justify-center", sound && "text-primary border-primary")} aria-label="Звук пуша">
              <Music2 className="w-5 h-5" />
            </button>
            <textarea
              value={text}
              onPaste={onPasteFile}
              onChange={(e) => setText(e.target.value)}
              placeholder={attachments.length ? "Подпись…" : "Написать в канал…"}
              rows={1}
              disabled={recording}
              className="flex-1 resize-none bg-surface-2 border border-border rounded-md px-3.5 py-[11px] text-body outline-none focus:border-amber max-h-32"
            />
            {text.trim() || attachments.length || sound ? (
              <button
                type="button"
                onClick={publish}
                disabled={sending}
                className="w-11 h-11 shrink-0 rounded-md flex items-center justify-center bg-primary text-primary-foreground disabled:opacity-40"
                aria-label="Опубликовать"
              >
                <Send className="w-5 h-5" />
              </button>
            ) : (
              <>
                {recording && (
                  <button type="button" onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))} className="w-11 h-11 shrink-0 rounded-md bg-surface-2 border border-border flex items-center justify-center" aria-label="Сменить камеру">
                    <SwitchCamera className="w-5 h-5" />
                  </button>
                )}
                {/* Видео-«треугольник»: тап — запись, тап — публикация. */}
                <button
                  type="button"
                  onClick={toggleNote}
                  disabled={sending || recBusy}
                  className={cn("w-11 h-11 shrink-0 rounded-md flex items-center justify-center", recording ? "bg-success text-white" : "bg-primary text-primary-foreground", "disabled:opacity-40")}
                  aria-label={recording ? "Опубликовать видео" : "Записать видео-сообщение"}
                >
                  {recording ? <Send className="w-5 h-5" /> : <Triangle className="w-5 h-5" />}
                </button>
              </>
            )}
          </div>
          {soundOpen && (
            <SoundPickerSheet
              title="Звук уведомления для поста"
              current={sound?.id ?? null}
              onClose={() => setSoundOpen(false)}
              onPick={(s) => { setSound(s); setSoundOpen(false); }}
            />
          )}
        </div>
      ) : channel && !subscribed ? (
        // Только когда канал уже загружен: пока роль неизвестна, «не подписан»
        // ещё не факт — кнопка мелькала на мгновение у подписчиков и админов.
        // Подписчику кнопка не нужна — она стояла и после подписки, потому что
        // ветка была просто «не админ». Отписка — в инфо-модалке канала.
        <div className="pad-safe-bottom px-3 py-3 shrink-0">
          <button type="button" onClick={subscribe} className="w-full h-11 rounded-md bg-primary text-primary-foreground font-semibold">
            Подписаться
          </button>
        </div>
      ) : (
        <div className="pad-safe-bottom shrink-0" />
      )}

      {infoOpen && channel && (
        <ChannelInfo
          channel={channel}
          userId={userId}
          onClose={() => setInfoOpen(false)}
          onLeave={leave}
          onDelete={removeChannel}
          onChanged={(c) => setChannel(c)}
        />
      )}
      {editFor && (
        <PhotoEditor file={editFor.file} onCancel={() => setEditFor(null)} onDone={(f) => applyEdit(editFor, f)} />
      )}
      {shareFor && (
        <ShareToChat
          open
          text=""
          title="Поделиться постом"
          onClose={() => setShareFor(null)}
          onPick={(chatId, title) => void forwardPost(shareFor, chatId, title)}
          onShareOutside={() => void sharePostOutside(shareFor)}
        />
      )}

      {viewer && (
        <ImageViewer
          items={viewer.items}
          index={viewer.index}
          onIndex={(i) => setViewer((v) => (v ? { ...v, index: i } : v))}
          onClose={() => setViewer(null)}
          actions={[
            { label: "Добавить в сохранёнки", icon: <Bookmark className="w-5 h-5 text-primary" />, onClick: async () => {
              const cur = viewer.items[viewer.index];
              if (!cur) return;
              try { const r = await api.addSavedImage(cur.messageId); toast.success(r.already ? "Уже в сохранёнках" : "Добавлено в сохранёнки", { description: "Сохранёнки лежат в профиле — кому они видны, настраивается в разделе «Конфиденциальность»" }); }
              catch (e: any) { toast.error(e?.message || "Не удалось сохранить"); }
            } },
            { label: "Скачать", icon: <Download className="w-5 h-5 text-subtle" />, onClick: async () => {
              const cur = viewer.items[viewer.index];
              if (!cur) return;
              const url = cur.raw.startsWith("s3://") ? await api.signMedia(cur.raw) : mediaUrl(cur.raw);
              window.open(url, "_blank");
            } },
          ]}
        />
      )}
      <ReactionPicker
        open={!!reactPickFor}
        onClose={() => setReactPickFor(null)}
        onPick={(emoji) => { const post = posts.find((p) => p.id === reactPickFor); if (post) react(post, emoji); }}
      />

      {commentsFor && (
        <CommentsSheet
          post={commentsFor}
          canComment={subscribed}
          onClose={() => setCommentsFor(null)}
          onCountChange={(n) => setPosts((prev) => prev.map((p) => (p.id === commentsFor.id ? { ...p, comments_count: n } : p)))}
        />
      )}
    </div>
  );
};

/** Звук в списке выбора — с проигрыванием. */
/** Комментарии к посту. */
const CommentsSheet = ({ post, canComment, onClose, onCountChange }: {
  post: Post; canComment: boolean; onClose: () => void; onCountChange: (n: number) => void;
}) => {
  const [comments, setComments] = useState<any[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try { setComments(await api.getPostComments(post.id)); } finally { setLoading(false); }
  }, [post.id]);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    const body = text.trim();
    if (!body) return;
    try {
      await api.addPostComment(post.id, body);
      setText("");
      const fresh = await api.getPostComments(post.id);
      setComments(fresh);
      onCountChange(fresh.length);
    } catch (e: any) {
      toast.error(e?.message || "Не удалось");
    }
  };
  const del = async (id: string) => {
    try {
      await api.deletePostComment(id);
      const fresh = comments.filter((c) => c.id !== id);
      setComments(fresh);
      onCountChange(fresh.length);
    } catch { toast.error("Ошибка"); }
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/60 flex flex-col justify-end" onClick={onClose}>
      <div className="bg-card border-t-2 border-border max-h-[75%] flex flex-col pad-safe-bottom" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
          <MessageCircle className="w-5 h-5 text-primary" />
          <span className="font-semibold flex-1">Комментарии</span>
          <button type="button" onClick={onClose}><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {loading ? (
            <p className="text-sm text-muted-foreground text-center py-6">Загрузка…</p>
          ) : comments.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Пока нет комментариев</p>
          ) : (
            comments.map((c) => (
              <div key={c.id} className="flex gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm"><b>{c.author?.username}</b> <span className="text-xs text-muted-foreground">{fmtTime(c.created_at)}</span></p>
                  <p className="text-sm break-words whitespace-pre-wrap"><Linkify text={c.content} /></p>
                </div>
                <button type="button" onClick={() => del(c.id)} className="p-1 text-muted-foreground shrink-0" aria-label="Удалить">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))
          )}
        </div>
        {canComment ? (
          <div className="flex items-end gap-2 px-3 py-2 border-t border-border shrink-0">
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={1} placeholder="Комментарий…" className="flex-1 resize-none bg-secondary px-3 py-2.5 outline-none max-h-28" />
            <button type="button" onClick={add} disabled={!text.trim()} className="w-11 h-11 shrink-0 flex items-center justify-center bg-primary text-primary-foreground disabled:opacity-40">
              <Send className="w-5 h-5" />
            </button>
          </div>
        ) : (
          <p className="px-4 py-3 text-sm text-muted-foreground border-t border-border">Подпишитесь, чтобы комментировать</p>
        )}
      </div>
    </div>
  );
};

/** Инфо/управление каналом. */
const ChannelInfo = ({ channel, userId, onClose, onLeave, onDelete, onChanged }: {
  channel: Channel; userId: string; onClose: () => void; onLeave: () => void; onDelete: () => void; onChanged: (c: Channel) => void;
}) => {
  // «Поделиться каналом» — шторка с чатами (ссылка уходит сообщением и
  // разворачивается карточкой канала) и кнопка наружу.
  const [shareOpen, setShareOpen] = useState(false);
  const [muteBusy, setMuteBusy] = useState(false);
  const toggleMute = async () => {
    const next = !channel.muted;
    setMuteBusy(true);
    onChanged({ ...channel, muted: next });
    try {
      await api.muteChannel(channel.id, next);
      toast.success(next ? "Уведомления выключены" : "Уведомления включены");
    } catch {
      toast.error("Не удалось сохранить");
      onChanged({ ...channel, muted: !next });
    } finally { setMuteBusy(false); }
  };
  const isOwner = channel.my_role === "owner";
  const isAdmin = isOwner || channel.my_role === "admin";
  const [name, setName] = useState(channel.name);
  const [description, setDescription] = useState(channel.description || "");
  const [signPosts, setSignPosts] = useState(!!channel.sign_posts);
  const [adminQuery, setAdminQuery] = useState("");
  const [adminResults, setAdminResults] = useState<any[]>([]);
  const [admins, setAdmins] = useState(channel.admins || []);
  const [soundOpen, setSoundOpen] = useState(false);
  // Аватар канала: картинку кладём обычной загрузкой, ссылку — в канал.
  const avatarInput = useRef<HTMLInputElement>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);

  const pickAvatar = async (file?: File | null) => {
    if (!file || avatarBusy) return;
    setAvatarBusy(true);
    try {
      // local=true — аватар должен лежать открыто, как у групп: вложения
      // сообщений уходят в закрытое хранилище (ссылка s3://…), и в списке
      // чатов такой аватар не открывался — вместо картинки была пустая рамка.
      const up = await api.uploadFile(file, undefined, undefined, true);
      const updated = await api.updateChannel(channel.id, { avatar_url: up.file_url });
      onChanged({ ...channel, ...updated });
      toast.success("Аватар обновлён");
    } catch (e: any) {
      toast.error(e?.message || "Не удалось загрузить аватар");
    } finally {
      setAvatarBusy(false);
    }
  };

  const dropAvatar = async () => {
    setAvatarBusy(true);
    try {
      const updated = await api.updateChannel(channel.id, { avatar_url: null });
      onChanged({ ...channel, ...updated, avatar_url: null });
      toast.success("Аватар убран");
    } catch (e: any) {
      toast.error(e?.message || "Не получилось");
    } finally {
      setAvatarBusy(false);
    }
  };

  useEffect(() => {
    if (isOwner) api.getChannelAdmins(channel.id).then(setAdmins).catch(() => {});
  }, [channel.id, isOwner]);

  const save = async () => {
    try {
      const updated = await api.updateChannel(channel.id, { name: name.trim(), description, sign_posts: signPosts });
      onChanged({ ...channel, ...updated });
      toast.success("Сохранено");
    } catch (e: any) {
      toast.error(e?.message || "Ошибка");
    }
  };

  const searchAdmin = async (q: string) => {
    setAdminQuery(q);
    if (!q.trim()) { setAdminResults([]); return; }
    try { setAdminResults(await api.searchUsers(q)); } catch { setAdminResults([]); }
  };
  const addAdmin = async (u: any) => {
    try {
      await api.setChannelAdmin(channel.id, u.id, "add");
      setAdmins(await api.getChannelAdmins(channel.id));
      setAdminQuery(""); setAdminResults([]);
      toast.success(`${u.username} — админ`);
    } catch { toast.error("Не удалось"); }
  };
  const removeAdmin = async (id: string) => {
    try {
      await api.setChannelAdmin(channel.id, id, "remove");
      setAdmins(await api.getChannelAdmins(channel.id));
    } catch { toast.error("Ошибка"); }
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/60 flex flex-col justify-end" onClick={onClose}>
      <div className="bg-card border-t-2 border-border max-h-[85%] overflow-y-auto pad-safe-bottom" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Radio className="w-5 h-5 text-primary" />
          <span className="font-semibold flex-1 truncate">{channel.name}</span>
          <button type="button" onClick={onClose}><X className="w-5 h-5" /></button>
        </div>
        <div className="px-4 py-4 space-y-4">
          {/* Аватар канала: админ меняет по тапу, остальные просто видят. */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => isAdmin && avatarInput.current?.click()}
              disabled={!isAdmin || avatarBusy}
              className="ui-card w-16 h-16 rounded-lg overflow-hidden shrink-0 bg-surface-3 flex items-center justify-center disabled:opacity-100"
              aria-label={isAdmin ? "Сменить аватар канала" : undefined}
            >
              {channel.avatar_url
                ? <img src={mediaUrl(channel.avatar_url)} alt="" className="w-full h-full object-cover" />
                : <Radio className="w-7 h-7 text-primary" />}
            </button>
            {isAdmin && (
              <div className="min-w-0 flex-1 space-y-1.5">
                <button type="button" onClick={() => avatarInput.current?.click()} disabled={avatarBusy}
                  className="h-9 px-3 rounded-md bg-surface-4 text-small font-medium inline-flex items-center gap-1.5 disabled:opacity-50">
                  <ImageIcon className="w-4 h-4" /> {avatarBusy ? "Загружаю…" : channel.avatar_url ? "Сменить аватар" : "Поставить аватар"}
                </button>
                {channel.avatar_url && (
                  <button type="button" onClick={dropAvatar} disabled={avatarBusy}
                    className="ml-2 h-9 px-3 rounded-md bg-surface-4 text-small font-medium text-destructive disabled:opacity-50">
                    Убрать
                  </button>
                )}
              </div>
            )}
          </div>
          <input ref={avatarInput} type="file" accept="image/*" hidden onChange={(e) => { pickAvatar(e.target.files?.[0]); e.target.value = ""; }} />

          {!isOwner && channel.description && (
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{channel.description}</p>
          )}
          <p className="text-sm text-muted-foreground">
            {channel.subscribers_count ?? 0} подписчиков{channel.username ? ` · @${channel.username}` : ""}
          </p>
          {/* Ссылка на канал — как «Поделиться профилем»: открывается в приложении. */}
          <button
            type="button"
            onClick={() => setShareOpen(true)}
            className="w-full py-2.5 border border-border font-semibold flex items-center justify-center gap-2"
          >
            <Share2 className="w-4 h-4" /> Поделиться каналом
          </button>
          {shareOpen && (
            <ShareToChat
              open
              text={channelLink(channel)}
              title="Поделиться каналом"
              onClose={() => setShareOpen(false)}
              onShareOutside={async () => {
                const r = await shareChannel(channel);
                if (r === "copied") toast.success("Ссылка скопирована");
                else if (r === "error") toast.error("Не удалось поделиться");
              }}
            />
          )}

          {/* Уведомления — своё у каждого подписчика: посты приходят, пуша и
              звука нет. Владелец их тоже может выключить (боты, зеркала). */}
          {channel.my_role && (
            <button type="button" onClick={toggleMute} disabled={muteBusy}
              className="w-full flex items-center gap-3 py-2.5 text-left disabled:opacity-50">
              {channel.muted ? <BellOff className="w-5 h-5 text-subtle shrink-0" /> : <Bell className="w-5 h-5 text-primary shrink-0" />}
              <span className="min-w-0 flex-1">
                <span className="block text-body">Уведомления</span>
                <span className="block text-caption text-subtle truncate">
                  {channel.muted ? "Выключены — посты приходят без звука и пуша" : "Включены"}
                </span>
              </span>
              <span className={cn("relative w-11 h-6 rounded-full shrink-0 transition-colors", channel.muted ? "bg-surface-4" : "bg-primary")}>
                <span className={cn("absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-[left]", channel.muted ? "left-0.5" : "left-[22px]")} />
              </span>
            </button>
          )}

          {/* Звук уведомлений канала — как «мой звук» в профиле, только его
              слышат подписчики при новом посте. Менять может админ. */}
          {isAdmin && (
            <button type="button" onClick={() => setSoundOpen(true)}
              className="w-full flex items-center gap-3 py-2.5 text-left">
              <Music2 className="w-5 h-5 text-primary shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-body">Звук уведомлений канала</span>
                <span className="block text-caption text-subtle truncate">
                  {channel.notify_sound ? channel.notify_sound.name : "Обычный — выбери свой, его услышат подписчики"}
                </span>
              </span>
              <ChevronRight className="w-4 h-4 text-subtle shrink-0" />
            </button>
          )}

          {isOwner ? (
            <>
              <div>
                <label className="text-xs text-muted-foreground">Название</label>
                <input value={name} onChange={(e) => setName(e.target.value)} className="w-full bg-secondary px-3 py-2 mt-1 outline-none" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Описание</label>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="w-full bg-secondary px-3 py-2 mt-1 outline-none resize-none" />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={signPosts} onChange={(e) => setSignPosts(e.target.checked)} />
                Показывать автора постов
              </label>
              <button type="button" onClick={save} className="w-full py-2.5 bg-primary text-primary-foreground font-semibold">Сохранить</button>

              <div className="pt-2 border-t border-border">
                <p className="text-sm font-semibold mb-2 flex items-center gap-2"><UserPlus className="w-4 h-4" />Админы</p>
                {admins.map((a: any) => (
                  <div key={a.id} className="flex items-center gap-2 py-1.5 text-sm">
                    <span className="flex-1 truncate">{a.is_bot ? "🤖 " : ""}{a.username}</span>
                    <span className="text-xs text-muted-foreground">{a.role}</span>
                    {a.role !== "owner" && (
                      <button type="button" onClick={() => removeAdmin(a.id)} className="text-muted-foreground"><X className="w-4 h-4" /></button>
                    )}
                  </div>
                ))}
                <input value={adminQuery} onChange={(e) => searchAdmin(e.target.value)} placeholder="Добавить админа (или бота) по имени…" className="w-full bg-secondary px-3 py-2 mt-2 outline-none text-sm" />
                {adminResults.map((u) => (
                  <button key={u.id} type="button" onClick={() => addAdmin(u)} className="w-full text-left px-3 py-2 text-sm hover:bg-secondary border-b border-border/60">
                    {u.is_bot ? "🤖 " : ""}{u.username}
                  </button>
                ))}
              </div>

              <button type="button" onClick={onDelete} className="w-full py-2.5 border border-destructive text-destructive font-semibold flex items-center justify-center gap-2">
                <Trash2 className="w-4 h-4" /> Удалить канал
              </button>
            </>
          ) : (
            <button type="button" onClick={onLeave} className="w-full py-2.5 border border-border font-semibold">
              Отписаться
            </button>
          )}
        </div>
      </div>
      {soundOpen && (
        <SoundPickerSheet
          title="Звук уведомлений канала"
          current={channel.notify_sound?.id || null}
          onClose={() => setSoundOpen(false)}
          onPick={async (s) => {
            setSoundOpen(false);
            const prev = channel.notify_sound || null;
            onChanged({ ...channel, notify_sound: s });
            try {
              await api.updateChannel(channel.id, { notify_sound_id: s ? s.id : null });
              toast.success(s ? `Подписчики услышат «${s.name}»` : "Обычный звук");
            } catch {
              toast.error("Не удалось сохранить");
              onChanged({ ...channel, notify_sound: prev });
            }
          }}
        />
      )}
    </div>
  );
};

export default ChannelView;
