import { useEffect, useState, useRef } from "react";
import { useMediaRecorder, type RecordKind, type VoiceRecording } from "@/hooks/use-media-recorder";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, Paperclip, X, Check, CheckCheck, Download, Image as ImageIcon, Smile, MoreVertical, Music2, Phone, Mic, Trash2, Play, Pause, Video, UserPlus, ChevronLeft, SwitchCamera, Reply, FileText, Pin, Forward, Bookmark, Radio, Users } from "lucide-react";
import { useSwipeBack } from "@/hooks/use-swipe-back";
import StickerPicker from "@/components/chat/StickerPicker";
import { toast } from "sonner";
import Identicon from "@/components/Identicon";
import { api, mediaUrl, NotificationSoundInfo, type PinnedInfo } from "@/api/client";
import { cn } from "@/lib/utils";
import { playSfx } from "@/lib/sfx";
import { loadWaveform } from "@/lib/waveform";
import { compressImage } from "@/lib/compressImage";
import { useMediaUrl } from "@/hooks/use-media-url";
import UserProfileModal from "@/components/UserProfileModal";
import GroupSettingsModal from "@/components/chat/GroupSettingsModal";
import type { ChatInfo } from "@/api/client";
import { LivePreview, MessageImage, MessageVideoFile, MessageFile, VideoNote, isImageFile, isVideoFile, previewSize } from "@/components/chat/media";

interface Profile {
  id: string;
  username: string;
  avatar_url?: string;
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
  /** Видео-сообщение («треугольник») и его длительность. */
  video_url?: string | null;
  video_duration?: number | null;
  /** Видео-заметка снята фронталкой — воспроизводить зеркально (как в превью). */
  video_mirror?: boolean;
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

};

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
  /** «Избранное»: чат без собеседника — без звонка, профиля и добавления людей. */
  saved?: boolean;
  /** Список чатов для пересылки и id «Избранного» для пункта «В избранное». */
  chats?: ChatPick[];
  savedChatId?: string;
}

