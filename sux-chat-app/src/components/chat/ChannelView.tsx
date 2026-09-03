import { useEffect, useRef, useState, useCallback } from "react";
import { api, mediaUrl, type NotificationSoundInfo } from "@/api/client";
import { useMediaUrl } from "@/hooks/use-media-url";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  X, Send, Radio, Users, Eye, MessageCircle, Music2, Check, Settings,
  Trash2, Play, Square, ChevronLeft, UserPlus, Paperclip, Image as ImageIcon,
  Video, FileText, SwitchCamera, Triangle,
} from "lucide-react";
import { playSfx } from "@/lib/sfx";
import { compressImage } from "@/lib/compressImage";
import { useMediaRecorder } from "@/hooks/use-media-recorder";
import { LivePreview, MessageFile, MessageVideoFile, VideoNote, isImageFile, isVideoFile } from "@/components/chat/media";

interface Channel {
  id: string; name: string; username?: string | null; description?: string;
  avatar_url?: string | null; subscribers_count?: number; sign_posts?: boolean;
  my_role?: "owner" | "admin" | "subscriber" | null; creator?: string | null;
  admins?: { id: string; username: string; role: string; is_bot?: boolean }[];
}

interface Post {
  id: string; content?: string; created_at: string; file_url?: string; file_name?: string | null;
  video_url?: string; video_duration?: number | null; video_mirror?: boolean;
  download_only?: boolean; sender?: { id: string; username: string };
  reactions?: { value: string; count: number }[]; reactions_total?: number;
  my_reaction?: string | null; comments_count?: number; views_count?: number;
  sound?: { name: string } | null;
}

const REACTIONS = ["🔥", "❤️", "👍", "😂", "😮", "😢"];

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

/** Медиа поста — теми же компонентами, что и в переписке: video_url — это
 *  видео-«треугольник», file_url — картинка, видеофайл или файл строкой
 *  (download_only — всегда строкой, даже если это картинка). */
const PostImage = ({ raw }: { raw: string }) => {
  const url = useMediaUrl(raw);
  if (!url) return <div className="mt-2 h-40 bg-black/20 animate-pulse" />;
  return <img src={url} alt="" className="mt-2 max-h-80 w-full object-contain bg-black/20" loading="lazy" />;
};

const PostMedia = ({ post }: { post: Post }) => {
  if (post.video_url) {
    return (
      <div className="mt-2">
        <VideoNote url={post.video_url} seconds={post.video_duration || 0} own={false} mirror={post.video_mirror} />
      </div>
    );
  }
  if (!post.file_url) return null;
  if (!post.download_only && isImageFile(post.file_name, post.file_url)) return <PostImage raw={post.file_url} />;
  if (!post.download_only && isVideoFile(post.file_name, post.file_url)) {
    return <div className="mt-2"><MessageVideoFile raw={post.file_url} /></div>;
  }
  return (
    <div className="mt-2">
      <MessageFile raw={post.file_url} name={post.file_name || null} isOwn={false} onSave={(url) => window.open(url, "_blank")} />
    </div>
  );
};

interface ChannelViewProps {
  channelId: string;
  userId: string;
  onBack?: () => void;
  onDeleted?: () => void;
}

