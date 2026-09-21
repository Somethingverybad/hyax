import { useEffect, useLayoutEffect, useState, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { applog } from "@/lib/applog";
import { outbox, mergePending } from "@/lib/outbox";
import { useMediaRecorder, type RecordKind, type VoiceRecording } from "@/hooks/use-media-recorder";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, Paperclip, X, Check, CheckCheck, Download, Image as ImageIcon, Smile, MoreVertical, Music2, Phone, Mic, Trash2, Play, Pause, Video, UserPlus, ChevronLeft, SwitchCamera, Reply, FileText, Pin, Forward, Bookmark, Radio, Users, Copy, Vibrate, ArrowDown } from "lucide-react";
import ReportSheet from "@/components/ReportSheet";
import { useSwipeBack } from "@/hooks/use-swipe-back";
import StickerPicker from "@/components/chat/StickerPicker";
import { toast } from "sonner";
import Identicon from "@/components/Identicon";
import { api, mediaUrl, NotificationSoundInfo, type PinnedInfo } from "@/api/client";
import { cn } from "@/lib/utils";
import { playSfx } from "@/lib/sfx";
import { Linkify, packLinkKind } from "@/lib/linkify";
import PackLinkCard from "./PackLinkCard";
import { playQueue, type Track } from "@/lib/player";
import { loadWaveform } from "@/lib/waveform";
import { compressImage } from "@/lib/compressImage";
import { useMediaUrl } from "@/hooks/use-media-url";
import UserProfileModal from "@/components/UserProfileModal";
import GroupSettingsModal from "@/components/chat/GroupSettingsModal";
import type { ChatInfo } from "@/api/client";
import { LivePreview, MessageImage, MessageVideoFile, MessageAudioFile, MessageFile, VideoNote, AlbumGrid, isImageFile, isAudioFile, isVideoFile, previewSize, dimsOf } from "@/components/chat/media";
import { readMessages, writeMessages } from "@/lib/messageCache";
import ImageViewer, { type ViewerItem } from "@/components/ImageViewer";
import StickerView from "@/components/chat/StickerView";

/** Телефон/планшет: экранная клавиатура, Enter вставляет перенос строки. */
const isTouchDevice = () =>
  Capacitor.isNativePlatform() || (typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches);

interface Profile {
  id: string;
  username: string;
  avatar_url?: string;
}

/** Вложение композера: фото и видео уходят альбомом, музыка играет плеером,
 *  остальное — строкой со скачиванием. */
type AttachMode = "photo" | "video" | "audio" | "file";
interface Attach {
  id: string;
  file: File;
  mode: AttachMode;
  /** blob-ссылка для превью в композере и в пузыре до подтверждения. */
  url: string;
  dims?: { w: number; h: number } | null;
}

interface Message {
  id: string;
  content: string | null;
  file_url: string | null;
  file_name: string | null;
  /** Приходит с бэкенда, если сообщение — стикер. */
  sticker?: { id: string; file_url: string; emoji?: string } | null;
  /** Аудио-стикер: звук, который слышит получатель. */
  sound?: { id: string; slug: string; name: string; url: string } | null;
  /** Цитата: на какое сообщение это ответ (компактное превью с сервера). */
  reply_to?: { id: string; sender_username: string; preview: string } | null;
  /** Голосовое сообщение и его длительность в секундах. */
  voice_url?: string | null;
  voice_duration?: number | null;
  /** Расшифровка голосового (по кнопке «Аа»): текст и состояние с сервера. */
  voice_transcript?: string | null;
  transcript_status?: "" | "pending" | "done" | "error";
  /** Видео-сообщение («треугольник») и его длительность. */
  video_url?: string | null;
  video_duration?: number | null;
  /** Видео-заметка снята фронталкой — воспроизводить зеркально (как в превью). */
  video_mirror?: boolean;
  /** Размеры картинки/видео с сервера — место под медиа резервируется заранее. */
  file_width?: number | null;
  file_height?: number | null;
  /** Общий id фото/видео, отправленных одним альбомом. */
  album_id?: string | null;
  /** Отправлено как «Файл» — показывать строкой со скачиванием, не превью. */
  download_only?: boolean;
  sender_id: string;
  sender?: Profile;
  created_at: string;
  /** Сообщение отредактировано. */
  is_edited?: boolean;
  /** Клиентские поля оптимистичной отправки: pending — сервер ещё не
   *  подтвердил (одна галочка), _key — стабильный ключ рендера, чтобы
   *  подмена временного сообщения настоящим не перемонтировала DOM,
   *  _dims — размеры картинки, замеренные до вставки пузыря: место
   *  резервируется сразу, и лента не дёргается при декодировании. */
  pending?: boolean;
  _key?: string;
  _dims?: { w: number; h: number } | null;
  /** Загрузка вложения в процентах, пока pending: рисуется в самом пузыре.
   *  100 — файл на сервере, ждём ответа (пережатие видео и т.п.). */
  _progress?: number | null;
  /** Отправка не удалась: пузырь остаётся с «Повторить»/«Удалить», сама
   *  запись (голос/кружок) лежит в _rec — раньше пузырь просто исчезал и
   *  снятое пропадало. */
  _failed?: boolean;
  _rec?: VoiceRecording & { mirror: boolean };
  /** Вложение, которое не доехало, — для кнопки «Повторить». */
  _att?: Attach;
  /** Пересылка: от кого пришло изначально (профиль, если есть) и подпись. */
  forwarded_from?: { id: string; username: string; avatar_url?: string | null } | null;
  forwarded_title?: string;
}

/** Чат для выбора при пересылке — минимум полей из списка чатов. */
interface ChatPick {
  id: string;
  name?: string;
  kind?: string;
  is_group?: boolean;
  avatar_url?: string | null;
  participants?: Profile[];
}

/** Габариты картинки из локального файла — читаются мгновенно, без сети. */
const imageDims = (url: string) =>
  new Promise<{ w: number; h: number } | null>((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = url;
  });

interface ChatWindowProps {
  chatId: string | null;
  userId: string;
  /** Собеседник (для звонка) и запуск звонка — приходят из Chat.tsx. */
  peer?: { id: string; username: string; avatar_url?: string | null } | null;
  onCall?: () => void;
  /** Метаданные группы (если это групповой чат) — для настроек и прав админа. */
  group?: ChatInfo | null;
  /** Список чатов нужно обновить после изменения группы. */
  onGroupUpdated?: () => void;
  /** На телефоне переписка занимает весь экран, и вернуться к списку можно
   *  только отсюда — на десктопе список виден всегда, поэтому кнопки нет. */
  onBack?: () => void;
  title?: string;
  /** Счётчик входящих по сокету для этого чата: растёт — перечитываем ленту
   *  сразу, не дожидаясь очередного опроса (см. эффект ниже). */
  messagePing?: number;
  /** Р.Ё.В: панель сообщает «держу/отпустил», сокетом заведует страница чатов. */
  onRov?: (on: boolean) => void;
  /** «Избранное»: чат без собеседника — без звонка, профиля и добавления людей. */
  saved?: boolean;
  /** Список чатов для пересылки и id «Избранного» для пункта «В избранное». */
  chats?: ChatPick[];
  savedChatId?: string;
}