const ChatWindow = ({ chatId, userId, onBack, title, peer, onCall, group, onGroupUpdated, messagePing, saved, chats, savedChatId }: ChatWindowProps) => {
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
  const [viewer, setViewer] = useState<{ url: string; name: string } | null>(null);
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
  const [recordKind, setRecordKind] = useState<RecordKind>("audio");
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
  const jumpToMessage = (id: string) => {
    const el = document.getElementById(`msg-${id}`);
    if (!el) { toast("Сообщение выше загруженной части ленты"); return; }
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.add("msg-flash");
    setTimeout(() => el.classList.remove("msg-flash"), 1200);
  };

  const forwardTo = async (m: Message, targetId: string, label: string) => {
    try {
      await api.forwardMessage(m.id, targetId);
      toast.success(label);
      if (targetId === chatId) fetchMessages();
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
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [imageLoadErrors, setImageLoadErrors] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const composeRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  // Просим сервер сжать видео (ffmpeg). Фото сжимаем на клиенте, файлы — как есть.
  const pendingCompressRef = useRef<string | null>(null);
  const pendingDownloadOnlyRef = useRef<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // Свои картинки показываем из локального файла: сервер их и так получил от
  // нас, скачивать обратно — лишний трафик и «пустой» пузырь на время загрузки.
  // Ключ — file_url, который сервер выдал при аплоаде.
  const localImagesRef = useRef<Map<string, string>>(new Map());
  
  // Рефы для отслеживания состояния
  const previousMessagesRef = useRef<Message[]>([]);
  // Чат, для которого previousMessagesRef уже наполнен: нужен, чтобы отличить
  // смену чата от прихода новых сообщений.
  const soundChatRef = useRef<string | null>(null);
  const lastSendTimeRef = useRef<number>(0);
  // Свои сообщения, подтверждённые сервером только что: id → время ответа.
  // Опрос ленты, ушедший ДО отправки, возвращается уже после подтверждения и
  // этого сообщения ещё не содержит — без такой памяти пузырь исчезал и
  // появлялся снова только со следующим опросом.
  const recentlySentRef = useRef<Map<string, number>>(new Map());
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

  // Основной эффект для загрузки сообщений
  useEffect(() => {
    if (!chatId) {
      setMessages([]);
      return;
    }

    // Сразу загружаем сообщения при смене чата
    fetchMessages();

    // Устанавливаем интервал для автообновления
    const intervalId = setInterval(() => {
      fetchMessages();
    }, 3000);

    return () => {
      clearInterval(intervalId);
    };
  }, [chatId]);

  // Пришло сообщение по сокету — забираем ленту немедленно. Опрос раз в три
  // секунды остаётся страховкой на случай оборванного сокета, но ждать его
  // не нужно: именно из-за него сообщение собеседника появлялось в открытой
  // переписке через пару секунд после отправки.
  useEffect(() => {
    if (messagePing) { fetchMessages(); loadPinned(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messagePing]);

  // Эффект для обработки новых сообщений и звуков
  useEffect(() => {
    // Первая порция сообщений этого чата — не «новые». При переключении между
    // чатами список меняется целиком, и если в открытом чате сообщений больше,
    // чем было в предыдущем, разница раньше засчитывалась как входящие и
    // звучала как уведомление.
    //
    // chatId намеренно не в зависимостях: эффект должен сработать не в момент
    // переключения (сообщения тогда ещё от старого чата), а когда доедет ответ
    // сервера и messages станут новыми.
    if (soundChatRef.current !== chatId) {
      soundChatRef.current = chatId ?? null;
      previousMessagesRef.current = [...messages];
      if (messages.length > 0) setTimeout(() => scrollToBottom(), 100);
      return;
    }

    // Если сообщений стало больше - значит пришли новые сообщения
    if (messages.length > previousMessagesRef.current.length) {
      const newMessages = messages.slice(previousMessagesRef.current.length);
      
      // Проверяем, есть ли среди новых сообщений входящие (не от текущего пользователя)
      const hasIncomingMessages = newMessages.some(msg => 
        msg.sender?.id !== userId
      );

      // Проверяем, есть ли среди новых сообщений исходящие (от текущего пользователя)
      const hasOutgoingMessages = newMessages.some(msg => 
        msg.sender?.id === userId
      );
      
      // Игрорируем звук получения, если сообщение было отправлено недавно
      const timeSinceLastSend = Date.now() - lastSendTimeRef.current;
      
      if (hasIncomingMessages && timeSinceLastSend > 2000) {
        // Аудио-стикер входящего сообщения заменяет стандартный звук.
        const withSound = newMessages.find(
          msg => msg.sender?.id !== userId && msg.sound?.url
        );
        if (withSound?.sound?.url) {
          void playSfx(mediaUrl(withSound.sound.url), { volume: 0.6 });
        } else {
          void playSfx("/sounds/receive.mp3", { volume: 0.3 });
        }
      }

      // Прокручиваем вниз при любых новых сообщениях
      if (newMessages.length > 0) {
        setTimeout(() => scrollToBottom(), 100);
      }
    }
    
    // Обновляем предыдущие сообщения
    previousMessagesRef.current = [...messages];
  }, [messages, userId]);

  const fetchMessages = async () => {
    if (!chatId) return;
    try {
      const data: Message[] = await api.getMessages(chatId);

      // Память о свежеотправленных живёт полминуты: за это время сообщение
      // гарантированно окажется в серверном списке, а если не оказалось —
      // значит его удалили, и держать пузырь больше не нужно.
      const now = Date.now();
      for (const [id, at] of recentlySentRef.current) {
        if (now - at > 30000) recentlySentRef.current.delete(id);
      }

      setMessages(prev => {
        // Серверный список не знает про клиентские поля: переносим ключ
        // рендера и размеры с уже подтверждённых сообщений.
        const meta = new Map(prev.filter(m => m._key).map(m => [m.id, m]));
        const withMeta = data.map(d => {
          const local = meta.get(d.id);
          return local ? { ...d, _key: local._key, _dims: local._dims } : d;
        });
        // Чего в ответе сервера нет, но что мы про себя знаем: ещё не
        // отправленные пузыри и только что подтверждённые сообщения. Второе —
        // от гонки: опрос мог уйти на сервер раньше отправки и вернуться
        // позже неё, и такой устаревший ответ стирал уже подтверждённое
        // сообщение до следующего опроса.
        const known = new Set(data.map(d => d.id));
        const localOnly = prev.filter(
          m => !known.has(m.id) && (m.pending || recentlySentRef.current.has(m.id))
        );
        const merged = [...withMeta, ...localOnly];
        return JSON.stringify(merged) !== JSON.stringify(prev) ? merged : prev;
      });
    } catch {
      console.log("Не удалось загрузить сообщения (автообновление)");
    }
  };

  const scrollToBottom = () => {
    setTimeout(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
      
      if (messagesEndRef.current) {
        messagesEndRef.current.scrollIntoView({ 
          behavior: 'smooth',
          block: 'end'
        });
      }
    }, 100);
  };

  const handlePick = async (
    e: React.ChangeEvent<HTMLInputElement>,
    mode: "photo" | "video" | "file",
  ) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // чтобы повторный выбор того же файла сработал
    if (!file) return;
    const limit = mode === "video" ? 50 : mode === "file" ? 50 : 25;
    if (file.size > limit * 1024 * 1024) {
      toast.error(`Файл слишком большой (макс. ${limit}MB)`);
      return;
    }
    if (mode === "photo") {
      // Фото сжимаем прямо здесь, до отправки.
      setSelectedFile(await compressImage(file));
      pendingCompressRef.current = null;
      pendingDownloadOnlyRef.current = false;
    } else if (mode === "video") {
      setSelectedFile(file);
      pendingCompressRef.current = "video"; // сервер пережмёт ffmpeg-ом
      pendingDownloadOnlyRef.current = false;
    } else {
      // «Файл» — без обработки, показываем строкой со скачиванием.
      setSelectedFile(file);
      pendingCompressRef.current = null;
      pendingDownloadOnlyRef.current = true;
    }
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
  const SWIPE_TRIGGER = 55;
  const SWIPE_MAX = 90;

  const msgPointerDown = (e: React.PointerEvent, message: Message) => {
    swipeStartRef.current = { x: e.clientX, y: e.clientY, id: message.id };
    swipeActiveRef.current = false;
    startLongPress(message);
  };
  const msgPointerMove = (e: React.PointerEvent, message: Message, isOwn: boolean) => {
    const st = swipeStartRef.current;
    if (!st || st.id !== message.id) return;
    const dx = e.clientX - st.x;
    const dy = e.clientY - st.y;
    if (!swipeActiveRef.current) {
      if (Math.abs(dy) > 12 && Math.abs(dy) >= Math.abs(dx)) {
        // вертикальная прокрутка — жест отменяем
        swipeStartRef.current = null; cancelLongPress(); return;
      }
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy)) {
        swipeActiveRef.current = true;
        cancelLongPress();
        // забираем указатель, чтобы получать move даже при уходе пальца в сторону
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      } else return;
    }
    let off = dx;
    if (isOwn) off = Math.max(0, Math.min(off, SWIPE_MAX));   // свои — вправо
    else off = Math.min(0, Math.max(off, -SWIPE_MAX));        // чужие — влево
    setSwipe({ id: message.id, dx: off });
  };
  const msgPointerUp = (e: React.PointerEvent, message: Message, isOwn: boolean) => {
    const st = swipeStartRef.current;
    cancelLongPress();
    if (swipeActiveRef.current && st) {
      const dx = e.clientX - st.x;
      const triggered = isOwn ? dx > SWIPE_TRIGGER : dx < -SWIPE_TRIGGER;
      if (triggered) setReplyTo(message);
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
    if (!chatId || (!newMessage.trim() && !selectedFile)) return;

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
    const file = selectedFile;
    const sound = selectedSound;
    const reply = replyTo;
    const compress = pendingCompressRef.current;
    const downloadOnly = pendingDownloadOnlyRef.current;
    pendingCompressRef.current = null;
    pendingDownloadOnlyRef.current = false;

    // Пузырь появляется мгновенно, поле очищается сразу — сеть догоняет
    // в фоне. Для картинки заранее замеряем размеры из локального файла,
    // чтобы пузырь сразу занял своё место и лента не дёргалась.
    const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const localUrl =
      file && file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
    const dims = localUrl ? await imageDims(localUrl) : null;

    const optimistic: Message = {
      id: tempId,
      content: text || null,
      file_url: localUrl,
      file_name: file?.name ?? null,
      sender_id: userId,
      sender: { id: userId } as Profile,
      created_at: new Date().toISOString(),
      sound,
      download_only: downloadOnly,
      reply_to: reply
        ? { id: reply.id, sender_username: reply.sender?.username || "", preview: replyPreviewText(reply) }
        : null,
      pending: true,
      _key: tempId,
      _dims: dims,
    };

    setNewMessage("");
    setSelectedFile(null);
    setSelectedSound(null);
    setReplyTo(null);
    setMessages(prev => [...prev, optimistic]);
    lastSendTimeRef.current = Date.now();
    setTimeout(() => scrollToBottom(), 50);
    void playSfx("/sounds/send.mp3", { volume: 0.3 });

    try {
      let sent: Message;
      if (file) {
        const uploadResult = await api.uploadFile(file, compress || undefined, (p) => setUploadProgress(p));
        // Свою картинку рисуем из локального файла и после подтверждения —
        // сервер нужен только собеседнику.
        if (localUrl && uploadResult.file_url) {
          localImagesRef.current.set(uploadResult.file_url, localUrl);
        }
        sent = await api.sendMessageWithFile(chatId, {
          file_url: uploadResult.file_url,
          file_name: uploadResult.file_name,
          file_size: uploadResult.file_size,
        }, text || undefined, sound?.id, reply?.id, downloadOnly);
        setUploadProgress(null);
      } else {
        sent = await api.sendMessage(chatId, text || null, sound?.id, reply?.id);
      }

      // Подменяем временное сообщение настоящим, сохранив ключ рендера и
      // размеры — DOM не перемонтируется, картинка не мигает.
      recentlySentRef.current.set(sent.id, Date.now());
      setMessages(prev =>
        prev.map(m =>
          m.id === tempId ? { ...m, ...sent, pending: false, _key: tempId, _dims: dims } : m
        )
      );
    } catch (error: any) {
      console.error("Error sending message:", error);
      setUploadProgress(null);
      toast.error("Ошибка отправки: " + (error.message || "Неизвестная ошибка"));
      // Возвращаем черновик, чтобы можно было отправить повторно.
      setMessages(prev => prev.filter(m => m.id !== tempId));
      setNewMessage(text);
      setSelectedFile(file);
      setSelectedSound(sound);
      setReplyTo(reply);
      if (localUrl) URL.revokeObjectURL(localUrl);
    }
  };

  const startLongPress = (message: Message) => {
    if (longPressRef.current) clearTimeout(longPressRef.current);
    longPressRef.current = setTimeout(() => { setMenuPos(null); setMenuMessage(message); }, 450);
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
  const processRecording = async (result: VoiceRecording | null) => {
    if (!result || !chatId) return;
    setUploading(true);
    try {
      if (result.kind === "video") {
        const uploaded = await api.uploadFile(result.file);
        // Фронтальная камера снимается в зеркальном (селфи) виде — помечаем,
        // чтобы воспроизведение в чате отразилось так же. Сам файл не меняем.
        await api.sendMessageWithVideo(chatId, uploaded.file_url, result.seconds, facing === "user");
      } else {
        const uploaded = await api.uploadVoice(result.file);
        await api.sendMessageWithVoice(chatId, uploaded.file_url, result.seconds);
      }
      lastSendTimeRef.current = Date.now();
      await fetchMessages();
      setTimeout(() => scrollToBottom(), 50);
    } catch {
      toast.error("Не удалось отправить сообщение");
    } finally {
      setUploading(false);
    }
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
    holdTimerRef.current = setTimeout(async () => {
      startingRef.current = true;
      const ok = await startRec(recordKind, facing);
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

    // Запись так и не началась → это был тап: переключаем режим (если не отмена).
    if (!startedRef.current) {
      cancelArmedRef.current = false;
      setCancelArmed(false);
      if (!forceCancel) setRecordKind((k) => (k === "audio" ? "video" : "audio"));
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
    } else {
      // Fallback: открываем файл в новой вкладке для сохранения вручную
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
        { label: "Удалить у себя", show: true, onClick: () => startDelete(menuMessage, "me") },
        { label: "Удалить у всех", show: menuMessage.sender?.id === userId, danger: true, onClick: () => startDelete(menuMessage, "all") },
      ].filter((i) => i.show)
    : [];

  return (
    <div className="flex-1 flex flex-col bg-background min-w-0 min-h-0">
      {(onBack || title || peer || isGroup) && (
        <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 pad-safe-top border-b border-border bg-card">
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
              className="font-medium line-clamp-2 leading-tight flex-1 text-left hover:text-primary transition-colors"
              title="Профиль собеседника"
            >
              {headerTitle || peer.username || "Чат"}
            </button>
          ) : isGroup ? (
            <button
              type="button"
              onClick={() => setGroupOpen(true)}
              className="font-medium line-clamp-2 leading-tight flex-1 text-left hover:text-primary transition-colors"
              title="Настройки группы"
            >
              {headerTitle || group?.name || "Группа"}
            </button>
          ) : (
            <span className="font-medium line-clamp-2 leading-tight flex-1">{headerTitle || "Чат"}</span>
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
              className="p-2 -mr-2 text-foreground active:text-primary"
              aria-label="Позвонить"
            >
              <Phone className="w-5 h-5" />
            </button>
          )}
        </div>
      )}
      {/* Закреплённое: тап — к сообщению, крестик — открепить. */}
      {pinned && (
        <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-border bg-card">
          <Pin className="w-4 h-4 text-primary shrink-0" />
          <button type="button" onClick={() => jumpToMessage(pinned.id)} className="flex-1 min-w-0 text-left">
            <span className="block text-[11px] text-primary font-medium leading-tight">Закреплено · {pinned.sender_username}</span>
            <span className="block text-sm line-clamp-1 break-all">{pinned.preview}</span>
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
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain chat-scroll px-3 md:px-4 py-4 md:py-6"
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        <div className="max-w-4xl mx-auto space-y-4 md:space-y-6">
          {messages.filter((m) => !hiddenIds.has(m.id)).map((message, index) => {
            const isOwn = message.sender?.id === userId;
            const hasImage =
              !!message.file_url &&
              !message.download_only &&
              isImageFile(message.file_name, message.file_url) &&
              !imageLoadErrors.has(message.id);
            // Картинка без текста — сама себе пузырь: без цветной рамки-паспарту,
            // которая раздувала сообщение на пол-экрана.
            const imageOnly = hasImage && !message.content && !message.sticker?.file_url && !message.sound;
            // Видео-«треугольник» без текста/цитаты — тоже без прямоугольного
            // пузыря: обводку несёт сам треугольник (см. VideoNote).
            const videoOnly = !!message.video_url && !message.content && !message.sticker?.file_url && !message.sound && !message.reply_to;
            const bareBubble = imageOnly || videoOnly;
            const previousMessage = index > 0 ? messages[index - 1] : null;
            const showDate = shouldShowDate(message, previousMessage);
            const username = message.sender?.username || "Неизвестный";

            return (
              <div
                key={message._key ?? message.id}
                id={`msg-${message.id}`}
                className={cn("space-y-2", message._key && "msg-in")}
              >
                {/* Разделитель с датой */}
                {showDate && (
                  <div className="flex justify-center">
                    <div className="bg-muted/50 px-3 py-1 rounded-full text-xs text-muted-foreground">
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
                  style={
                    swipe?.id === message.id
                      ? { transform: `translateX(${swipe.dx}px)` }
                      : { transition: "transform 150ms" }
                  }
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
                      className="w-8 h-8"
                    />
                  )}

                  {/* Контент сообщения */}
                  <div className={cn(
                    "flex flex-col max-w-[76%] sm:max-w-[70%] md:max-w-[65%]",
                    isOwn ? "items-end" : "items-start"
                  )}>
                    {/* Имя отправителя (только для чужих сообщений) */}
                    {!isOwn && (
                      <div className="flex items-center gap-2 mb-1 ml-1">
                        <span className="text-xs font-medium text-foreground">
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
                        setMenuMessage(message);
                        setMenuPos({ x: e.clientX, y: e.clientY });
                      }}
                      onClick={() => {
                        if (justSwipedRef.current) return;
                        if (message.sound?.url) toggleSticker(message.id, message.sound.url);
                      }}
                      className={cn(
                      "relative",
                      !bareBubble && "px-4 py-2",
                      // Свои сообщения алые, входящие зелёные — два цвета
                      // палитры работают как разметка разговора, без подписей.
                      !bareBubble &&
                        (isOwn
                          ? "bg-primary text-primary-foreground"
                          : "bg-success text-success-foreground")
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
                          className={cn(
                            "mb-1 rounded px-2 py-1 border-l-2 text-xs min-w-0 max-w-full",
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
                        <img
                          src={mediaUrl(message.sticker.file_url)}
                          alt={message.sticker.emoji || "Стикер"}
                          className="w-32 h-32 object-contain"
                          loading="lazy"
                        />
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
                        <VoiceBubble
                          url={mediaUrl(message.voice_url)}
                          seconds={message.voice_duration || 0}
                          own={isOwn}
                        />
                      )}

                      {/* Текст сообщения */}
                      {message.content && (
                        <p className="break-words leading-relaxed whitespace-pre-wrap">
                          {message.content}
                        </p>
                      )}

                      {/* Файл */}
                      {message.file_url && (
                        <div className={cn(!imageOnly && "mt-2")}>
                          {hasImage ? (
                            <MessageImage
                              raw={message.file_url}
                              name={message.file_name}
                              dims={message._dims}
                              localMap={localImagesRef.current}
                              onOpen={(url, name) => setViewer({ url, name })}
                              onError={() => setImageLoadErrors(prev => new Set(prev).add(message.id))}
                            />
                          ) : (!message.download_only && isVideoFile(message.file_name, message.file_url)) ? (
                            <MessageVideoFile raw={message.file_url} />
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
                    </div>

                    {/* Время и статус */}
                    <div className={cn(
                      "flex items-center gap-2 mt-1 px-1",
                      isOwn ? "flex-row-reverse" : ""
                    )}>
                      <span className="text-xs text-muted-foreground">
                        {message.is_edited ? "изменено · " : ""}{formatTime(message.created_at)}
                      </span>
                      
                      {/* Статусы: одна галочка — отправляется, две — на сервере. */}
                      {isOwn && (
                        <div className="flex items-center">
                          {message.pending ? (
                            <Check className="w-3 h-3 text-muted-foreground" />
                          ) : (
                            <CheckCheck className="w-3 h-3 text-success" />
                          )}
                        </div>
                      )}
                    </div>
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

      {/* Поле ввода */}
      <div ref={composeRef} className="p-2 md:p-4 pad-safe-bottom border-t border-border bg-card">
        <div className="max-w-4xl mx-auto">
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
          {uploadProgress !== null && (
            <div className="mb-2 flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
                <div className="h-full bg-primary transition-[width] duration-150" style={{ width: `${uploadProgress}%` }} />
              </div>
              <span className="text-xs text-muted-foreground tabular-nums w-9 text-right">{uploadProgress}%</span>
            </div>
          )}
          {selectedFile && (
            <div className="mb-2 md:mb-3 p-2 md:p-3 bg-secondary/50 rounded-lg flex items-center justify-between border">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <Paperclip className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <span className="text-sm font-medium truncate">
                  {selectedFile.name}
                </span>
                <span className="text-xs text-muted-foreground flex-shrink-0">
                  ({(selectedFile.size / 1024 / 1024).toFixed(1)} MB)
                </span>
              </div>
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => setSelectedFile(null)}
                className="h-8 w-8 hover:bg-destructive/10 hover:text-destructive"
              >
                <X className="w-3 h-3" />
              </Button>
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
            <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => handlePick(e, "photo")} />
            <input ref={videoInputRef} type="file" accept="video/*" className="hidden" onChange={(e) => handlePick(e, "video")} />
            <input ref={fileInputRef} type="file" className="hidden" onChange={(e) => handlePick(e, "file")} />

            <div className="relative shrink-0">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setAttachMenuOpen((v) => !v)}
                disabled={uploading}
                className="h-10 w-10 md:h-11 md:w-11 border-2"
                aria-label="Прикрепить"
              >
                <Paperclip className="w-4 h-4" />
              </Button>
              {attachMenuOpen && (
                <div className="absolute bottom-full left-0 mb-2 w-40 bg-card border border-border rounded-lg overflow-hidden shadow-lg z-10">
                  <button type="button" className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left active:bg-secondary"
                    onClick={() => { setAttachMenuOpen(false); photoInputRef.current?.click(); }}>
                    <ImageIcon className="w-4 h-4 text-primary" /> Фото
                  </button>
                  <button type="button" className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left active:bg-secondary"
                    onClick={() => { setAttachMenuOpen(false); videoInputRef.current?.click(); }}>
                    <Video className="w-4 h-4 text-primary" /> Видео
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
              className="h-10 w-10 md:h-11 md:w-11 shrink-0 border-2"
              aria-label="Стикеры"
            >
              <Smile className="w-4 h-4" />
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
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
                disabled={uploading}
                className="w-full resize-none overflow-y-auto bg-background border-2 border-border px-3 py-2 text-sm md:text-base leading-6 focus:outline-none focus:border-primary"
                style={{ maxHeight: "6.5rem" }}
              />
            </div>
            
            {newMessage.trim() || selectedFile ? (
              <Button
                onClick={sendMessage}
                disabled={uploading}
                className="h-10 md:h-11 px-4 md:px-6 bg-gradient-primary shadow-glow hover:shadow-glow-lg transition-all duration-200 shrink-0"
                size="lg"
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
                      "h-10 w-10 md:h-11 md:w-11 shrink-0 border-2 flex items-center justify-center transition-colors",
                      // Фронтальная активна — кнопка инвертирована; задняя — обычный вид.
                      facing === "user"
                        ? "bg-foreground text-background border-foreground"
                        : "bg-transparent text-foreground border-border"
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
                    "h-10 md:h-11 px-4 md:px-6 shrink-0 flex items-center justify-center transition-colors",
                    recording ? "bg-foreground text-background" : "bg-gradient-primary text-primary-foreground"
                  )}
                  aria-label={recordKind === "video" ? "Записать видео" : "Записать голосовое"}
                >
                  {recordKind === "video" ? <Video className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
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
            className="fixed min-w-[180px] bg-card border-2 border-border shadow-xl py-1"
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
      {menuMessage && !menuPos && (
        <div
          className="fixed inset-0 z-[70] bg-black/60 flex items-end"
          onClick={closeMenu}
        >
          <div
            className="w-full bg-card border-t-2 border-border pb-[var(--sab)]"
            onClick={(e) => e.stopPropagation()}
          >
            {menuItems.map((it, idx) => (
              <button
                key={idx}
                type="button"
                onClick={it.onClick}
                className={cn(
                  "w-full px-5 py-4 text-left text-base active:bg-secondary",
                  it.danger && "text-destructive",
                )}
              >
                {it.label}
              </button>
            ))}
            <button
              type="button"
              onClick={closeMenu}
              className="w-full px-5 py-4 text-left text-base text-muted-foreground active:bg-secondary"
            >
              Отмена
            </button>
          </div>
        </div>
      )}

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
          item={viewer}
          onClose={() => setViewer(null)}
          onSave={() => handleSaveFile(viewer.url, viewer.name)}
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

const ImageViewer = ({
  item,
  onClose,
  onSave,
}: {
  item: { url: string; name: string };
  onClose: () => void;
  onSave: () => void;
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div
      className="fixed inset-0 z-50 bg-black flex items-center justify-center"
      style={{
        paddingTop: "var(--sat)",
        paddingBottom: "var(--sab)",
      }}
      onClick={onClose}
    >
      {/* Шапка: закрыть и меню */}
      <div
        className="absolute inset-x-0 flex items-center justify-between px-3"
        style={{ top: "calc(var(--sat) + 0.5rem)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" onClick={onClose} className="p-2 text-white" aria-label="Закрыть">
          <X className="w-6 h-6" />
        </button>
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="p-2 text-white"
            aria-label="Меню"
          >
            <MoreVertical className="w-6 h-6" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 bg-card border border-border min-w-[160px]">
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onSave();
                }}
                className="w-full flex items-center gap-2 px-4 py-3 text-sm text-left active:bg-secondary"
              >
                <Download className="w-4 h-4" />
                Скачать
              </button>
            </div>
          )}
        </div>
      </div>

      <img
        src={item.url}
        alt=""
        className="max-h-full max-w-full object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
};

export default ChatWindow;