const ChannelView = ({ channelId, userId, onBack, onDeleted }: ChannelViewProps) => {
  const [channel, setChannel] = useState<Channel | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [soundOpen, setSoundOpen] = useState(false);
  const [sounds, setSounds] = useState<NotificationSoundInfo[]>([]);
  const [sound, setSound] = useState<NotificationSoundInfo | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [commentsFor, setCommentsFor] = useState<Post | null>(null);
  const [reactPickFor, setReactPickFor] = useState<string | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);

  // Вложение к посту: фото (сжимаем на месте), видео (пережмёт сервер) или
  // файл (как есть, строкой со скачиванием).
  const [attachOpen, setAttachOpen] = useState(false);
  // Обёртка кнопки-скрепки и её меню: тапы внутри неё меню не закрывают.
  const attachRef = useRef<HTMLDivElement>(null);
  const [attachment, setAttachment] = useState<{ file: File; mode: "photo" | "video" | "file" } | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Видео-«треугольник»: тап — начать запись, тап — закончить и опубликовать.
  const { recording, seconds: recSeconds, stream: recStream, start: startRec, stop: stopRec } = useMediaRecorder();
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [recBusy, setRecBusy] = useState(false);

  const pick = async (e: React.ChangeEvent<HTMLInputElement>, mode: "photo" | "video" | "file") => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const limit = mode === "photo" ? 25 : 50;
    if (file.size > limit * 1024 * 1024) { toast.error(`Файл слишком большой (макс. ${limit}MB)`); return; }
    setAttachment({ file: mode === "photo" ? await compressImage(file) : file, mode });
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
    try {
      const result = await stopRec(false);
      if (!result) return;
      setSending(true);
      const uploaded = await api.uploadFile(result.file);
      await api.sendMessageWithVideo(channelId, uploaded.file_url, result.seconds, facing === "user");
      await load();
      setTimeout(() => feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" }), 60);
    } catch {
      toast.error("Не удалось опубликовать видео");
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

  const load = useCallback(async () => {
    try {
      const [ch, ps] = await Promise.all([api.getChannel(channelId), api.getChannelPosts(channelId)]);
      setChannel(ch);
      setPosts(ps);
      // Отмечаем просмотры загруженных постов (дедуп на сервере).
      ps.forEach((p: Post) => api.markPostView(p.id));
    } catch {
      /* канал мог быть удалён */
    } finally {
      setLoading(false);
    }
  }, [channelId]);

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
    setLoading(true);
    load();
    // Лёгкий поллинг новых постов.
    const t = setInterval(load, 9000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    // Прокрутка к последнему посту при первой загрузке.
    if (!loading) setTimeout(() => feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight }), 50);
  }, [loading]);

  const openSounds = async () => {
    if (!sounds.length) {
      try { setSounds(await api.getNotificationSounds()); } catch { /* ignore */ }
    }
    setSoundOpen((v) => !v);
  };

  const publish = async () => {
    const body = text.trim();
    if ((!body && !attachment) || sending) return;
    setSending(true);
    try {
      if (attachment) {
        const uploaded = await api.uploadFile(
          attachment.file,
          attachment.mode === "video" ? "video" : undefined,
          (p) => setProgress(p),
        );
        await api.sendMessageWithFile(
          channelId,
          { file_url: uploaded.file_url, file_name: uploaded.file_name, file_size: uploaded.file_size },
          body || undefined,
          sound?.id,
          undefined,
          attachment.mode === "file",
        );
        setProgress(null);
        setAttachment(null);
      } else {
        await api.sendMessage(channelId, body, sound?.id);
      }
      setText("");
      setSound(null);
      await load();
      setTimeout(() => feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" }), 60);
    } catch {
      toast.error("Не удалось опубликовать");
      setProgress(null);
    } finally {
      setSending(false);
    }
  };

  const react = async (post: Post, value: string) => {
    setReactPickFor(null);
    try {
      const summary = post.my_reaction === value
        ? await api.unreactPost(post.id)
        : await api.reactToPost(post.id, value);
      setPosts((prev) => prev.map((p) => (p.id === post.id
        ? { ...p, reactions: summary.reactions, reactions_total: summary.reactions_total, my_reaction: summary.my_reaction }
        : p)));
    } catch {
      toast.error("Не получилось");
    }
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

  return (
    <div className="flex-1 flex flex-col h-full bg-background min-w-0">
      {/* Шапка */}
      <div className="flex items-center gap-3 px-3 pad-safe-top py-2 border-b border-border shrink-0">
        {onBack && (
          <button type="button" onClick={onBack} className="p-1 -ml-1" aria-label="Назад">
            <X className="w-6 h-6" />
          </button>
        )}
        <button type="button" onClick={() => setInfoOpen(true)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="w-10 h-10 shrink-0 object-cover" />
          ) : (
            <span className="w-10 h-10 shrink-0 bg-secondary flex items-center justify-center">
              <Radio className="w-5 h-5 text-primary" />
            </span>
          )}
          <span className="min-w-0">
            <span className="block font-semibold truncate">{channel?.name || "Канал"}</span>
            <span className="block text-xs text-muted-foreground truncate">
              {(channel?.subscribers_count ?? 0)} подписчиков{channel?.username ? ` · @${channel.username}` : ""}
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
      <div ref={feedRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {loading ? (
          <p className="text-center text-sm text-muted-foreground py-10">Загрузка…</p>
        ) : posts.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-10">
            {isAdmin ? "Постов пока нет. Опубликуйте первый." : "В канале пока пусто"}
          </p>
        ) : (
          posts.map((post) => (
            <div key={post.id} className="bg-secondary/40 border border-border">
              <div className="px-4 py-3">
                {channel?.sign_posts && post.sender && (
                  <p className="text-xs text-primary font-medium mb-1">{post.sender.username}</p>
                )}
                {post.content && <p className="whitespace-pre-wrap break-words">{post.content}</p>}
                <PostMedia post={post} />
                <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                  <span>{fmtTime(post.created_at)}</span>
                  <span className="flex items-center gap-1"><Eye className="w-3.5 h-3.5" />{post.views_count ?? 0}</span>
                  {post.sound && <span className="flex items-center gap-1"><Music2 className="w-3.5 h-3.5" />{post.sound.name}</span>}
                </div>
              </div>
              {/* Реакции + комментарии */}
              <div className="flex items-center gap-2 px-3 py-2 border-t border-border/60 flex-wrap">
                {(post.reactions || []).map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => subscribed ? react(post, r.value) : toast.error("Подпишитесь, чтобы реагировать")}
                    className={cn(
                      "px-2 py-1 text-sm border",
                      post.my_reaction === r.value ? "border-primary bg-primary/10" : "border-border bg-secondary/60",
                    )}
                  >
                    {r.value} {r.count}
                  </button>
                ))}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => subscribed ? setReactPickFor(reactPickFor === post.id ? null : post.id) : toast.error("Подпишитесь, чтобы реагировать")}
                    className="px-2 py-1 text-sm border border-border bg-secondary/60 text-muted-foreground"
                  >
                    ＋
                  </button>
                  {reactPickFor === post.id && (
                    <div className="absolute z-20 bottom-full mb-1 left-0 flex gap-1 bg-card border-2 border-border p-1">
                      {REACTIONS.map((e) => (
                        <button key={e} type="button" onClick={() => react(post, e)} className="w-9 h-9 text-lg hover:bg-secondary">
                          {e}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setCommentsFor(post)}
                  className="ml-auto flex items-center gap-1 px-2 py-1 text-sm text-muted-foreground"
                >
                  <MessageCircle className="w-4 h-4" />
                  {post.comments_count ?? 0}
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Композер (админ) или кнопка подписки */}
      {isAdmin ? (
        <div className="border-t border-border pad-safe-bottom px-3 py-2 shrink-0">
          {sound && (
            <div className="flex items-center gap-2 mb-2 text-xs text-muted-foreground">
              <Music2 className="w-3.5 h-3.5" /> Звук пуша: <b className="text-foreground">{sound.name}</b>
              <button type="button" onClick={() => setSound(null)} className="ml-1"><X className="w-3.5 h-3.5" /></button>
            </div>
          )}
          {attachment && (
            <div className="flex items-center gap-2 mb-2 text-xs text-muted-foreground">
              {attachment.mode === "photo" ? <ImageIcon className="w-3.5 h-3.5" /> : attachment.mode === "video" ? <Video className="w-3.5 h-3.5" /> : <FileText className="w-3.5 h-3.5" />}
              <span className="truncate flex-1 text-foreground">{attachment.file.name}</span>
              {progress !== null && <span>{progress}%</span>}
              <button type="button" onClick={() => setAttachment(null)} disabled={sending}><X className="w-3.5 h-3.5" /></button>
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
          <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e, "photo")} />
          <input ref={videoInputRef} type="file" accept="video/*" className="hidden" onChange={(e) => pick(e, "video")} />
          <input ref={fileInputRef} type="file" className="hidden" onChange={(e) => pick(e, "file")} />
          <div className="flex items-end gap-2">
            <div ref={attachRef} className="relative shrink-0">
              <button type="button" onClick={() => setAttachOpen((v) => !v)} disabled={sending || recording} className={cn("w-10 h-10 flex items-center justify-center border border-border", attachment && "text-primary border-primary")} aria-label="Прикрепить">
                <Paperclip className="w-5 h-5" />
              </button>
              {attachOpen && (
                <div className="absolute bottom-full left-0 mb-2 w-40 bg-card border border-border z-10">
                  <button type="button" className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left active:bg-secondary" onClick={() => { setAttachOpen(false); photoInputRef.current?.click(); }}>
                    <ImageIcon className="w-4 h-4 text-primary" /> Фото
                  </button>
                  <button type="button" className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left active:bg-secondary" onClick={() => { setAttachOpen(false); videoInputRef.current?.click(); }}>
                    <Video className="w-4 h-4 text-primary" /> Видео
                  </button>
                  <button type="button" className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left active:bg-secondary" onClick={() => { setAttachOpen(false); fileInputRef.current?.click(); }}>
                    <FileText className="w-4 h-4 text-primary" /> Файл
                  </button>
                </div>
              )}
            </div>
            <button type="button" onClick={openSounds} disabled={recording} className={cn("w-10 h-10 shrink-0 flex items-center justify-center border border-border", sound && "text-primary border-primary")} aria-label="Звук пуша">
              <Music2 className="w-5 h-5" />
            </button>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={attachment ? "Подпись…" : "Написать в канал…"}
              rows={1}
              disabled={recording}
              className="flex-1 resize-none bg-secondary px-3 py-2.5 outline-none max-h-32"
            />
            {text.trim() || attachment ? (
              <button
                type="button"
                onClick={publish}
                disabled={sending}
                className="w-11 h-11 shrink-0 flex items-center justify-center bg-primary text-primary-foreground disabled:opacity-40"
                aria-label="Опубликовать"
              >
                <Send className="w-5 h-5" />
              </button>
            ) : (
              <>
                {recording && (
                  <button type="button" onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))} className="w-10 h-10 shrink-0 flex items-center justify-center border border-border" aria-label="Сменить камеру">
                    <SwitchCamera className="w-5 h-5" />
                  </button>
                )}
                {/* Видео-«треугольник»: тап — запись, тап — публикация. */}
                <button
                  type="button"
                  onClick={toggleNote}
                  disabled={sending || recBusy}
                  className={cn("w-11 h-11 shrink-0 flex items-center justify-center", recording ? "bg-success text-success-foreground" : "bg-primary text-primary-foreground", "disabled:opacity-40")}
                  aria-label={recording ? "Опубликовать видео" : "Записать видео-сообщение"}
                >
                  {recording ? <Send className="w-5 h-5" /> : <Triangle className="w-5 h-5" />}
                </button>
              </>
            )}
          </div>
          {soundOpen && (
            <div className="mt-2 max-h-48 overflow-y-auto border border-border bg-card">
              <button type="button" onClick={() => { setSound(null); setSoundOpen(false); }} className="w-full text-left px-3 py-2 text-sm hover:bg-secondary border-b border-border/60">
                Без звука
              </button>
              {sounds.map((s) => (
                <SoundRow key={s.id} sound={s} selected={sound?.id === s.id} onPick={() => { setSound(s); setSoundOpen(false); }} />
              ))}
              {sounds.length === 0 && <p className="px-3 py-3 text-sm text-muted-foreground">Звуков нет</p>}
            </div>
          )}
        </div>
      ) : (
        <div className="border-t border-border pad-safe-bottom px-3 py-3 shrink-0">
          <button type="button" onClick={subscribe} className="w-full py-3 bg-primary text-primary-foreground font-semibold">
            Подписаться
          </button>
        </div>
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
const SoundRow = ({ sound, selected, onPick }: { sound: NotificationSoundInfo; selected: boolean; onPick: () => void }) => {
  const stopRef = useRef<(() => void) | null>(null);
  const [playing, setPlaying] = useState(false);
  const toggle = () => {
    stopRef.current?.();
    if (playing) { setPlaying(false); return; }
    setPlaying(true);
    playSfx(mediaUrl(sound.url), { volume: 0.7, onEnded: () => setPlaying(false) })
      .then((stop) => { stopRef.current = stop; })
      .catch(() => setPlaying(false));
  };
  useEffect(() => () => stopRef.current?.(), []);
  return (
    <div className={cn("flex items-center gap-2 px-3 py-2 border-b border-border/60", selected && "bg-primary/10")}>
      <button type="button" onClick={toggle} className="w-8 h-8 shrink-0 flex items-center justify-center bg-secondary">
        {playing ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
      </button>
      <button type="button" onClick={onPick} className="flex-1 text-left text-sm truncate">{sound.name}</button>
      {selected && <Check className="w-4 h-4 text-primary shrink-0" />}
    </div>
  );
};

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
                  <p className="text-sm break-words whitespace-pre-wrap">{c.content}</p>
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
  const isOwner = channel.my_role === "owner";
  const [name, setName] = useState(channel.name);
  const [description, setDescription] = useState(channel.description || "");
  const [signPosts, setSignPosts] = useState(!!channel.sign_posts);
  const [adminQuery, setAdminQuery] = useState("");
  const [adminResults, setAdminResults] = useState<any[]>([]);
  const [admins, setAdmins] = useState(channel.admins || []);

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
          {!isOwner && channel.description && (
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{channel.description}</p>
          )}
          <p className="text-sm text-muted-foreground">
            {channel.subscribers_count ?? 0} подписчиков{channel.username ? ` · @${channel.username}` : ""}
          </p>

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
    </div>
  );
};

export default ChannelView;