const ChatWindow = ({ chatId, userId, onBack, title, peer, onCall, group, onGroupUpdated, messagePing, onRov, saved, chats, savedChatId }: ChatWindowProps) => {
  // Возврат к списку — жестом от левого края. Кнопку в шапке убрали:
  // на телефоне привычнее свайп, как в нативных приложениях.
  useSwipeBack(onBack);
  // Панель стикеров: выезжает над полем ввода, как в мессенджерах.
  const [stickersOpen, setStickersOpen] = useState(false);
  // Аудио-стикеры: каталог с сервера, выбранный звук уедет с сообщением
  // и прозвучит у получателя (в пуше и в открытом приложении).
  const [sounds, setSounds] = useState<NotificationSoundInfo[]>([]);
  const [selectedSound, setSelectedSound] = useState<NotificationSoundInfo | null>(null);
  // Открытая на весь экран картинка: { url, name }.
  // Просмотр картинок: держим весь список переписки и позицию в нём, чтобы
  // листать свайпом. Картинки альбома идут подряд — они и в ленте соседи.
  const [viewer, setViewer] = useState<{ items: ViewerItem[]; index: number } | null>(null);
  const openViewer = (messageId: string) => {
    const items: ViewerItem[] = messages
      .filter((m) => m.file_url && !m.download_only && isImageFile(m.file_name, m.file_url) && !imageLoadErrors.has(m.id))
      .map((m) => ({ raw: m.file_url as string, name: m.file_name || "image", messageId: m.id }));
    const index = Math.max(0, items.findIndex((x) => x.messageId === messageId));
    if (items.length) setViewer({ items, index });
  };
  // Проигрывание аудио-стикера по тапу; тап в любом месте прерывает.
  const [playingSoundId, setPlayingSoundId] = useState<string | null>(null);
  const soundStopRef = useRef<(() => void) | null>(null);
  // Просмотр профиля собеседника (тап по имени в шапке, только 1:1).
  const [profileOpen, setProfileOpen] = useState(false);
  // Реплай: на какое сообщение сейчас отвечаем (черновик над полем ввода).
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  // Редактирование своего текстового сообщения.
  const [editing, setEditing] = useState<Message | null>(null);
  // Удаление с отменой (5с): прячем локально, коммитим по таймеру.
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [undoBar, setUndoBar] = useState<{ id: string; scope: "me" | "all"; message: Message } | null>(null);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Настройки группы (клик по названию группы). Заголовок держим локально,
  // чтобы переименование отражалось сразу.
  const [groupOpen, setGroupOpen] = useState(false);
  const [headerTitle, setHeaderTitle] = useState(title || "");
  useEffect(() => { setHeaderTitle(title || ""); }, [title]);
  const isGroup = !!group?.is_group;
  const isGroupAdmin = isGroup && group?.creator === userId;
  // Голосовые: удержание кнопки пишет, отпускание отправляет, увод пальца
  // в сторону отменяет — как в мессенджерах.
  const {
    recording,
    seconds: recSeconds,
    stream: recStream,
    start: startRec,
    stop: stopRec,
  } = useMediaRecorder();
  // Короткий тап по кнопке переключает голос ↔ треугольник, удержание пишет.
  // Кнопка справа от поля ввода работает в трёх режимах: голосовое → видео →
  // Р.Ё.В. Короткий тап переключает режим, удержание запускает действие.
  type ComposerMode = RecordKind | "rov";
  const MODES: ComposerMode[] = ["audio", "video", "rov"];
  const [recordKind, setRecordKind] = useState<ComposerMode>("audio");
  const [roving, setRoving] = useState(false);
  // Фронтальная/задняя камера для видео-сообщений (выбор до записи: удержание
  // занимает единственный палец, переключать во время съёмки нечем).
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const pressStartedAtRef = useRef(0);
  // Жест записи: удержание захватывает устройство, тап только переключает режим.
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedRef = useRef(false);      // запись реально идёт
  const startingRef = useRef(false);     // устройство ещё захватывается
  const stopRequestedRef = useRef(false);// палец отпустили во время захвата
  const [cancelArmed, setCancelArmed] = useState(false);
  // Дублируем флаг отмены ссылкой: отпускание может прийти раньше, чем React
  // перерисует состояние, и запись ушла бы собеседнику вопреки жесту.
  const cancelArmedRef = useRef(false);
  // Долгий тап по сообщению открывает меню — так же, как в мессенджерах,
  // где системное выделение текста только мешает.
  const [menuMessage, setMenuMessage] = useState<Message | null>(null);
  // Жалоба на сообщение — шторка поверх ленты.
  const [reportFor, setReportFor] = useState<Message | null>(null);
  // Позиция меню: задана — компактное меню у курсора (десктоп, правый клик);
  // null — нижняя шторка (телефон, долгое удержание).
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const closeMenu = () => { setMenuMessage(null); setMenuPos(null); };
  // Добавление людей в чат: личная переписка при этом становится группой.
  const [addOpen, setAddOpen] = useState(false);
  // Закреплённое сообщение чата (одно) — полоса под шапкой.
  const [pinned, setPinned] = useState<PinnedInfo | null>(null);
  // Сообщение, для которого открыт выбор чата пересылки.
  const [forwardFor, setForwardFor] = useState<Message | null>(null);
  const [forwardQuery, setForwardQuery] = useState("");

  const loadPinned = async () => {
    if (!chatId) return;
    try {
      const c = await api.getChat(chatId);
      setPinned(c.pinned_message || null);
    } catch {
      /* закреп не критичен */
    }
  };
  useEffect(() => {
    setPinned(null);
    loadPinned();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  const togglePin = async (m: Message, pin: boolean) => {
    closeMenu();
    try {
      const r = await api.pinMessage(m.id, pin);
      setPinned(r.pinned_message);
      toast.success(pin ? "Закреплено" : "Откреплено");
    } catch (e: any) {
      toast.error(e?.message || "Не удалось");
    }
  };

  // Прокрутка к закреплённому: сообщение есть в ленте — едем к нему.
  const jumpToMessage = async (id: string) => {
    let el = document.getElementById(`msg-${id}`);
    // Цели нет в загруженной части — просим у сервера окно вокруг неё одним
    // запросом. Раньше клиент листал страницы по одной: полтора десятка
    // запросов и около десяти секунд до закреплённого сообщения.
    if (!el && chatId) {
      setJumping(true);
      try {
        const r = await api.syncMessages(chatId, { around: id, limit: 60 });
        if (r.messages.length) {
          // Окно заменяет ленту целиком: между ним и концом переписки может
          // быть пропуск, и склеивать их нельзя. Вернуться к последним
          // сообщениям — кнопкой «вниз» (она перезагрузит хвост).
          windowedRef.current = !!r.has_newer;
          setHasMore(r.has_more);
          hasMoreRef.current = r.has_more;
          setMessages(r.messages);
          await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => res(null))));
          el = document.getElementById(`msg-${id}`);
        }
      } catch {
        /* не нашлось — скажем об этом ниже */
      } finally {
        setJumping(false);
      }
    }
    if (!el) { toast("Сообщение не найдено — возможно, удалено"); return; }
    // К сообщению едем вручную: лента больше не считается прижатой к низу,
    // иначе наблюдатель за размером тут же вернул бы её обратно.
    pinnedRef.current = false;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.add("msg-flash");
    setTimeout(() => el!.classList.remove("msg-flash"), 1200);
  };

  const forwardTo = async (m: Message, targetId: string, label: string) => {
    try {
      await api.forwardMessage(m.id, targetId);
      toast.success(label);
      if (targetId === chatId) syncSince();
    } catch (e: any) {
      toast.error(e?.message || "Не удалось переслать");
    }
  };

  const toSaved = async (m: Message) => {
    closeMenu();
    let id = savedChatId;
    if (!id) {
      try { id = (await api.getSavedChat()).id; } catch { toast.error("Избранное недоступно"); return; }
    }
    await forwardTo(m, id, "Добавлено в избранное");
  };

  /** Название чата для списка пересылки. */
  const chatLabel = (c: ChatPick) => {
    if (c.kind === "channel") return c.name || "Канал";
    if (c.is_group) return c.name || "Группа";
    const other = c.participants?.find((p) => p.id !== userId);
    return other?.username || c.name || "Чат";
  };
  const [addQuery, setAddQuery] = useState("");
  const [addResults, setAddResults] = useState<Profile[]>([]);
  const [adding, setAdding] = useState(false);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdStartRef = useRef<{ x: number; y: number } | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  // Вложения композера: можно выбрать несколько фото/видео разом (уйдут
  // альбомом), добавить музыку или файл, и убрать лишнее до отправки.
  const [attachments, setAttachments] = useState<Attach[]>([]);
  const dropAttachment = (id: string) => setAttachments((prev) => {
    const gone = prev.find((a) => a.id === id);
    if (gone?.url) URL.revokeObjectURL(gone.url);
    return prev.filter((a) => a.id !== id);
  });
  // Десктоп: файл можно перетащить в окно чата или вставить из буфера (⌘V/Ctrl+V).
  const [dragOver, setDragOver] = useState(false);
  const dragDepthRef = useRef(0);
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer?.types || []).includes("Files");
  const onDragEnter = (e: React.DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepthRef.current++; setDragOver(true); };
  const onDragOver = (e: React.DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; };
  const onDragLeave = (e: React.DragEvent) => { if (!hasFiles(e)) return; dragDepthRef.current = Math.max(0, dragDepthRef.current - 1); if (!dragDepthRef.current) setDragOver(false); };
  const onDrop = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); dragDepthRef.current = 0; setDragOver(false);
    void acceptFiles(Array.from(e.dataTransfer.files || []));
  };
  const onPasteFile = (e: React.ClipboardEvent) => {
    const list = Array.from(e.clipboardData?.files || []);
    if (!list.length) return; // обычный текст — вставляется как есть
    e.preventDefault();
    void acceptFiles(list);
  };
  const [uploading, setUploading] = useState(false);
  const [imageLoadErrors, setImageLoadErrors] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const composeRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  // Прогресс загрузки живёт в самом временном сообщении, а не отдельной
  // полоской над полем ввода: раньше пузырь для видео/файла/голосового
  // вообще не появлялся до ответа сервера, и казалось, что ничего не ушло.
  const setProgressFor = (tempId: string, p: number | null, forChat: string | null = chatId) => {
    // Прогресс пишем и в очередь: экран могли закрыть, а загрузка идёт.
    if (forChat) outbox.patch(forChat, tempId, { _progress: p });
    setMessages(prev => prev.map(m => (m.id === tempId ? { ...m, _progress: p } : m)));
  };
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // Свои картинки показываем из локального файла: сервер их и так получил от
  // нас, скачивать обратно — лишний трафик и «пустой» пузырь на время загрузки.
  // Ключ — file_url, который сервер выдал при аплоаде.
  const localImagesRef = useRef<Map<string, string>>(new Map());
  
  // Рефы для отслеживания состояния
  const previousMessagesRef = useRef<Message[]>([]);
  // Ленивая загрузка: сервер отдаёт хвост ленты страницами (см. syncSince /
  // loadOlder), кэш IndexedDB рисует чат мгновенно. syncedAtRef — серверное
  // время последней синхронизации, следующий запрос since=… приносит только
  // новое/изменённое/удалённое.
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const syncedAtRef = useRef<string | null>(null);
  const loadingOlderRef = useRef(false);
  // Первая синхронизация после открытия чата ещё не прошла: то, что она
  // принесёт, — не «новые входящие», а пропущенное, звучать не должно.
  const primedRef = useRef(false);
  // Сохранение позиции прокрутки при подгрузке старых сообщений сверху.
  const scrollAdjustRef = useRef<{ height: number; top: number } | null>(null);
  // Положение ленты. «Прижата к низу» (pinned) — человек смотрит на последние
  // сообщения: новые приходят с доездом вниз, а рост содержимого (догрузилась
  // картинка, развернулась расшифровка) низ не отрывает. Отлистал вверх —
  // ленту не трогаем вообще: новые считаем в newBelow и показываем кнопку.
  const pinnedRef = useRef(true);
  // Палец сейчас на ленте; и «после жеста довести позицию» — если клавиатура
  // сменила состояние посреди касания (см. обработчик hyax:keyboard).
  const feedTouchRef = useRef(false);
  // Прокрутку затеял человек (палец, колесо, клавиши), а не перерисовка.
  // Событие scroll прилетает и когда лента просто выросла — по нему нельзя
  // судить, что человек ушёл от низа.
  const userScrollRef = useRef(0);
  const markUserScroll = () => { userScrollRef.current = Date.now(); };
  /** Телеметрия положения ленты для баг-репорта: где стоим и почему сдвинулись. */
  const logFeed = (why: string) => {
    const el = scrollRef.current;
    if (!el) return;
    applog.info(`feed ${why} top=${Math.round(el.scrollTop)} dist=${Math.round(el.scrollHeight - el.scrollTop - el.clientHeight)} sh=${el.scrollHeight} ch=${el.clientHeight} pinned=${pinnedRef.current ? 1 : 0} msgs=${messagesRef.current}`);
  };
  const messagesRef = useRef(0);
  // Актуальный список для функций, живущих дольше одного рендера (подгрузка
  // страниц в цикле): в замыкании messages остаётся тем, каким был при
  // создании функции.
  const messagesListRef = useRef<Message[]>([]);
  const pendingKbFixRef = useRef(false);
  const settleAfterTouch = () => {
    feedTouchRef.current = false;
    if (!pendingKbFixRef.current) return;
    pendingKbFixRef.current = false;
    // Жест закончился — если лента была прижата к низу, возвращаем её к низу:
    // во время касания система могла не принять нашу позицию.
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
    });
  };
  const jumpingRef = useRef(0); // до какого момента идёт наш собственный доезд вниз
  const feedRef = useRef<HTMLDivElement>(null);
  const [newBelow, setNewBelow] = useState(0);
  // Лента показывает окно вокруг старого сообщения, а не хвост переписки:
  // кнопка «вниз» должна не прокручивать, а перезагрузить последние сообщения.
  const windowedRef = useRef(false);
  const [jumping, setJumping] = useState(false);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  // Входящие, пришедшие при открытом чате, — им анимация появления (msg-in).
  const [freshIds, setFreshIds] = useState<Set<string>>(() => new Set());
  // Самое свежее сообщение на прошлом рендере — по нему ищем новые входящие
  // (длина списка больше не годится: страницы добавляются и сверху).
  const newestRef = useRef<number>(0);
  // Чат, для которого previousMessagesRef уже наполнен: нужен, чтобы отличить
  // смену чата от прихода новых сообщений.
  const soundChatRef = useRef<string | null>(null);
  const lastSendTimeRef = useRef<number>(0);

  const shouldScrollRef = useRef<boolean>(true); // По умолчанию true для первоначальной прокрутки

  // Каталог аудио-стикеров: один запрос на окно чата.
  useEffect(() => {
    api.getNotificationSounds().then(setSounds).catch(() => {});
  }, []);

  // Меню прикрепления закрывается тапом вне области ввода.
  useEffect(() => {
    if (!attachMenuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (composeRef.current && !composeRef.current.contains(e.target as Node)) {
        setAttachMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [attachMenuOpen]);

  // Панель стикеров/аудиостикеров закрывается тапом вне области ввода — не
  // нужно отдельно жать кнопку. Кнопка-переключатель внутри composeRef, так
  // что её тап панель не закроет (сработает её собственный onClick).
  useEffect(() => {
    if (!stickersOpen) return;
    const onDown = (e: PointerEvent) => {
      if (composeRef.current && !composeRef.current.contains(e.target as Node)) {
        setStickersOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [stickersOpen]);

  // Высоту пересчитываем на каждое изменение текста: сначала сбрасываем,
  // иначе поле умеет только расти и не сжимается после отправки.
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 104)}px`;
  }, [newMessage]);

  // Открытие чата: сначала кэш (мгновенно), потом синхронизация с сервера —
  // только то, что изменилось после последней синхронизации. Без кэша —
  // последние 50 сообщений; старое подгружается при прокрутке вверх.
  useEffect(() => {
    if (!chatId) {
      setMessages([]);
      return;
    }
    let alive = true;
    syncedAtRef.current = null;
    primedRef.current = false;
    pinnedRef.current = true;
    windowedRef.current = false;
    setNewBelow(0);
    setAwayFromBottom(false);
    setFreshIds(new Set());
    setHasMore(false);
    setMessages([]);

    (async () => {
      const cached = await readMessages(chatId);
      if (!alive) return;
      if (cached && cached.messages.length) {
        syncedAtRef.current = cached.syncedAt;
        setHasMore(cached.hasMore);
        setMessages(cached.messages);
        scrollToBottomOnOpen();
        await syncSince(chatId);
      } else {
        try {
          const r = await api.syncMessages(chatId, { limit: 50 });
          if (!alive) return;
          syncedAtRef.current = r.now;
          setHasMore(r.has_more);
          setMessages(r.messages);
          void writeMessages(chatId, r.messages, r.now, r.has_more);
          scrollToBottomOnOpen();
        } catch {
          console.log("Не удалось загрузить сообщения");
        }
      }
      primedRef.current = true;
    })();

    // Опрос раз в три секунды — страховка на случай оборванного сокета;
    // с since=… он почти ничего не стоит.
    const intervalId = setInterval(() => { syncSince(chatId); }, 3000);
    return () => { alive = false; clearInterval(intervalId); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  // Пришло сообщение по сокету — забираем ленту немедленно. Опрос раз в три
  // секунды остаётся страховкой на случай оборванного сокета, но ждать его
  // не нужно: именно из-за него сообщение собеседника появлялось в открытой
  // переписке через пару секунд после отправки.
  useEffect(() => {
    if (messagePing) { syncSince(chatId); loadPinned(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messagePing]);

  // Новые входящие: звук и прокрутка вниз. Сравниваем по времени самого
  // свежего сообщения на прошлом рендере, а не по длине списка — страницы
  // теперь добавляются и сверху (loadOlder), и это не «новые».
  // Layout-эффект, а не обычный: класс анимации должен встать до первой
  // отрисовки нового пузыря, иначе он на кадр мелькает уже проявленным.
  useLayoutEffect(() => {
    messagesRef.current = messages.length;
    messagesListRef.current = messages;
    const ts = (m: Message) => Date.parse(m.created_at) || 0;
    const newest = messages.length ? ts(messages[messages.length - 1]) : 0;
    if (soundChatRef.current !== chatId) {
      soundChatRef.current = chatId ?? null;
      newestRef.current = newest;
      // Первый рендер ленты нового чата — въезд уже запланирован в эффекте
      // открытия; тут только фиксируем «самое новое».
      return;
    }
    const prevNewest = newestRef.current;
    const newMessages = messages.filter(m => ts(m) > prevNewest);
    newestRef.current = Math.max(newest, prevNewest);
    if (newMessages.length === 0) return;

    // Обычное входящее в открытом чате не озвучиваем: человек и так смотрит
    // на переписку, а пуш по этому чату сервер не шлёт (см. presence.py).
    // Аудио-стикер — другое дело: он и есть сообщение, поэтому играет сам.
    // До первой синхронизации молчим: то, что пришло, пока чат был закрыт, —
    // не «прямо сейчас».
    const withSound = primedRef.current
      ? newMessages.find(m => m.sender?.id !== userId && m.sound?.url)
      : null;
    if (withSound?.sound?.url) void playSfx(mediaUrl(withSound.sound.url), { volume: 0.6 });

    const incoming = newMessages.filter(m => m.sender?.id !== userId);
    if (primedRef.current && incoming.length) setFreshIds(new Set(incoming.map(m => m.id)));
    // Своё сообщение всегда ведёт вниз. Чужое — только если лента и так у низа;
    // отлистал вверх — остаёмся на месте и считаем пришедшее.
    if (incoming.length < newMessages.length || pinnedRef.current) goBottom(primedRef.current);
    else setNewBelow(n => n + incoming.length);
  }, [messages, userId]);

  // Пока лента прижата к низу, рост содержимого его не отрывает: картинка
  // догрузилась, появилась расшифровка голосового, пришла реакция. Без этого
  // последнее сообщение уезжало под поле ввода, а следующий доезд дёргал ленту.
  useEffect(() => {
    const feed = feedRef.current, el = scrollRef.current;
    if (!feed || !el || typeof ResizeObserver === "undefined") return;
    let lastLogged = 0;
    let lastCh = el.clientHeight;
    const ro = new ResizeObserver(() => {
      if (!pinnedRef.current || Date.now() <= jumpingRef.current) return;
      const before = el.scrollTop;
      const chChanged = el.clientHeight !== lastCh;
      const delta = lastCh - el.clientHeight;
      lastCh = el.clientHeight;
      el.scrollTop = el.scrollHeight;
      // Держим низ и когда лента подросла (догрузилась картинка, пришло
      // сообщение), и когда она стала ниже сама: над перепиской появляется
      // полоса закреплённого сообщения, и высота падала на её высоту уже
      // после доводки — последнее сообщение уезжало под поле ввода.
      if (Math.abs(el.scrollTop - before) > 2 && (chChanged || Date.now() - lastLogged > 400)) {
        lastLogged = Date.now();
        logFeed(chChanged ? `shrink ${delta > 0 ? "-" : "+"}${Math.abs(Math.round(delta))}` : `grow +${Math.round(el.scrollTop - before)}`);
      }
    });
    ro.observe(feed);
    // Сам контейнер тоже меряем: его высоту меняют полоса закрепления,
    // панель ответа и рост поля ввода — рост содержимого тут ни при чём.
    ro.observe(el);
    return () => ro.disconnect();
  }, [chatId]);

  // Подгрузили страницу сверху — удерживаем то, что было на экране, на месте:
  // до перерисовки высоту ленты запомнили в scrollAdjustRef.
  useLayoutEffect(() => {
    const a = scrollAdjustRef.current;
    const el = scrollRef.current;
    if (!a || !el) return;
    scrollAdjustRef.current = null;
    el.scrollTop = a.top + (el.scrollHeight - a.height);
  }, [messages]);

  /** Слить ответ сервера в ленту: обновить по id, убрать удалённые,
   *  добавить новые. Локальные поля (ключ рендера, размеры, pending) не
   *  теряем; неподтверждённые пузыри и сообщения, о которых сервер в этом
   *  ответе не говорил, остаются как есть — поэтому старой гонки «опрос
   *  ушёл до отправки и стёр подтверждённое» больше нет. */
  const applyBatch = (
    incoming: Message[],
    deleted: string[],
    mode: "merge" | "prepend" = "merge",
  ) => {
    setMessages(prev => {
      const gone = new Set(deleted);
      const byId = new Map(prev.filter(m => !gone.has(m.id)).map(m => [m.id, m]));
      for (const d of incoming) {
        const local = byId.get(d.id);
        byId.set(d.id, local ? { ...local, ...d, pending: false } : d);
      }
      // Сравниваем как даты: сервер и клиент пишут ISO в разных форматах
      // (+00:00 против Z, микросекунды против миллисекунд), строки не годятся.
      const merged = [...byId.values()].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
      if (mode === "merge" && JSON.stringify(merged) === JSON.stringify(prev)) return prev;
      return merged;
    });
  };

  const markReadTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Клавиатура открывается — лента подъезжает вверх на её высоту с той же
  // длительностью, как в Telegram: то, на что смотрел, остаётся на виду.
  // Закрывается — возвращается обратно. Событие шлёт main.tsx из плагина
  // Keyboard до начала системной анимации.
  const kbShiftRef = useRef(0);
  const kbSwipeRef = useRef<{ y: number; done: boolean } | null>(null);
  const hideKeyboard = () => {
    textareaRef.current?.blur();
    if (Capacitor.isNativePlatform()) import("@capacitor/keyboard").then(({ Keyboard }) => Keyboard.hide()).catch(() => {});
  };
  useEffect(() => {
    let cleanup: ReturnType<typeof setTimeout> | undefined;
    const onKb = (ev: Event) => {
      const el = scrollRef.current, feed = feedRef.current;
      if (!el) return;
      const { height, duration } = (ev as CustomEvent<{ height: number; duration: number }>).detail;
      if (height === kbShiftRef.current) return;
      kbShiftRef.current = height;
      // Событие приходит до того, как поменяется отступ под клавиатуру
      // (main.tsx), поэтому расстояние до низа меряем прямо сейчас — по факту,
      // а не по последнему событию прокрутки: между ними могли прийти новые
      // сообщения, и лента прыгала на их высоту.
      const dist = Math.max(0, el.scrollHeight - el.scrollTop - el.clientHeight);
      const prevTop = el.scrollTop;
      const touching = feedTouchRef.current;
      // Инвариант — расстояние от низа ленты до низа содержимого: то, на что
      // человек смотрел над полем ввода, остаётся над полем ввода и при
      // открытии, и при закрытии клавиатуры.
      requestAnimationFrame(() => {
        const node = scrollRef.current;
        if (!node) return;
        const target = Math.max(0, node.scrollHeight - node.clientHeight - dist);
        node.scrollTop = target;
        const moved = node.scrollTop - prevTop;
        applog.info(`kbfeed h=${Math.round(height)} touch=${touching ? 1 : 0} prev=${Math.round(prevTop)} target=${Math.round(target)} got=${Math.round(node.scrollTop)} dist=${Math.round(dist)} sh=${node.scrollHeight} ch=${node.clientHeight}`);
        // Палец на ленте (клавиатуру прячут свайпом вниз): прокруткой владеет
        // система, программный scrollTop iOS применит только после жеста, а
        // трансформ — сразу, и сообщения повисали выше своего места.
        if (touching) { pendingKbFixRef.current = true; return; }
        if (!feed || !moved || !duration) return;
        // Переезд показываем трансформом с той же кривой и длительностью, что
        // у панели ввода: лента идёт вровень с клавиатурой, а scrollTop по
        // кадрам никто не пишет.
        clearTimeout(cleanup);
        feed.style.transition = "none";
        feed.style.transform = `translateY(${moved}px)`;
        void feed.offsetHeight; // зафиксировать стартовое положение до перехода
        feed.style.transition = `transform ${duration}ms cubic-bezier(0.17, 0.59, 0.4, 1)`;
        feed.style.transform = "translateY(0)";
        cleanup = setTimeout(() => { feed.style.transition = ""; feed.style.transform = ""; }, duration + 60);
      });
    };
    window.addEventListener("hyax:keyboard", onKb);
    return () => { window.removeEventListener("hyax:keyboard", onKb); clearTimeout(cleanup); };
  }, []);

  /** Приращение с сервера: всё, что менялось после последней синхронизации. */
  const syncSince = async (id: string | null = chatId) => {
    if (!id) return;
    try {
      const r = await api.syncMessages(id, syncedAtRef.current ? { since: syncedAtRef.current } : { limit: 50 });
      if (id !== chatId) return; // чат успели переключить
      syncedAtRef.current = r.now;
      if (r.messages.length || r.deleted.length) applyBatch(r.messages, r.deleted);
      // Чужие сообщения, пришедшие в открытый и видимый чат, — прочитаны.
      // Иначе бейдж в списке чатов оставался, хотя человек всё видел и ответил.
      if (r.messages.some((m) => m.sender?.id !== userId) && (typeof document === "undefined" || document.visibilityState === "visible")) {
        clearTimeout(markReadTimerRef.current);
        markReadTimerRef.current = setTimeout(() => { api.markChatAsRead(id).catch(() => {}); }, 400);
      }
      setMessages(prev => { void writeMessages(id, prev, r.now, hasMoreRef.current); return prev; });
    } catch {
      console.log("Не удалось синхронизировать сообщения");
    }
  };
  // Для старых вызовов после отправки медиа/стикера.
  const fetchMessages = syncSince;

  const hasMoreRef = useRef(false);
  hasMoreRef.current = hasMore;

  /** Страница старее первого загруженного — при прокрутке к верху. */
  const loadOlder = async (): Promise<boolean> => {
    const id = chatId;
    if (!id || loadingOlderRef.current || !hasMoreRef.current) return false;
    const first = messagesListRef.current.find(m => !m.pending);
    if (!first) return false;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const r = await api.syncMessages(id, { before: first.created_at, limit: 50 });
      if (id !== chatId) return false;
      const el = scrollRef.current;
      if (el) scrollAdjustRef.current = { height: el.scrollHeight, top: el.scrollTop };
      setHasMore(r.has_more);
      hasMoreRef.current = r.has_more;
      if (r.messages.length) applyBatch(r.messages, [], "prepend");
      return r.messages.length > 0;
    } catch {
      return false;
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  };

  const onFeedScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    const jumping = Date.now() < jumpingRef.current;
    // Отцепляемся от низа только по прокрутке рукой. Раньше хватало любого
    // события scroll, а оно приходит и от роста ленты: пока грузились картинки,
    // лента «отцеплялась» и уезжала от последнего сообщения при каждом входе
    // в чат.
    const byUser = Date.now() - userScrollRef.current < 900;
    if (dist < 80) {
      if (!pinnedRef.current) logFeed("repin");
      pinnedRef.current = true;
      jumpingRef.current = 0;
      if (newBelow) setNewBelow(0);
    } else if (!jumping && byUser && pinnedRef.current) {
      pinnedRef.current = false;
      logFeed("unpin");
    }
    const away = dist > 400 && !jumping;
    if (away !== awayFromBottom) setAwayFromBottom(away);
    // Старые страницы тянем заранее, за полтора экрана до верха: пока человек
    // долистает, они уже в ленте, и вставка не приходится на край под пальцем.
    if (el.scrollTop < Math.max(600, el.clientHeight * 1.5) && hasMoreRef.current && !loadingOlderRef.current) void loadOlder();
  };

  /** Вернуться к последним сообщениям из окна вокруг старого. */
  const backToLatest = async () => {
    if (!chatId) return;
    setJumping(true);
    // Сначала хвост из кэша — он уже на устройстве, лента возвращается сразу;
    // сеть догоняет следом. Без этого возврат ждал ответа сервера.
    try {
      const cached = await readMessages(chatId);
      if (cached?.messages?.length) {
        windowedRef.current = false;
        setHasMore(cached.hasMore);
        hasMoreRef.current = cached.hasMore;
        setMessages(cached.messages);
        scrollToBottomOnOpen();
      }
    } catch { /* кэша нет — ждём сеть */ }
    try {
      const r = await api.syncMessages(chatId, { limit: 50 });
      windowedRef.current = false;
      syncedAtRef.current = r.now;
      setHasMore(r.has_more);
      hasMoreRef.current = r.has_more;
      setMessages(r.messages);
      void writeMessages(chatId, r.messages, r.now, r.has_more);
      scrollToBottomOnOpen();
    } catch {
      toast.error("Не удалось вернуться к последним сообщениям");
    } finally {
      setJumping(false);
    }
  };

  /** Доезд в самый низ — по новому сообщению, после отправки, по кнопке. */
  const goBottom = (smooth: boolean) => {
    if (windowedRef.current) { void backToLatest(); return; }
    pinnedRef.current = true;
    setNewBelow(0);
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (!el) return;
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      // Плавно — только на короткой дистанции: пролёт через всю ленту дольше
      // и заметнее, чем мгновенный переход.
      const animate = smooth && dist < el.clientHeight * 3;
      jumpingRef.current = animate ? Date.now() + 700 : 0;
      el.scrollTo({ top: el.scrollHeight, behavior: animate ? "smooth" : "auto" });
    });
  };

  /** Вход в чат: лента сразу стоит на последнем сообщении. */
  const scrollToBottomOnOpen = () => {
    logFeed("open");
    // Вход в чат — сразу у последнего сообщения, без «въезда»: плавный пролёт
    // на входе спорил с догрузкой истории и синхронизацией, лента дёргалась.
    // Дальше низ удерживает ResizeObserver (см. выше), пока лента прижата.
    pinnedRef.current = true;
    const snap = () => { const el = scrollRef.current; if (el && pinnedRef.current) el.scrollTop = el.scrollHeight; };
    requestAnimationFrame(() => { snap(); requestAnimationFrame(() => { snap(); logFeed("snap"); }); });
  };

  /** После отправки (текст, медиа, стикер) — вниз, плавно. */
  const scrollToBottom = (smooth = false) => goBottom(smooth);

  const handlePick = async (
    e: React.ChangeEvent<HTMLInputElement>,
    mode: AttachMode,
  ) => {
    const list = Array.from(e.target.files || []);
    e.target.value = ""; // чтобы повторный выбор того же файла сработал
    await acceptFiles(list, mode);
  };

  const acceptFiles = async (list: File[], mode?: AttachMode) => {
    for (const f of list) await acceptFile(f, mode);
  };

  /** Принять файл из любого источника — меню скрепки, drag-n-drop, вставка из
   *  буфера. Без явного режима тип берём из MIME: картинка → фото (сжимаем
   *  здесь), видео → видео (пережмёт сервер), остальное — файл строкой. */
  const acceptFile = async (file: File, mode?: AttachMode) => {
    mode = mode ?? (file.type.startsWith("image/") ? "photo"
      : file.type.startsWith("video/") ? "video"
      : file.type.startsWith("audio/") ? "audio" : "file");
    // Лимита на размер нет — ни здесь, ни на сервере, ни в nginx (0):
    // фото и видео с телефона отправляются как есть. Фото сжимаем тут же.
    // В лог баг-репорта: что выбрали и какого размера. Без этого «видео не
    // отправляется» не отличить от «пикер ничего не вернул».
    applog.info(`attach pick ${mode} ${file.type || "?"} ${Math.round(file.size / 1024)}KB`);
    const prepared = mode === "photo" ? await compressImage(file) : file;
    const url = URL.createObjectURL(prepared);
    const dims = mode === "photo" ? await imageDims(url) : null;
    setAttachments((prev) => [...prev, { id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, file: prepared, mode, url, dims }]);
  };

  /** Очередь для плеера — все аудиофайлы этого чата по порядку; начинаем с
   *  того, по которому ткнули. Так следующий трек играет сам, как в Telegram. */
  const playAudioFrom = (m: Message) => {
    const audios = messages.filter((x) => x.file_url && isAudioFile(x.file_name, x.file_url));
    const queue: Track[] = audios.map((x) => ({
      id: x.id,
      raw: x.file_url as string,
      title: (x.file_name || "Аудио").replace(/\.[^.]+$/, ""),
      artist: x.sender?.username,
    }));
    const idx = Math.max(0, audios.findIndex((x) => x.id === m.id));
    void playQueue(queue, idx);
  };

  const stopSticker = () => {
    soundStopRef.current?.();
    soundStopRef.current = null;
    setPlayingSoundId(null);
  };

  // Тап по сообщению со звуковым стикером — проиграть; повторный тап или тап
  // в любом месте экрана — прервать.
  const toggleSticker = async (msgId: string, url: string) => {
    if (playingSoundId === msgId) { stopSticker(); return; }
    stopSticker();
    setPlayingSoundId(msgId);
    const stop = await playSfx(mediaUrl(url), {
      volume: 0.9,
      onEnded: () => { soundStopRef.current = null; setPlayingSoundId(null); },
    });
    soundStopRef.current = stop;
    // Разовый слушатель вешаем на следующий тик, чтобы стартовый тап его не
    // сработал; любой следующий тап по экрану обрывает звук.
    setTimeout(() => {
      const handler = () => {
        stopSticker();
        document.removeEventListener("pointerdown", handler, true);
      };
      document.addEventListener("pointerdown", handler, true);
    }, 0);
  };

  // Свайп-ответ: влево на чужих сообщениях, вправо на своих. Тянем строку
  // за пальцем, за порогом — ставим сообщение в ответ.
  const [swipe, setSwipe] = useState<{ id: string; dx: number } | null>(null);
  const swipeStartRef = useRef<{ x: number; y: number; id: string } | null>(null);
  const swipeActiveRef = useRef(false);
  const justSwipedRef = useRef(false); // подавляет клик после свайпа
  const SWIPE_TRIGGER = 45;
  const SWIPE_MAX = 90;
  const swipeTimeRef = useRef(0);

  // Пока идёт горизонтальный свайп, вертикальную прокрутку у браузера
  // отбираем: иначе iOS на любой диагонали начинал прокрутку и слал
  // pointercancel. Слушатель нативный и не-passive — React свои touchmove
  // вешает passive, и preventDefault там не работает.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onMove = (e: TouchEvent) => { if (swipeActiveRef.current) e.preventDefault(); };
    el.addEventListener("touchmove", onMove, { passive: false });
    return () => el.removeEventListener("touchmove", onMove);
  }, []);

  const msgPointerDown = (e: React.PointerEvent, message: Message) => {
    // Жесты — только для пальца/стилуса. Мышью меню открывает правая кнопка
    // (onContextMenu); раньше зажатая кнопка через 450 мс запускала «долгое
    // нажатие» и подменяла меню у курсора нижней шторкой во весь экран.
    if (e.pointerType === "mouse") return;
    swipeStartRef.current = { x: e.clientX, y: e.clientY, id: message.id };
    swipeActiveRef.current = false;
    swipeTimeRef.current = performance.now();
    startLongPress(message);
  };
  const msgPointerMove = (e: React.PointerEvent, message: Message, isOwn: boolean) => {
    const st = swipeStartRef.current;
    if (!st || st.id !== message.id) return;
    const dx = e.clientX - st.x;
    const dy = e.clientY - st.y;
    if (!swipeActiveRef.current) {
      // Палец идёт по диагонали и быстро: горизонталью считаем всё до ~50°
      // от оси, вертикалью — только явный уход вверх/вниз.
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx) * 1.25) {
        swipeStartRef.current = null; cancelLongPress(); return;
      }
      if (Math.abs(dx) > 8 && Math.abs(dx) >= Math.abs(dy) * 0.8) {
        swipeActiveRef.current = true;
        cancelLongPress();
        // забираем указатель, чтобы получать move даже при уходе пальца в сторону
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      } else return;
    }
    // Тянуть можно в любую сторону: раньше «неправильное» направление
    // упиралось в ноль, и жест выглядел как дребезг без результата.
    void isOwn;
    const off = Math.max(-SWIPE_MAX, Math.min(dx, SWIPE_MAX));
    setSwipe({ id: message.id, dx: off });
  };
  const msgPointerUp = (e: React.PointerEvent, message: Message, isOwn: boolean) => {
    const st = swipeStartRef.current;
    cancelLongPress();
    if (swipeActiveRef.current && st) {
      const dx = e.clientX - st.x;
      void isOwn;
      // Быстрый рывок засчитываем с меньшего пути.
      const dt = Math.max(1, performance.now() - swipeTimeRef.current);
      const fast = Math.abs(dx) / dt > 0.5 && Math.abs(dx) > 28;
      const triggered = Math.abs(dx) > SWIPE_TRIGGER || fast;
      if (triggered) { setReplyTo(message); textareaRef.current?.focus(); }
      justSwipedRef.current = true;
      setTimeout(() => { justSwipedRef.current = false; }, 350);
    }
    swipeStartRef.current = null;
    swipeActiveRef.current = false;
    setSwipe(null);
  };
  const msgPointerCancel = () => {
    cancelLongPress();
    swipeStartRef.current = null;
    swipeActiveRef.current = false;
    setSwipe(null);
  };

  const commitDelete = (id: string, scope: "me" | "all") => {
    api.removeMessage(id, scope).catch(() => {});
    setMessages((prev) => prev.filter((m) => m.id !== id));
    setHiddenIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
  };
  const startDelete = (message: Message, scope: "me" | "all") => {
    closeMenu();
    // Если уже есть отложенное удаление — закоммитим его сразу.
    if (deleteTimerRef.current) { clearTimeout(deleteTimerRef.current); deleteTimerRef.current = null; }
    if (undoBar) commitDelete(undoBar.id, undoBar.scope);
    setHiddenIds((prev) => new Set(prev).add(message.id));
    setUndoBar({ id: message.id, scope, message });
    deleteTimerRef.current = setTimeout(() => {
      commitDelete(message.id, scope);
      setUndoBar(null);
      deleteTimerRef.current = null;
    }, 5000);
  };
  const undoDelete = () => {
    if (deleteTimerRef.current) { clearTimeout(deleteTimerRef.current); deleteTimerRef.current = null; }
    if (undoBar) setHiddenIds((prev) => { const n = new Set(prev); n.delete(undoBar.id); return n; });
    setUndoBar(null);
  };
  const startEdit = (message: Message) => {
    closeMenu();
    setReplyTo(null);
    setEditing(message);
    setNewMessage(message.content || "");
  };
  const cancelEdit = () => { setEditing(null); setNewMessage(""); };

  // Короткое превью цитаты для черновика и оптимистичного пузыря.
  const replyPreviewText = (m: Message): string => {
    const t = (m.content || "").trim();
    if (t) return t;
    if (m.sticker?.file_url) return "Стикер";
    if (m.video_url) return "Видео-сообщение";
    if (m.voice_url) return "Голосовое сообщение";
    if (m.file_url) return "Файл";
    return "Сообщение";
  };

  const sendMessage = async () => {
    // Звук — самостоятельное сообщение: пузырь с одним аудио-стикером,
    // который получатель может проиграть. Текст для этого не нужен.
    if (!chatId || (!newMessage.trim() && !attachments.length && !selectedSound)) return;

    // Режим редактирования: не создаём новое, а меняем текст существующего.
    if (editing) {
      const newText = newMessage.trim();
      const target = editing;
      if (!newText) { cancelEdit(); return; }
      setEditing(null);
      setNewMessage("");
      try {
        const upd = await api.editMessage(target.id, newText);
        setMessages((prev) => prev.map((m) =>
          m.id === target.id ? { ...m, ...upd, content: newText, is_edited: true, _key: m._key, _dims: m._dims } : m));
      } catch {
        toast.error("Не удалось изменить сообщение");
        setEditing(target); setNewMessage(newText);
      }
      return;
    }

    const text = newMessage.trim();
    const list = attachments;
    const sound = selectedSound;
    const reply = replyTo;

    setNewMessage("");
    setAttachments([]);
    setSelectedSound(null);
    setReplyTo(null);
    // Клавиатуру после отправки не прячем: фокус остаётся в поле.
    if (isTouchDevice()) requestAnimationFrame(() => textareaRef.current?.focus());
    lastSendTimeRef.current = Date.now();
    void playSfx("/sounds/send.mp3", { volume: 0.3 });

    // Без вложений — обычное текстовое сообщение (или один звук).
    if (!list.length) {
      const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const optimistic: Message = {
        id: tempId,
        content: text || null,
        file_url: null,
        file_name: null,
        sender_id: userId,
        sender: { id: userId } as Profile,
        created_at: new Date().toISOString(),
        sound,
        reply_to: reply
          ? { id: reply.id, sender_username: reply.sender?.username || "", preview: replyPreviewText(reply) }
          : null,
        pending: true,
        _key: tempId,
      };
      setMessages(prev => [...prev, optimistic]);
      setTimeout(() => scrollToBottom(true), 50);
      try {
        const sent = await api.sendMessage(chatId, text || null, sound?.id, reply?.id);
        setMessages(prev =>
          prev.some(m => m.id === sent.id)
            ? prev.filter(m => m.id !== tempId)
            : prev.map(m => (m.id === tempId ? { ...m, ...sent, pending: false, _key: tempId } : m))
        );
      } catch (error: any) {
        console.error("Error sending message:", error);
        toast.error("Ошибка отправки: " + (error?.message || "Неизвестная ошибка"));
        setMessages(prev => prev.filter(m => m.id !== tempId));
        setNewMessage(text);
        setSelectedSound(sound);
        setReplyTo(reply);
      }
      return;
    }

    // Вложения: каждое едет своим сообщением, но выбранные разом получают
    // общий album_id и показываются как одно — фото, видео и музыка вместе.
    // Больше ALBUM_MAX за раз не кладём: остальное уходит следующим
    // сообщением, иначе пузырь превращается в простыню.
    const ALBUM_MAX = 10;
    const chunks: Attach[][] = [];
    for (let i = 0; i < list.length; i += ALBUM_MAX) chunks.push(list.slice(i, i + ALBUM_MAX));
    const jobs = chunks.flatMap((chunk, ci) => {
      const albumId = chunk.length > 1 ? (crypto.randomUUID?.() || `alb-${Date.now()}-${ci}`) : null;
      return chunk.map((att, k) => {
      const i = ci * ALBUM_MAX + k;
      const first = i === 0;
      const tempId = `pending-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`;
      const optimistic: Message = {
        id: tempId,
        content: first ? (text || null) : null,
        file_url: att.url,
        file_name: att.file.name,
        sender_id: userId,
        sender: { id: userId } as Profile,
        created_at: new Date(Date.now() + i).toISOString(),
        sound: first ? sound : null,
        download_only: att.mode === "file",
        album_id: albumId,
        reply_to: first && reply
          ? { id: reply.id, sender_username: reply.sender?.username || "", preview: replyPreviewText(reply) }
          : null,
        pending: true,
        _key: tempId,
        _dims: att.dims ?? null,
        _progress: 0,
        _att: att,
      };
      return { tempId, att, optimistic, content: first ? text : "", soundId: first ? sound?.id : undefined, replyId: first ? reply?.id : undefined, albumId };
      });
    });

    for (const j of jobs) outbox.put(chatId, j.optimistic as any);
    setMessages(prev => [...prev, ...jobs.map(j => j.optimistic)]);
    setTimeout(() => scrollToBottom(true), 50);

    for (const j of jobs) {
      await sendAttachment(j.tempId, j.att, { content: j.content, soundId: j.soundId, replyId: j.replyId, albumId: j.albumId });
    }
  };

  /** Загрузка и отправка одного вложения; повтор после ошибки — та же функция. */
  const sendAttachment = async (
    tempId: string,
    att: Attach,
    opts: { content?: string; soundId?: string; replyId?: string; albumId?: string | null } = {},
  ) => {
    if (!chatId) return;
    // Чат запоминаем на старте: пока идёт загрузка, человек мог перейти в
    // другой — отправлять нужно туда, откуда выбирали файл.
    const forChat = chatId;
    outbox.patch(forChat, tempId, { _failed: false, _progress: 0 });
    setMessages(prev => prev.map(m => (m.id === tempId ? { ...m, _failed: false, _progress: 0 } : m)));
    try {
      const compress = att.mode === "video" ? "video" : undefined;
      applog.info(`attach upload start ${att.mode} ${Math.round(att.file.size / 1024)}KB`);
      const uploadResult = await api.uploadFile(att.file, compress, (p) => setProgressFor(tempId, p, forChat));
      applog.info(`attach upload ok ${att.mode} → ${uploadResult.file_url ? "url" : "no url"}`);
      setProgressFor(tempId, 100, forChat);
      // Свою картинку рисуем из локального файла и после подтверждения —
      // сервер нужен только собеседнику.
      if (att.url && uploadResult.file_url) localImagesRef.current.set(uploadResult.file_url, att.url);
      const sent = await api.sendMessageWithFile(forChat, {
        file_url: uploadResult.file_url,
        file_name: uploadResult.file_name,
        file_size: uploadResult.file_size,
        width: uploadResult.width ?? att.dims?.w,
        height: uploadResult.height ?? att.dims?.h,
        album_id: opts.albumId ?? null,
      }, opts.content || undefined, opts.soundId, opts.replyId, att.mode === "file");
      // Подменяем временное сообщение настоящим, сохранив ключ рендера и
      // размеры — DOM не перемонтируется, картинка не мигает. Если
      // синхронизация уже принесла это сообщение по сокету/опросу — просто
      // убираем временный пузырь, чтобы не было дубля.
      outbox.drop(forChat, tempId);
      setMessages(prev =>
        prev.some(m => m.id === sent.id)
          ? prev.filter(m => m.id !== tempId)
          : prev.map(m => (m.id === tempId ? { ...m, ...sent, pending: false, _key: tempId, _dims: att.dims ?? null, _progress: null, _att: undefined } : m))
      );
    } catch (error: any) {
      console.error("Error sending attachment:", error);
      // Пузырь остаётся с «Повторить» — выбранный файл не теряется.
      toast.error("Не удалось отправить — нажми «Повторить»");
      outbox.patch(forChat, tempId, { _failed: true, _progress: null });
      setMessages(prev => prev.map(m => (m.id === tempId ? { ...m, _failed: true, _progress: null } : m)));
    }
  };

  // Открыли чат, где что-то ещё грузится (начали и ушли) — показываем эти
  // пузыри с прогрессом и дальше следим за ними. Файлы в очереди живут, пока
  // приложение открыто.
  useEffect(() => {
    if (!chatId) return;
    const sync = () => setMessages(prev => mergePending(prev, outbox.forChat(chatId) as any));
    sync();
    return outbox.subscribe((changed) => { if (changed === chatId) sync(); });
  }, [chatId]);

  const startLongPress = (message: Message) => {
    if (longPressRef.current) clearTimeout(longPressRef.current);
    longPressRef.current = setTimeout(() => {
      // Клавиатура закрывает нижнюю половину экрана, и меню сообщения
      // («Ответить», «Редактировать», «Переслать») оказывалось за ней.
      hideKeyboard();
      setMenuPos(null);
      setMenuMessage(message);
    }, 450);
  };

  const cancelLongPress = () => {
    if (longPressRef.current) clearTimeout(longPressRef.current);
    longPressRef.current = null;
  };

  const searchPeople = async (query: string) => {
    setAddQuery(query);
    if (!query.trim()) {
      setAddResults([]);
      return;
    }
    try {
      const found = await api.searchUsers(query);
      setAddResults(Array.isArray(found) ? found : []);
    } catch {
      setAddResults([]);
    }
  };

  const addParticipant = async (person: Profile) => {
    if (!chatId || adding) return;
    setAdding(true);
    try {
      await api.addChatParticipants(chatId, [person.id]);
      toast.success(`${person.username} в чате`);
      setAddOpen(false);
      setAddQuery("");
      setAddResults([]);
    } catch {
      toast.error("Не удалось добавить");
    } finally {
      setAdding(false);
    }
  };

  const copyMessage = async (message: Message) => {
    const text = message.content?.trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Скопировано");
    } catch {
      toast.error("Не удалось скопировать");
    }
    closeMenu();
  };

  // Отправка готовой записи (голос/видео) на сервер.
  // Расшифровка голосового: ставим pending сразу, сервер вернёт то же; текст
  // приедет через sync по updated_at (опрос раз в 3 с) — отдельно ждать не надо.
  const transcribeVoice = async (m: Message) => {
    setMessages(prev => prev.map(x => (x.id === m.id ? { ...x, transcript_status: "pending" } : x)));
    try {
      const upd = await api.transcribeVoice(m.id);
      setMessages(prev => prev.map(x => (x.id === m.id ? { ...x, ...upd, _key: x._key, _dims: x._dims } : x)));
    } catch {
      setMessages(prev => prev.map(x => (x.id === m.id ? { ...x, transcript_status: "error" } : x)));
      toast.error("Не удалось расшифровать");
    }
  };

  const processRecording = async (result: VoiceRecording | null) => {
    if (!result || !chatId) return;
    // Пузырь с записью появляется сразу, из локального blob, с прогрессом
    // загрузки — как у текста и файлов. Раньше до ответа сервера в ленте
    // ничего не было, и голосовое выглядело неотправленным.
    const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const localUrl = URL.createObjectURL(result.file);
    const mirror = facing === "user";
    const optimistic: Message = {
      id: tempId,
      content: null,
      file_url: null,
      file_name: null,
      sender_id: userId,
      sender: { id: userId } as Profile,
      created_at: new Date().toISOString(),
      ...(result.kind === "video"
        ? { video_url: localUrl, video_duration: result.seconds, video_mirror: mirror }
        : { voice_url: localUrl, voice_duration: result.seconds }),
      pending: true,
      _key: tempId,
      _progress: 0,
      _rec: { ...result, mirror },
    };
    setMessages(prev => [...prev, optimistic]);
    lastSendTimeRef.current = Date.now();
    setTimeout(() => scrollToBottom(true), 50);
    void playSfx("/sounds/send.mp3", { volume: 0.3 });
    await sendRecording(tempId, { ...result, mirror });
  };

  /** Отправка записи из пузыря tempId; повтор после ошибки — та же функция. */
  const sendRecording = async (tempId: string, result: VoiceRecording & { mirror: boolean }) => {
    if (!chatId) return;
    setUploading(true);
    const isVideo = result.kind === "video";
    const mirror = result.mirror;
    setMessages(prev => prev.map(m => (m.id === tempId ? { ...m, _failed: false, _progress: 0 } : m)));
    try {
      let sent: Message;
      if (isVideo) {
        applog.info(`recording upload start video ${Math.round(result.file.size / 1024)}KB`);
        const uploaded = await api.uploadFile(result.file, undefined, (p) => setProgressFor(tempId, p));
        applog.info("recording upload ok video");
        setProgressFor(tempId, 100);
        // Фронтальная камера снимается в зеркальном (селфи) виде — помечаем,
        // чтобы воспроизведение в чате отразилось так же. Сам файл не меняем.
        sent = await api.sendMessageWithVideo(chatId, uploaded.file_url, result.seconds, mirror);
      } else {
        const uploaded = await api.uploadVoice(result.file, (p) => setProgressFor(tempId, p));
        setProgressFor(tempId, 100);
        sent = await api.sendMessageWithVoice(chatId, uploaded.file_url, result.seconds);
      }
      setMessages(prev =>
        prev.some(m => m.id === sent.id)
          ? prev.filter(m => m.id !== tempId)
          : prev.map(m => (m.id === tempId ? { ...m, ...sent, pending: false, _key: tempId, _progress: null } : m))
      );
    } catch {
      // Пузырь и запись остаются — можно повторить, когда сеть вернётся.
      toast.error("Не удалось отправить — нажми «Повторить»");
      setMessages(prev => prev.map(m => (m.id === tempId ? { ...m, _failed: true, _progress: null } : m)));
    } finally {
      setUploading(false);
    }
  };

  const discardFailed = (m: Message) => {
    if (chatId) outbox.drop(chatId, m.id);
    setMessages(prev => prev.filter(x => x.id !== m.id));
    const u = m.video_url || m.voice_url || m.file_url;
    if (u && u.startsWith("blob:")) URL.revokeObjectURL(u);
  };

  // Ключевое: устройство (микрофон/камеру) захватываем ТОЛЬКО когда кнопку
  // реально удержали дольше порога. Короткий тап переключает режим и к
  // getUserMedia вообще не обращается — раньше тап каждый раз захватывал и тут
  // же отпускал устройство, отсюда лаги и случайное «нет доступа».
  const HOLD_MS = 220;
  const beginRecording = (e: React.PointerEvent) => {
    if (uploading) return;
    pressStartedAtRef.current = Date.now();
    // Забираем указатель себе: иначе движение пальца уходит странице как
    // прокрутка, событие обрывается, и жест отмены не срабатывает.
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    holdStartRef.current = { x: e.clientX, y: e.clientY };
    cancelArmedRef.current = false;
    setCancelArmed(false);
    startedRef.current = false;
    stopRequestedRef.current = false;

    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    // Р.Ё.В: держим — у собеседника вибрирует. Ни микрофон, ни камера не
    // нужны, поэтому отдельная короткая ветка.
    if (recordKind === "rov") {
      holdTimerRef.current = setTimeout(() => {
        startedRef.current = true;
        setRoving(true);
        onRov?.(true);
      }, HOLD_MS);
      return;
    }
    holdTimerRef.current = setTimeout(async () => {
      startingRef.current = true;
      const ok = await startRec(recordKind as RecordKind, facing);
      startingRef.current = false;
      if (!ok) {
        toast.error(recordKind === "video" ? "Нет доступа к камере" : "Нет доступа к микрофону");
        return;
      }
      startedRef.current = true;
      // Палец отпустили ещё во время инициализации устройства — завершаем
      // запись сразу, как только она стартовала.
      if (stopRequestedRef.current) {
        startedRef.current = false;
        const result = await stopRec(cancelArmedRef.current);
        await processRecording(result);
      }
    }, HOLD_MS);
  };

  const moveRecording = (e: React.PointerEvent) => {
    const from = holdStartRef.current;
    if (!from) return;
    // Увод влево или вверх — жест отмены, как в мессенджерах.
    const armed = from.x - e.clientX > 70 || from.y - e.clientY > 70;
    cancelArmedRef.current = armed;
    setCancelArmed(armed);
  };

  const finishRecording = async (forceCancel = false) => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    const cancel = forceCancel || cancelArmedRef.current;
    holdStartRef.current = null;

    // Устройство ещё захватывается — попросим завершить сразу после старта.
    if (startingRef.current && !startedRef.current) {
      stopRequestedRef.current = true;
      if (forceCancel) cancelArmedRef.current = true;
      return;
    }

    // Р.Ё.В: отпустили — вибрация у собеседника гаснет.
    if (recordKind === "rov") {
      cancelArmedRef.current = false;
      setCancelArmed(false);
      if (startedRef.current) {
        startedRef.current = false;
        setRoving(false);
        onRov?.(false);
      } else if (!forceCancel) {
        setRecordKind((k) => MODES[(MODES.indexOf(k) + 1) % MODES.length]);
      }
      return;
    }

    // Запись так и не началась → это был тап: переключаем режим (если не отмена).
    if (!startedRef.current) {
      cancelArmedRef.current = false;
      setCancelArmed(false);
      if (!forceCancel) setRecordKind((k) => MODES[(MODES.indexOf(k) + 1) % MODES.length]);
      return;
    }

    startedRef.current = false;
    cancelArmedRef.current = false;
    setCancelArmed(false);
    const result = await stopRec(cancel);
    await processRecording(result);
  };


  // Объектные URL живут до конца сессии страницы — освобождаем при уходе
  // из чата, чтобы память не копилась от фотографий.
  useEffect(() => {
    const map = localImagesRef.current;
    return () => {
      map.forEach((url) => URL.revokeObjectURL(url));
      map.clear();
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
      soundStopRef.current?.();
    };
  }, []);

  // Функция для форматирования времени
  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString("ru-RU", { 
      hour: "2-digit", 
      minute: "2-digit" 
    });
  };

  // Функция для проверки, нужно ли показывать дату между сообщениями
  const shouldShowDate = (currentMsg: Message, previousMsg: Message | null) => {
    if (!previousMsg) return true;
    
    const currentDate = new Date(currentMsg.created_at).toDateString();
    const previousDate = new Date(previousMsg.created_at).toDateString();
    
    return currentDate !== previousDate;
  };

  const safeHost = (u: string) => { try { return new URL(u).host; } catch { return "?"; } };

  // Функция для сохранения файла локально (для Electron)
  const handleSaveFile = async (fileUrl: string, fileName: string) => {
    // Проверяем, запущено ли приложение в Electron
    if (typeof window !== 'undefined' && window.electronAPI?.saveFile) {
      try {
        const result = await window.electronAPI.saveFile(fileUrl, fileName);
        if (result.success) {
          toast.success('Файл сохранен');
        } else if (result.canceled) {
          // Пользователь отменил сохранение - ничего не делаем
        } else {
          toast.error('Ошибка сохранения файла: ' + (result.error || 'Неизвестная ошибка'));
        }
      } catch (error) {
        console.error('Error saving file:', error);
        toast.error('Ошибка сохранения файла');
      }
    } else if (Capacitor.isNativePlatform()) {
      // Телефон: подписанная ссылка на чужой origin. window.open — Capacitor
      // отдаёт такой URL системному браузеру, а тот качает через свой менеджер
      // загрузок; <a download> в WebView не делает ничего. Так же поступают
      // сохранёнки и каналы.
      applog.info(`file save native ${safeHost(fileUrl)} ${fileName}`);
      window.open(fileUrl, "_blank");
    } else {
      // Веб: скачать через ссылку с download.
      applog.info(`file save web ${safeHost(fileUrl)} ${fileName}`);
      const link = document.createElement('a');
      link.href = fileUrl;
      link.download = fileName;
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  // Функция для форматирования даты
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return "Сегодня";
    } else if (date.toDateString() === yesterday.toDateString()) {
      return "Вчера";
    } else {
      return date.toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "long",
        year: "numeric"
      });
    }
  };

  if (!chatId) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="w-20 h-20 bg-gradient-primary rounded-3xl mx-auto mb-4 flex items-center justify-center shadow-glow">
            <Send className="w-10 h-10 text-primary-foreground" />
          </div>
          <h3 className="text-xl font-semibold mb-2">Выберите чат</h3>
          <p className="text-muted-foreground">
            Выберите существующий чат или создайте новый
          </p>
        </div>
      </div>
    );
  }

  // Пункты меню сообщения — общий список для шторки и компактного меню.
  const menuItems = menuMessage
    ? [
        { label: "Ответить", show: true, onClick: () => { setReplyTo(menuMessage); closeMenu(); } },
        { label: "Переслать", show: !menuMessage.pending, onClick: () => { setForwardQuery(""); setForwardFor(menuMessage); closeMenu(); } },
        { label: "В избранное", show: !saved && !menuMessage.pending, onClick: () => toSaved(menuMessage) },
        { label: pinned?.id === menuMessage.id ? "Открепить" : "Закрепить", show: !menuMessage.pending, onClick: () => togglePin(menuMessage, pinned?.id !== menuMessage.id) },
        { label: "Копировать текст", show: !!menuMessage.content?.trim(), onClick: () => copyMessage(menuMessage) },
        { label: "Редактировать", show: menuMessage.sender?.id === userId && !!menuMessage.content?.trim(), onClick: () => startEdit(menuMessage) },
        { label: "Пожаловаться", show: menuMessage.sender?.id !== userId && !menuMessage.pending, onClick: () => { setReportFor(menuMessage); closeMenu(); } },
        { label: "Удалить у себя", show: true, onClick: () => startDelete(menuMessage, "me") },
        { label: "Удалить у всех", show: menuMessage.sender?.id === userId, danger: true, onClick: () => startDelete(menuMessage, "all") },
      ].filter((i) => i.show)
    : [];

  // Соседние сообщения одного альбома показываем одной сеткой: группу рисуем
  // на первом её сообщении, остальные из ленты убираем.
  const visibleMessages = messages.filter((m) => !hiddenIds.has(m.id));
  const albumsById = new Map<string, Message[]>();
  for (const m of visibleMessages) {
    if (!m.album_id) continue;
    const list = albumsById.get(m.album_id) || [];
    list.push(m);
    albumsById.set(m.album_id, list);
  }
  const albumTail = new Set<string>();
  albumsById.forEach((list) => list.slice(1).forEach((m) => albumTail.add(m.id)));
  const feedRows = visibleMessages.filter((m) => !albumTail.has(m.id));

  return (
    <div className="flex-1 flex flex-col bg-background min-w-0 min-h-0 relative" onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      {dragOver && (
        <div className="absolute inset-2 z-40 rounded-xl border-2 border-dashed border-primary bg-background/80 flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <Paperclip className="w-8 h-8 mx-auto text-primary" />
            <p className="mt-2 text-body font-semibold">Отпусти — отправлю в чат</p>
            <p className="text-small text-subtle">картинка уйдёт как фото, видео — как видео, остальное — файлом</p>
          </div>
        </div>
      )}
      {(onBack || title || peer || isGroup) && (
        <div className="shrink-0 flex items-center gap-2 md:gap-3 px-3 md:px-7 py-2 pad-safe-top border-b border-border bg-background min-h-14 md:min-h-[84px]">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="p-2 -ml-2 text-foreground active:text-primary md:hidden"
              aria-label="Назад"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          )}
          {peer ? (
            <button
              type="button"
              onClick={() => setProfileOpen(true)}
              className="flex items-center gap-3 flex-1 min-w-0 text-left"
              title="Профиль собеседника"
            >
              <Identicon id={peer.id} avatarUrl={peer.avatar_url} className="w-10 h-10 md:w-11 md:h-11" />
              <span className="min-w-0 flex flex-col">
                <span className="text-h1 truncate leading-tight">{headerTitle || peer.username || "Чат"}</span>
                <span className="text-small text-muted-foreground truncate">@{peer.username}</span>
              </span>
            </button>
          ) : isGroup ? (
            <button
              type="button"
              onClick={() => setGroupOpen(true)}
              className="flex items-center gap-3 flex-1 min-w-0 text-left"
              title="Настройки группы"
            >
              {group?.avatar_url ? (
                <img src={mediaUrl(group.avatar_url)} alt="" className="w-10 h-10 rounded-md object-cover shrink-0" />
              ) : (
                <span className="w-10 h-10 rounded-full bg-surface-3 flex items-center justify-center shrink-0"><Users className="w-5 h-5 text-primary" /></span>
              )}
              <span className="min-w-0 flex flex-col">
                <span className="text-h1 truncate leading-tight">{headerTitle || group?.name || "Группа"}</span>
                <span className="text-small text-muted-foreground truncate">Группа</span>
              </span>
            </button>
          ) : (
            <span className="flex items-center gap-3 flex-1 min-w-0">
              {saved && <span className="w-10 h-10 rounded-full bg-surface-3 flex items-center justify-center shrink-0"><Bookmark className="w-5 h-5 text-amber" /></span>}
              <span className="min-w-0 flex flex-col">
                <span className="text-h1 truncate leading-tight">{headerTitle || "Чат"}</span>
                {saved && <span className="text-small text-muted-foreground truncate">Сообщения для себя</span>}
              </span>
            </span>
          )}
          {!isGroup && !saved && (
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="p-2 text-foreground active:text-primary"
              aria-label="Добавить участников"
            >
              <UserPlus className="w-5 h-5" />
            </button>
          )}
          {onCall && !saved && (peer || isGroup) && (
            <button
              type="button"
              onClick={onCall}
              className="p-2 text-foreground active:text-primary"
              aria-label="Позвонить"
            >
              <Phone className="w-5 h-5" />
            </button>
          )}
          {(peer || isGroup) && (
            <button
              type="button"
              onClick={() => (peer ? setProfileOpen(true) : setGroupOpen(true))}
              className="p-2 -mr-2 text-foreground active:text-primary"
              aria-label={peer ? "Профиль" : "Настройки группы"}
            >
              <MoreVertical className="w-5 h-5" />
            </button>
          )}
        </div>
      )}
      {/* Лента и полоса закрепления в одном слое: полоса лежит ПОВЕРХ
          переписки и не меняет её высоту — раньше её появление укорачивало
          ленту уже после доводки, и сообщения дёргались. */}
      <div className="relative flex-1 min-h-0 flex flex-col">
      {jumping && (
        <div className="absolute top-0 left-0 right-0 z-30 h-0.5 bg-primary/30 overflow-hidden" aria-hidden>
          <div className="h-full w-1/3 bg-primary animate-[msg-in_0.9s_ease-in-out_infinite_alternate]" />
        </div>
      )}
            {/* Закреплённое: тап — к сообщению, крестик — открепить. */}
      {pinned && (
        <div className="absolute top-0 left-0 right-0 z-20 flex items-center gap-3 px-4 md:px-7 py-1.5 border-b border-border bg-surface-1/95 backdrop-blur-sm">
          <Pin className="w-5 h-5 text-primary shrink-0" />
          <button type="button" onClick={() => jumpToMessage(pinned.id)} disabled={jumping} className="flex-1 min-w-0 text-left disabled:opacity-60">
            <span className="block text-small text-primary leading-tight">Закреплено · {pinned.sender_username}</span>
            <span className="block text-body line-clamp-1 break-all">{pinned.preview}</span>
          </button>
          <button
            type="button"
            onClick={() => { const m = messages.find((x) => x.id === pinned.id); m ? togglePin(m, false) : api.pinMessage(pinned.id, false).then(() => setPinned(null)).catch(() => toast.error("Не удалось")); }}
            className="p-1.5 text-muted-foreground"
            aria-label="Открепить"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {/* Нативный overflow-скролл вместо Radix ScrollArea: min-h-0 позволяет
          ленте ужиматься меньше содержимого (иначе большие сообщения выталкивают
          поле ввода за экран), а scrollTop работает напрямую. */}
      <div
        ref={scrollRef}
        onScroll={onFeedScroll}
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain chat-scroll px-3 md:px-7 py-4 md:py-6"
        onTouchStart={(e) => { feedTouchRef.current = true; markUserScroll(); kbSwipeRef.current = { y: e.touches[0].clientY, done: false }; }}
        onTouchMoveCapture={markUserScroll}
        onWheel={markUserScroll}
        onKeyDown={markUserScroll}
        onTouchEnd={settleAfterTouch}
        onTouchCancel={settleAfterTouch}
        onTouchMove={(e) => {
          // Свайп вниз по ленте при открытой клавиатуре прячет её (как в Telegram).
          const s = kbSwipeRef.current;
          if (!s || s.done || kbShiftRef.current <= 0) return;
          if (e.touches[0].clientY - s.y > 50) { s.done = true; hideKeyboard(); }
        }}
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        <div ref={feedRef} className="max-w-4xl mx-auto space-y-2">
          {hasMore && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => void loadOlder()}
                disabled={loadingOlder}
                className="text-xs text-muted-foreground px-3 py-1 bg-muted/50 rounded-full disabled:opacity-60"
              >
                {loadingOlder ? "Загружаю…" : "Показать более ранние"}
              </button>
            </div>
          )}
          {feedRows.map((message, index) => {
            const isOwn = message.sender?.id === userId;
            // Ссылка на пак или тему разворачивается карточкой (PackLinkCard),
            // и в тексте её уже не показываем.
            const packLink = (message.content || "").match(/https?:\/\/\S+/g)?.find((u) => packLinkKind(u)) || null;
            const shownText = packLink
              // Схлопываем пробелы, оставшиеся от вырезанной ссылки, но переносы строк храним.
              ? (message.content || "").replace(packLink, "").replace(/[ \t]{2,}/g, " ").trim()
              : (message.content || "");
            // Альбом: несколько фото/видео одной отправки склеены в сетку —
            // рисуем их на первом сообщении группы, остальные пропущены выше.
            const album = message.album_id ? albumsById.get(message.album_id) : undefined;
            const isAlbum = !!album && album.length > 1;
            // В альбоме может быть что угодно: картинки и видео идут сеткой,
            // музыка и файлы — строками под ней, всё в одном пузыре.
            const albumMedia = isAlbum ? album!.filter((m) => !m.download_only && (isImageFile(m.file_name, m.file_url) || isVideoFile(m.file_name, m.file_url)) && !isAudioFile(m.file_name, m.file_url)) : [];
            const albumAudio = isAlbum ? album!.filter((m) => isAudioFile(m.file_name, m.file_url)) : [];
            const albumRest = isAlbum ? album!.filter((m) => !albumMedia.includes(m) && !albumAudio.includes(m)) : [];
            const hasImage =
              !!message.file_url &&
              !message.download_only &&
              isImageFile(message.file_name, message.file_url) &&
              !imageLoadErrors.has(message.id);
            // Картинка без текста — сама себе пузырь: без цветной рамки-паспарту,
            // которая раздувала сообщение на пол-экрана.
            const imageOnly = (hasImage || (isAlbum && !albumAudio.length && !albumRest.length)) && !message.content && !message.sticker?.file_url && !message.sound;
            // Видео-«треугольник» без текста/цитаты — тоже без прямоугольного
            // пузыря: обводку несёт сам треугольник (см. VideoNote).
            const videoOnly = !!message.video_url && !message.content && !message.sticker?.file_url && !message.sound && !message.reply_to;
            const bareBubble = imageOnly || videoOnly;
            const previousMessage = index > 0 ? feedRows[index - 1] : null;
            const showDate = shouldShowDate(message, previousMessage);
            const username = message.sender?.username || "Неизвестный";
            // Серия одного автора идёт плотно (8 px), смена автора или даты — 16 px.
            const sameAuthor = !!previousMessage && !showDate && previousMessage.sender?.id === message.sender?.id;
            // Хвостик — только у последнего сообщения в серии, как в Telegram.
            const nextMessage = index < messages.length - 1 ? messages[index + 1] : null;
            const lastInGroup = !nextMessage || nextMessage.sender?.id !== message.sender?.id || shouldShowDate(nextMessage, message);

            return (
              <div
                key={message._key ?? message.id}
                id={`msg-${message.id}`}
                className={cn("space-y-2", !sameAuthor && index > 0 && "!mt-4", (message._key || freshIds.has(message.id)) && "msg-in")}
              >
                {/* Разделитель с датой */}
                {showDate && (
                  <div className="flex justify-center">
                    <div className="bg-surface-3 px-3.5 py-1.5 rounded-full text-small text-foreground">
                      {formatDate(message.created_at)}
                    </div>
                  </div>
                )}

                {/* Сообщение */}
                <div
                  className={cn(
                    "relative flex gap-3 group",
                    isOwn && "flex-row-reverse"
                  )}
                  onPointerDown={(e) => msgPointerDown(e, message)}
                  onPointerMove={(e) => msgPointerMove(e, message, isOwn)}
                  onPointerUp={(e) => msgPointerUp(e, message, isOwn)}
                  onPointerCancel={msgPointerCancel}
                  // pan-y: вертикальную прокрутку оставляем браузеру, горизонтальный
                  // жест — наш. Без этого iOS на первом же миллиметре по вертикали
                  // забирал жест себе и слал pointercancel — строка дёргалась
                  // туда-сюда, а до порога ответа дело не доходило.
                  style={{
                    touchAction: "pan-y",
                    ...(swipe?.id === message.id
                      ? { transform: `translateX(${swipe.dx}px)` }
                      : { transition: "transform 150ms" }),
                  }}
                >
                  {/* Иконка ответа при свайпе */}
                  {swipe?.id === message.id && Math.abs(swipe.dx) > 6 && (
                    <span
                      className={cn(
                        "absolute top-1/2 -translate-y-1/2 text-primary",
                        isOwn ? "left-0 -ml-7" : "right-0 -mr-7"
                      )}
                      style={{ opacity: Math.min(1, Math.abs(swipe.dx) / SWIPE_TRIGGER) }}
                    >
                      <Reply className="w-5 h-5" />
                    </span>
                  )}
                  {/* Аватар (только для чужих сообщений) */}
                  {!isOwn && (
                    <Identicon
                      id={message.sender?.id || "?"}
                      avatarUrl={message.sender?.avatar_url}
                      className="w-9 h-9"
                    />
                  )}

                  {/* Контент сообщения */}
                  <div className={cn(
                    "flex flex-col max-w-[72%] sm:max-w-[65%] md:max-w-[55%]",
                    isOwn ? "items-end" : "items-start"
                  )}>
                    {/* Имя отправителя (только для чужих сообщений) */}
                    {!isOwn && (
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-small font-semibold text-foreground">
                          {username}
                        </span>
                      </div>
                    )}

                    {/* Буббл сообщения */}
                    <div
                      onContextMenu={(e) => {
                        // На десктопе правая кнопка открывает компактное меню
                        // прямо у курсора (позиция → menuPos).
                        e.preventDefault();
                        hideKeyboard();
                        setMenuMessage(message);
                        setMenuPos({ x: e.clientX, y: e.clientY });
                      }}
                      onClick={() => {
                        if (justSwipedRef.current) return;
                        if (message.sound?.url) toggleSticker(message.id, message.sound.url);
                      }}
                      className={cn(
                      "relative",
                      !bareBubble && "px-4 py-3 rounded-lg",
                      // Цвета пузырей — переменные темы (--bubble-own/-in и их
                      // -fg, см. msg-own/msg-peer в index.css): текст внутри
                      // наследуется, поэтому тема может сделать пузырь и тёмным,
                      // и светлым. Хвостик — bubble-own/bubble-in.
                      !bareBubble &&
                        (isOwn
                          ? cn("msg-bubble msg-own", lastInGroup && "bubble-own")
                          : cn("msg-bubble msg-peer", lastInGroup && "bubble-in"))
                    )}>
                      {/* Цитируемое сообщение (реплай). */}
                      {/* Пересланное: от кого пришло изначально. */}
                      {(message.forwarded_title || message.forwarded_from) && (
                        <div className="mb-1 flex items-center gap-1 text-xs opacity-80 min-w-0">
                          <Forward className="w-3 h-3 shrink-0" />
                          <span className="line-clamp-1 break-all">
                            Переслано от {message.forwarded_from?.username || message.forwarded_title}
                          </span>
                        </div>
                      )}

                      {/* Цитата в одну строку через line-clamp, а не truncate:
                          nowrap делал минимальную ширину пузыря равной всей
                          длине цитаты, и длинный реплай уезжал за край экрана. */}
                      {message.reply_to && (
                        <div
                          role="button"
                          title="К цитируемому сообщению"
                          onClick={(e) => { e.stopPropagation(); jumpToMessage(message.reply_to!.id); }}
                          className={cn(
                            "mb-1 rounded px-2 py-1 border-l-2 text-xs min-w-0 max-w-full cursor-pointer active:bg-black/20",
                            isOwn
                              ? "border-primary-foreground/60 bg-black/10"
                              : "border-success-foreground/60 bg-black/10"
                          )}
                        >
                          <div className="font-medium line-clamp-1 break-all opacity-90">
                            {message.reply_to.sender_username}
                          </div>
                          <div className="line-clamp-1 break-all opacity-75">
                            {message.reply_to.preview}
                          </div>
                        </div>
                      )}

                      {/* Аудио-стикер: тап — проиграть, повторный/любой тап — стоп. */}
                      {message.sound && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); toggleSticker(message.id, message.sound!.url); }}
                          className={cn(
                            "flex items-center gap-1.5 text-xs mb-1 px-2 py-1 rounded-full transition-colors",
                            playingSoundId === message.id ? "bg-black/25" : "bg-black/10"
                          )}
                        >
                          {playingSoundId === message.id
                            ? <Pause className="w-3.5 h-3.5" />
                            : <Play className="w-3.5 h-3.5" />}
                          <Music2 className="w-3 h-3" />
                          {message.sound.name}
                        </button>
                      )}

                      {/* Стикер: показываем картинкой без фона пузыря — так же,
                          как это выглядит в мессенджерах. */}
                      {message.sticker?.file_url && (
                        <StickerView url={message.sticker.file_url} alt={message.sticker.emoji || "Стикер"} className="w-32 h-32 object-contain" />
                      )}

                      {/* Видео-сообщение: треугольник вершиной вверх */}
                      {message.video_url && (
                        <VideoNote
                          url={message.video_url}
                          seconds={message.video_duration || 0}
                          own={isOwn}
                          mirror={message.video_mirror}
                        />
                      )}

                      {/* Голосовое сообщение */}
                      {message.voice_url && (
                        <div>
                          <div className="flex items-center gap-1">
                            <VoiceBubble
                              url={mediaUrl(message.voice_url)}
                              seconds={message.voice_duration || 0}
                              own={isOwn}
                            />
                            {/* «Аа» — расшифровать; пока pending крутится, готовый текст ниже. */}
                            {!message.pending && message.transcript_status !== "done" && (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); transcribeVoice(message); }}
                                disabled={message.transcript_status === "pending"}
                                className="w-8 h-8 shrink-0 rounded-md bg-black/20 text-xs font-semibold disabled:opacity-50"
                                title="Расшифровать"
                              >
                                {message.transcript_status === "pending" ? "…" : "Аа"}
                              </button>
                            )}
                          </div>
                          {message.transcript_status === "pending" && (
                            <p className="mt-1 text-xs opacity-70">Расшифровываю…</p>
                          )}
                          {message.transcript_status === "error" && (
                            <p className="mt-1 text-xs opacity-70">Не удалось расшифровать — попробуй ещё раз.</p>
                          )}
                          {message.transcript_status === "done" && message.voice_transcript && (
                            <p className="mt-1.5 text-body break-words whitespace-pre-wrap opacity-90 border-t border-white/15 pt-1.5">
                              {message.voice_transcript}
                            </p>
                          )}
                        </div>
                      )}

                      {/* Карточка пака или темы: ссылка из переписки
                          разворачивается в плитку с кнопкой «Добавить себе».
                          Саму ссылку из текста убираем — длинный адрес рядом с
                          карточкой только загромождал пузырь. */}
                      {packLink && <PackLinkCard url={packLink} own={isOwn && !bareBubble} />}

                      {/* Текст сообщения */}
                      {message.content && (
                        <p className="text-body break-words whitespace-pre-wrap">
                          <Linkify text={shownText} />
                          {/* У своих время и галочки внутри пузыря, в конце текста. */}
                          {isOwn && !bareBubble && (
                            <span className="float-right ml-3 mt-1 inline-flex items-center gap-1 text-caption opacity-70 whitespace-nowrap">
                              {message.is_edited ? "изм. " : ""}{formatTime(message.created_at)}
                              {message.pending ? <Check className="w-3.5 h-3.5" /> : <CheckCheck className="w-3.5 h-3.5" />}
                            </span>
                          )}
                        </p>
                      )}

                      {/* Файл */}
                      {isAlbum ? (
                        <div className={cn(!imageOnly && "mt-2", "space-y-1.5")}>
                          {albumMedia.length > 0 && (
                          <AlbumGrid
                            items={albumMedia.map((m) => ({
                              id: m.id,
                              raw: m.file_url || "",
                              name: m.file_name ?? null,
                              dims: m._dims || dimsOf(m.file_width, m.file_height),
                              pending: m.pending,
                              progress: m._progress ?? null,
                              failed: m._failed,
                            }))}
                            localMap={localImagesRef.current}
                            onOpen={(_url, _name, id) => openViewer(id)}
                          />
                          )}
                          {albumAudio.map((m) => (
                            <MessageAudioFile key={m.id} raw={m.file_url as string} name={m.file_name ?? null}
                              isOwn={isOwn} onSave={handleSaveFile} onPlay={() => playAudioFrom(m)} />
                          ))}
                          {albumRest.map((m) => (
                            <MessageFile key={m.id} raw={m.file_url as string} name={m.file_name ?? null}
                              isOwn={isOwn} onSave={handleSaveFile} />
                          ))}
                        </div>
                      ) : message.file_url && (
                        <div className={cn(!imageOnly && "mt-2")}>
                          {hasImage ? (
                            <MessageImage
                              raw={message.file_url}
                              name={message.file_name}
                              dims={message._dims || dimsOf(message.file_width, message.file_height)}
                              localMap={localImagesRef.current}
                              onOpen={() => openViewer(message.id)}
                              onError={() => setImageLoadErrors(prev => new Set(prev).add(message.id))}
                            />
                          ) : isAudioFile(message.file_name, message.file_url) ? (
                            <MessageAudioFile raw={message.file_url} name={message.file_name} isOwn={isOwn} onSave={handleSaveFile} onPlay={() => playAudioFrom(message)} />
                          ) : (!message.download_only && isVideoFile(message.file_name, message.file_url)) ? (
                            <MessageVideoFile raw={message.file_url} dims={dimsOf(message.file_width, message.file_height)} />
                          ) : (
                            <MessageFile
                              raw={message.file_url}
                              name={message.file_name}
                              isOwn={isOwn}
                              onSave={handleSaveFile}
                            />
                          )}
                        </div>
                      )}
                      {/* Не ушло: запись на месте, можно повторить или убрать. */}
                      {message.pending && message._failed && (
                        <div className={cn("mt-1.5 flex items-center gap-3 text-caption", isOwn && !bareBubble ? "opacity-80" : "text-subtle")}>
                          <span className="text-destructive font-medium">Не отправлено</span>
                          {message._rec && (
                            <button type="button" onClick={(e) => { e.stopPropagation(); void sendRecording(message.id, message._rec!); }} className="underline">Повторить</button>
                          )}
                          {message._att && (
                            <button type="button" onClick={(e) => { e.stopPropagation(); void sendAttachment(message.id, message._att!, { content: message.content || undefined, albumId: message.album_id }); }} className="underline">Повторить</button>
                          )}
                          <button type="button" onClick={(e) => { e.stopPropagation(); discardFailed(message); }} className="underline opacity-80">Удалить</button>
                        </div>
                      )}
                      {/* Загрузка вложения: полоска и проценты прямо в пузыре. */}
                      {message.pending && !message._failed && message._progress != null && (
                        <div className={cn("mt-1.5 flex items-center gap-2 text-caption min-w-[96px]", isOwn && !bareBubble ? "opacity-70" : "text-subtle")}>
                          <div className="flex-1 h-1 rounded-full bg-black/20 overflow-hidden">
                            <div className="h-full bg-current transition-[width] duration-150" style={{ width: `${Math.max(3, message._progress)}%` }} />
                          </div>
                          <span className="tabular-nums shrink-0">{message._progress < 100 ? `${message._progress}%` : "отправка…"}</span>
                        </div>
                      )}
                    </div>

                    {/* Время и статус снаружи — у чужих и у пузырей без текста
                        (картинка, треугольник): внутри им негде. */}
                    {(!isOwn || bareBubble || !message.content) && (
                      <div className={cn(
                        "flex items-center gap-1.5 mt-1",
                        isOwn ? "flex-row-reverse" : ""
                      )}>
                        <span className="text-caption text-subtle">
                          {message.is_edited ? "изм. · " : ""}{formatTime(message.created_at)}
                        </span>
                        {isOwn && (
                          message.pending
                            ? <Check className="w-3.5 h-3.5 text-subtle" />
                            : <CheckCheck className="w-3.5 h-3.5 text-primary" />
                        )}
                      </div>
                    )}
                  </div>

                  {/* Аватар для своих сообщений */}
                  {isOwn && <div className="w-8 h-8 flex-shrink-0" />}
                </div>
              </div>
            );
          })}
          {/* Невидимый элемент для прокрутки вниз */}
          <div ref={messagesEndRef} />
        </div>
      </div>

      </div>

      {/* Кнопка «вниз»: появляется, когда лента отлистана вверх; со счётчиком,
          если за это время пришли новые. Сама лента при этом не двигается. */}
      {(awayFromBottom || newBelow > 0) && (
        <div className="relative h-0 z-10">
          <button
            type="button"
            onClick={() => goBottom(true)}
            className="ui-btn absolute right-3 md:right-6 -top-14 w-11 h-11 rounded-full bg-surface-1 border border-border text-foreground shadow-card flex items-center justify-center active:opacity-80"
            aria-label={newBelow > 0 ? `Новых сообщений: ${newBelow}. Вниз` : "Вниз"}
          >
            <ArrowDown className="w-5 h-5" />
            {newBelow > 0 && (
              <span className="absolute -top-2 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-primary text-primary-foreground text-[11px] font-semibold flex items-center justify-center">
                {newBelow > 99 ? "99+" : newBelow}
              </span>
            )}
          </button>
        </div>
      )}

      {/* Поле ввода */}
      <div ref={composeRef} className="chat-compose px-4 py-2 md:px-4 md:pt-2 md:pb-0 pad-safe-bottom bg-surface-2 md:bg-transparent border-t border-border md:border-t-0">
        {/* На десктопе композер — панель с обводкой, как в референсе; отступ снизу
            даём панели (pad-safe-bottom перебивает padding контейнера). */}
        <div className="max-w-4xl mx-auto md:border md:border-border md:rounded-lg md:p-3 md:mb-2">
          {editing && (
            <div className="mb-2 flex items-center gap-2 rounded-lg bg-secondary/50 border-l-2 border-primary px-3 py-2">
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-primary">Редактирование</div>
                <div className="text-sm text-muted-foreground truncate">{editing.content}</div>
              </div>
              <button type="button" onClick={cancelEdit} className="px-1 text-muted-foreground hover:text-foreground" aria-label="Отменить">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
          {replyTo && !editing && (
            <div className="mb-2 flex items-stretch gap-2 rounded-lg bg-secondary/50 border-l-2 border-primary overflow-hidden">
              <div className="flex-1 min-w-0 px-3 py-2">
                <div className="text-xs font-medium text-primary truncate">
                  {replyTo.sender?.username || "Ответ"}
                </div>
                <div className="text-sm text-muted-foreground truncate">
                  {replyPreviewText(replyTo)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setReplyTo(null)}
                className="px-3 text-muted-foreground hover:text-foreground"
                aria-label="Отменить ответ"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
          {undoBar && (
            <div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-foreground text-background px-3 py-2">
              <span className="text-sm">Сообщение удалено</span>
              <button type="button" onClick={undoDelete} className="text-sm font-semibold underline">Отменить</button>
            </div>
          )}
          {attachments.length > 10 && (
            <p className="mb-1 text-caption text-subtle">
              Выбрано {attachments.length} — уйдут по 10 в сообщении
            </p>
          )}
          {attachments.length > 0 && (
            <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
              {attachments.map((a) => (
                <div key={a.id} className="relative shrink-0 w-20 h-20 rounded-lg overflow-hidden bg-secondary border border-border">
                  {a.mode === "photo" ? (
                    <img src={a.url} alt="" className="w-full h-full object-cover" />
                  ) : a.mode === "video" ? (
                    <video src={a.url} muted playsInline className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-1 px-1 text-center">
                      {a.mode === "audio" ? <Music2 className="w-5 h-5 text-primary" /> : <FileText className="w-5 h-5 text-primary" />}
                      <span className="text-[10px] leading-tight text-muted-foreground line-clamp-2 break-all">{a.file.name}</span>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => dropAttachment(a.id)}
                    className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center"
                    aria-label={`Убрать ${a.file.name}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          

          {recording && recordKind === "video" && (
            <div className="mb-2 flex justify-center">
              <LivePreview stream={recStream} dimmed={cancelArmed} facing={facing} />
            </div>
          )}

          {recording && (
            <div className={cn(
              "mb-2 flex items-center gap-3 px-3 py-2 border-2",
              cancelArmed ? "border-primary bg-primary/10" : "border-border bg-secondary/40"
            )}>
              <span className="w-2.5 h-2.5 bg-primary animate-pulse shrink-0" />
              <span className="font-mono text-sm">
                {String(Math.floor(recSeconds / 60)).padStart(2, "0")}:
                {String(recSeconds % 60).padStart(2, "0")}
              </span>
              <span className="text-xs text-muted-foreground flex-1 truncate">
                {cancelArmed
                  ? "Отпустите — запись отменится"
                  : recordKind === "video"
                    ? "Снимаем треугольник · влево для отмены"
                    : "Ведите влево, чтобы отменить"}
              </span>
              {cancelArmed && <Trash2 className="w-4 h-4 text-primary shrink-0" />}
            </div>
          )}

          {/* Р.Ё.В: пока держим кнопку — видно, что идёт вибрация у собеседника. */}
          {roving && (
            <div className="mb-2 flex items-center gap-3 px-3 py-2 border-2 border-primary bg-primary/10">
              <Vibrate className="w-4 h-4 text-primary shrink-0 animate-pulse" />
              <span className="text-xs text-muted-foreground flex-1 truncate">
                Р.Ё.В — держите, у собеседника вибрирует
              </span>
            </div>
          )}

          {stickersOpen && (
            <div className="mb-2 rounded-xl border border-border bg-card overflow-hidden">
              <StickerPicker
                onSelect={async (sticker) => {
                  setStickersOpen(false);
                  try {
                    await api.sendMessageWithSticker(chatId!, sticker.id);
                    await fetchMessages();
                  } catch {
                    toast.error("Не удалось отправить стикер");
                  }
                }}
                sounds={sounds}
                selectedSoundId={selectedSound?.id ?? null}
                onSelectSound={(sound) => setSelectedSound(sound)}
              />
            </div>
          )}

          <div className="flex gap-2 items-end">
            <input ref={photoInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => handlePick(e, "photo")} />
            <input ref={videoInputRef} type="file" accept="video/*" multiple className="hidden" onChange={(e) => handlePick(e, "video")} />
            <input ref={audioInputRef} type="file" accept="audio/*,.mp3,.m4a,.aac,.ogg,.oga,.opus,.wav,.flac" multiple className="hidden" onChange={(e) => handlePick(e, "audio")} />
            <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => handlePick(e, "file")} />

            <div className="relative shrink-0">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setAttachMenuOpen((v) => !v)}
                disabled={uploading}
                className="h-11 w-11 rounded-md bg-surface-2 md:bg-transparent border border-border text-foreground hover:bg-surface-3"
                aria-label="Прикрепить"
              >
                <Paperclip className="w-5 h-5" />
              </Button>
              {attachMenuOpen && (
                <div className="absolute bottom-full left-0 mb-2 w-44 bg-surface-1 border border-border rounded-lg overflow-hidden z-10">
                  <button type="button" className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left active:bg-secondary"
                    onClick={() => { setAttachMenuOpen(false); photoInputRef.current?.click(); }}>
                    <ImageIcon className="w-4 h-4 text-primary" /> Фото
                  </button>
                  <button type="button" className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left active:bg-secondary"
                    onClick={() => { setAttachMenuOpen(false); videoInputRef.current?.click(); }}>
                    <Video className="w-4 h-4 text-primary" /> Видео
                  </button>
                  <button type="button" className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left active:bg-secondary"
                    onClick={() => { setAttachMenuOpen(false); audioInputRef.current?.click(); }}>
                    <Music2 className="w-4 h-4 text-primary" /> Музыка
                  </button>
                  <button type="button" className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left active:bg-secondary"
                    onClick={() => { setAttachMenuOpen(false); fileInputRef.current?.click(); }}>
                    <FileText className="w-4 h-4 text-primary" /> Файл
                  </button>
                </div>
              )}
            </div>

            <Button
              variant="outline"
              size="icon"
              onClick={() => setStickersOpen((v) => !v)}
              className="h-11 w-11 shrink-0 rounded-md bg-surface-2 md:bg-transparent border border-border text-foreground hover:bg-surface-3"
              aria-label="Стикеры"
            >
              <Smile className="w-5 h-5" />
            </Button>

            <div className="flex-1 relative">
              {/* Поле растёт под текст до четырёх строк: раньше это был
                  однострочный input (проп multiline ничего не делал), и
                  длинное сообщение набиралось вслепую. */}
              <textarea
                ref={textareaRef}
                placeholder="Сообщение..."
                value={newMessage}
                rows={1}
                onPaste={onPasteFile}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyDown={(e) => {
                  // На телефоне Enter — перенос строки (отправка кнопкой), на
                  // десктопе — отправка, Shift+Enter — перенос.
                  if (e.key === "Enter" && !e.shiftKey && !isTouchDevice()) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
                disabled={uploading}
                className="w-full resize-none overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden bg-surface-2 md:bg-background border border-border rounded-md px-3.5 py-[11px] text-body focus:outline-none focus:border-amber placeholder:text-muted-foreground"
                style={{ maxHeight: "6.5rem" }}
              />
            </div>
            
            {newMessage.trim() || attachments.length || selectedSound ? (
              <Button
                onClick={sendMessage}
                onPointerDown={(e) => e.preventDefault()}
                disabled={uploading}
                className="h-11 w-11 p-0 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 shrink-0"
                size="icon"
              >
                {uploading ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </Button>
            ) : (
              <>
                {recordKind === "video" && !recording && (
                  <button
                    type="button"
                    onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))}
                    disabled={uploading}
                    className={cn(
                      "h-11 w-11 shrink-0 rounded-md border flex items-center justify-center transition-colors",
                      // Фронтальная активна — плитка инвертирована; задняя — обычная плитка.
                      facing === "user"
                        ? "bg-foreground text-background border-foreground"
                        : "bg-surface-2 text-foreground border-border"
                    )}
                    title={facing === "user" ? "Камера: фронтальная (нажми — задняя)" : "Камера: задняя (нажми — фронтальная)"}
                    aria-label="Переключить камеру"
                    aria-pressed={facing === "user"}
                  >
                    <SwitchCamera className="w-5 h-5" />
                  </button>
                )}
                <button
                  type="button"
                  onPointerDown={beginRecording}
                  onPointerMove={moveRecording}
                  onPointerUp={() => finishRecording()}
                  onPointerCancel={() => finishRecording(true)}
                  disabled={uploading}
                  style={{ touchAction: "none" }}
                  className={cn(
                    "h-11 w-11 shrink-0 md:ml-3 rounded-md flex items-center justify-center transition-colors",
                    recording || roving ? "bg-foreground text-background" : "bg-primary md:bg-primary-deep text-primary-foreground"
                  )}
                  aria-label={
                    recordKind === "video" ? "Записать видео"
                      : recordKind === "rov" ? "Держать — вибрация собеседнику"
                      : "Записать голосовое"
                  }
                  title={
                    recordKind === "video" ? "Видео (тап — Р.Ё.В)"
                      : recordKind === "rov" ? "Р.Ё.В: держи — у собеседника вибрирует (тап — голосовое)"
                      : "Голосовое (тап — видео)"
                  }
                >
                  {recordKind === "video" ? <Video className="w-5 h-5" />
                    : recordKind === "rov" ? <Vibrate className={cn("w-5 h-5", roving && "animate-pulse")} />
                    : <Mic className="w-5 h-5" />}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {addOpen && (
        <div
          className="fixed inset-0 z-[70] bg-black/60 flex items-start justify-center pt-24 px-4"
          onClick={() => setAddOpen(false)}
        >
          <div
            className="w-full max-w-md bg-card border-2 border-border"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-border font-semibold">
              Добавить в чат
            </div>
            <input
              value={addQuery}
              onChange={(e) => searchPeople(e.target.value)}
              placeholder="Имя пользователя"
              className="w-full bg-secondary/50 px-4 py-3 outline-none"
              autoFocus
            />
            <div className="max-h-64 overflow-y-auto">
              {addResults.map((person) => (
                <button
                  key={person.id}
                  type="button"
                  onClick={() => addParticipant(person)}
                  disabled={adding}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-secondary"
                >
                  <Identicon id={person.id} avatarUrl={person.avatar_url} className="w-9 h-9" />
                  <span className="flex-1 truncate">{person.username}</span>
                  <UserPlus className="w-4 h-4 text-muted-foreground" />
                </button>
              ))}
              {addQuery && addResults.length === 0 && (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                  Никого не нашли
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setAddOpen(false)}
              className="w-full px-4 py-3 text-muted-foreground border-t border-border active:bg-secondary"
            >
              Закрыть
            </button>
          </div>
        </div>
      )}

      {/* Компактное меню у курсора (десктоп, правый клик) */}
      {menuMessage && menuPos && (
        <div
          className="fixed inset-0 z-[70]"
          onClick={closeMenu}
          onContextMenu={(e) => { e.preventDefault(); closeMenu(); }}
        >
          <div
            className="fixed min-w-[200px] bg-surface-1 border border-border rounded-lg py-1"
            style={{
              left: Math.max(8, Math.min(menuPos.x, window.innerWidth - 198)),
              top: Math.max(8, Math.min(menuPos.y, window.innerHeight - (menuItems.length * 38 + 16))),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {menuItems.map((it, idx) => (
              <button
                key={idx}
                type="button"
                onClick={it.onClick}
                className={cn(
                  "w-full px-4 py-2 text-left text-sm hover:bg-secondary",
                  it.danger && "text-destructive",
                )}
              >
                {it.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Нижняя шторка (телефон, долгое удержание) */}
      {menuMessage && !menuPos && (() => {
        // Как на референсе: первая карточка — плитки частых действий,
        // вторая — остальные пункты списком, третья — «Отмена».
        const tileIcons: Record<string, React.ReactNode> = {
          "Ответить": <Reply className="w-5 h-5" />,
          "Переслать": <Forward className="w-5 h-5" />,
          "В избранное": <Bookmark className="w-5 h-5" />,
          "Копировать текст": <Copy className="w-5 h-5" />,
        };
        const tiles = menuItems.filter((it) => it.label in tileIcons);
        const rest = menuItems.filter((it) => !(it.label in tileIcons));
        return (
          <div
            className="fixed inset-0 z-[70] bg-black/60 flex items-end"
            onClick={closeMenu}
          >
            <div
              className="w-full p-3 space-y-2 pb-[calc(var(--sab)+12px)]"
              onClick={(e) => e.stopPropagation()}
            >
              {tiles.length > 0 && (
                <div className="bg-surface-1 rounded-lg p-3 flex justify-around">
                  {tiles.map((it, idx) => (
                    <button key={idx} type="button" onClick={it.onClick} className="flex flex-col items-center gap-1.5 w-16 active:opacity-70">
                      <span className="w-11 h-11 rounded-md bg-surface-3 flex items-center justify-center">{tileIcons[it.label]}</span>
                      <span className="text-[11px] leading-tight text-muted-foreground text-center">{it.label === "Копировать текст" ? "Копировать" : it.label}</span>
                    </button>
                  ))}
                </div>
              )}
              {rest.length > 0 && (
                <div className="bg-surface-1 rounded-lg overflow-hidden">
                  {rest.map((it, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={it.onClick}
                      className={cn(
                        "w-full px-4 py-3.5 text-left text-body active:bg-surface-3 border-b border-border last:border-b-0 flex items-center gap-3",
                        it.danger ? "text-primary" : "text-foreground",
                      )}
                    >
                      {it.danger && <Trash2 className="w-5 h-5" />}
                      {it.label}
                    </button>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={closeMenu}
                className="w-full bg-surface-1 rounded-lg px-4 py-3.5 text-body text-center text-foreground active:bg-surface-3"
              >
                Отмена
              </button>
            </div>
          </div>
        );
      })()}

      {groupOpen && group && (
        <GroupSettingsModal
          chatId={group.id}
          isAdmin={isGroupAdmin}
          initialName={headerTitle || group.name || "Группа"}
          initialAvatar={group.avatar_url}
          onClose={() => setGroupOpen(false)}
          onUpdated={(patch) => {
            if (patch.name !== undefined) setHeaderTitle(patch.name);
            onGroupUpdated?.();
          }}
        />
      )}

      {profileOpen && peer && (
        <UserProfileModal
          userId={peer.id}
          onClose={() => setProfileOpen(false)}
          onCall={onCall}
        />
      )}

      {/* Пересылка: выбрать чат. Список приходит из Chat.tsx (там он уже есть),
          «Избранное» — первой строкой. */}
      {reportFor && (
        <ReportSheet target={{ type: "message", id: reportFor.id }} title="Жалоба на сообщение" onClose={() => setReportFor(null)} />
      )}
      {forwardFor && (
        <div className="fixed inset-0 z-[75] bg-black/60 flex items-end md:items-center md:justify-center" onClick={() => setForwardFor(null)}>
          <div className="w-full md:max-w-md bg-card border-t-2 md:border-2 border-border max-h-[80%] flex flex-col pb-[var(--sab)]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
              <Forward className="w-4 h-4 text-primary" />
              <span className="font-semibold flex-1">Переслать</span>
              <button type="button" onClick={() => setForwardFor(null)} className="p-1" aria-label="Закрыть"><X className="w-5 h-5" /></button>
            </div>
            <input
              value={forwardQuery}
              onChange={(e) => setForwardQuery(e.target.value)}
              placeholder="Поиск по чатам"
              className="mx-4 my-2 px-3 py-2 bg-secondary outline-none text-sm"
            />
            <div className="overflow-y-auto">
              {!saved && savedChatId && (
                <button type="button" onClick={() => { const m = forwardFor; setForwardFor(null); forwardTo(m, savedChatId, "Добавлено в избранное"); }} className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-secondary">
                  <span className="w-10 h-10 shrink-0 bg-primary flex items-center justify-center"><Bookmark className="w-5 h-5 text-primary-foreground" /></span>
                  <span className="font-medium">Избранное</span>
                </button>
              )}
              {(chats || [])
                .filter((c) => c.id !== chatId)
                .filter((c) => !forwardQuery.trim() || chatLabel(c).toLowerCase().includes(forwardQuery.trim().toLowerCase()))
                .map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => { const m = forwardFor; setForwardFor(null); forwardTo(m, c.id, `Переслано: ${chatLabel(c)}`); }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-secondary"
                  >
                    {c.kind === "channel" ? (
                      <span className="w-10 h-10 shrink-0 bg-secondary flex items-center justify-center"><Radio className="w-5 h-5 text-primary" /></span>
                    ) : c.is_group ? (
                      <span className="w-10 h-10 shrink-0 bg-secondary flex items-center justify-center"><Users className="w-5 h-5 text-primary" /></span>
                    ) : (
                      <Identicon id={c.participants?.find((p) => p.id !== userId)?.id || c.id} avatarUrl={c.participants?.find((p) => p.id !== userId)?.avatar_url} className="w-10 h-10" />
                    )}
                    <span className="font-medium truncate">{chatLabel(c)}</span>
                  </button>
                ))}
              {(chats || []).length === 0 && <p className="px-4 py-6 text-sm text-muted-foreground text-center">Чатов нет</p>}
            </div>
          </div>
        </div>
      )}

      {viewer && (
        <ImageViewer
          items={viewer.items}
          index={viewer.index}
          onIndex={(i) => setViewer((v) => (v ? { ...v, index: i } : v))}
          localMap={localImagesRef.current}
          onClose={() => setViewer(null)}
          actions={[
            { label: "Переслать", icon: <Forward className="w-5 h-5 text-subtle" />, onClick: () => {
              const cur = viewer.items[viewer.index];
              const m = messages.find((x) => x.id === cur?.messageId);
              setViewer(null);
              if (m) { setForwardQuery(""); setForwardFor(m); }
            } },
            { label: "Добавить в сохранёнки", icon: <Bookmark className="w-5 h-5 text-primary" />, onClick: async () => {
              const cur = viewer.items[viewer.index];
              if (!cur) return;
              try {
                const r = await api.addSavedImage(cur.messageId);
                toast.success(r.already ? "Уже в сохранёнках" : "Добавлено в сохранёнки", { description: "Сохранёнки видны всем в твоём профиле" });
              } catch (e: any) { toast.error(e?.message || "Не удалось сохранить"); }
            } },
            { label: "Скачать", icon: <Download className="w-5 h-5 text-subtle" />, onClick: async () => {
              const cur = viewer.items[viewer.index];
              if (!cur) return;
              const url = cur.raw.startsWith("s3://") ? await api.signMedia(cur.raw) : mediaUrl(cur.raw);
              handleSaveFile(url, cur.name);
            } },
          ]}
        />
      )}
    </div>
  );
};


const WAVE_BARS = 40;
// Запасная «дорожка», пока волна грузится или если кодек не декодируется.
const FALLBACK_WAVE = Array.from({ length: WAVE_BARS }, (_, i) => 0.25 + ((i * 37) % 16) / 24);

const VoiceBubble = ({ url, seconds, own }: { url: string; seconds: number; own: boolean }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0); // 0..1 по времени воспроизведения
  const [peaks, setPeaks] = useState<number[] | null>(null);

  // Настоящая форма волны из файла (с кэшем). Ошибку глушим — останется запас.
  useEffect(() => {
    let alive = true;
    loadWaveform(url, WAVE_BARS)
      .then((p) => alive && setPeaks(p))
      .catch(() => {});
    return () => { alive = false; };
  }, [url]);

  useEffect(() => () => audioRef.current?.pause(), []);

  const toggle = () => {
    if (!audioRef.current) {
      const audio = new Audio(url);
      audio.onended = () => { setPlaying(false); setProgress(0); };
      audio.onpause = () => setPlaying(false);
      audio.ontimeupdate = () => {
        const d = audio.duration || seconds || 0;
        if (d > 0) setProgress(Math.min(1, audio.currentTime / d));
      };
      audioRef.current = audio;
    }
    const audio = audioRef.current;
    if (playing) {
      audio.pause();
      setPlaying(false);
      return;
    }
    audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  };

  const label = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const wave = peaks ?? FALLBACK_WAVE;
  const playedBars = Math.round(progress * wave.length);

  return (
    <button type="button" onClick={toggle} className="flex items-center gap-2 py-1 min-w-[11rem]">
      <span className="w-9 h-9 shrink-0 flex items-center justify-center bg-black/20">
        {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
      </span>
      {/* Настоящая амплитуда: высота столбика = пик громкости интервала;
          уже проигранная часть ярче. */}
      <span className="flex-1 flex items-center gap-[2px] h-6">
        {wave.map((v, i) => (
          <span
            key={i}
            className="flex-1 bg-current rounded-full"
            style={{
              height: `${Math.max(3, Math.round(v * 22))}px`,
              opacity: i < playedBars ? 0.95 : 0.45,
            }}
          />
        ))}
      </span>
      <span className="text-xs opacity-80 shrink-0">{label}</span>
    </button>
  );
};

export default ChatWindow;