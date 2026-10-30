import { confirmDialog } from "@/lib/confirm";
import { useEffect, useMemo, useRef, useState } from "react";
import { allDrafts } from "@/lib/drafts";
import { activityLabel, useAllActivity } from "@/lib/chatActivity";
import CachedImg from "@/components/CachedImg";
import Identicon from "@/components/Identicon";
import { Aura } from "@/components/Aura";
import { cn } from "@/lib/utils";
import { useEscape } from "@/lib/escape";
import { RefreshCw, Share2, Pin, Lock, Lightbulb, Newspaper, EyeOff, PawPrint, Music2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useNavTabs, type NavTab } from "@/lib/navTabs";
import { usePetChats, usePetsAvailable } from "@/lib/pets";
import { useSections, setSection, type SectionKey } from "@/lib/sections";
import { shareProfile } from "@/lib/share";
import { toast as sonnerToast } from "sonner";
import { X as XIcon, Search as SearchIcon, Star as StarIcon, ArrowRight as ArrowRightIcon, Settings as SettingsIcon, Plus as PlusIcon, CheckCheck as CheckCheckIcon, Languages as LanguagesIcon } from "lucide-react";
import { openTranslator } from "@/lib/translator";
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import CustomEmoji from "@/components/chat/CustomEmoji";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { 
  MessageSquare, 
  UserPlus, 
  X,
  Users,
  Check,
  Trash2,
  Radio,
  Bookmark
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { api, mediaUrl } from "@/api/client";
import { MessageHits, useMessageSearch } from "@/components/chat/MessageHits";
import { setPendingJump } from "@/lib/jumpTo";
import { preloadImage } from "@/lib/imageCache";
import { readCache, writeCache } from "@/lib/session-cache";
import { applyServerSettings } from "@/lib/settings";
import { applyProfileLang, getLang, t, tn } from "@/lib/i18n";
import UpdateBanner from "@/components/UpdateBanner";
import { useMint, MintIcon } from "@/themes/mint";
import { useGlassHeight } from "@/themes/mint/glass";

interface Profile {
  id: string;
  username: string;
  avatar_url?: string;
  is_online?: boolean;
  hide_online?: boolean;
  aura_color?: string | null;
  aura_text?: string | null;
}

interface Chat {
  id: string;
  name?: string;
  is_group?: boolean;
  participants?: Profile[];
  created_at?: string;
  /** Когда я закрепил чат; null — не закреплён. Закрепление личное. */
  pinned_at?: string | null;
  /** Время последнего сообщения — по нему сортируется список. */
  last_message_at?: string | null;
  /** direct · group · channel · saved · system… и прочее, что сервер отдаёт о чате. */
  kind?: string;
  updated_at?: string;
  unread_count?: number;
}

interface ChatSidebarProps {
  userId: string;
  /** Свой ник — для кнопки «Поделиться профилем» в диалоге нового чата. */
  username?: string;
  chats: Chat[];
  /** title — вычисленное имя собеседника: список чатов его не содержит,
   *  участники грузятся отдельно, поэтому знает о нём только сайдбар. */
  onSelectChat: (chatId: string, title?: string, kind?: string) => void;
  /** Перезагрузка списка — вызывается жестом «потянуть вниз». */
  onRefresh?: () => Promise<unknown> | void;
  selectedChatId: string | null;
  onLogout: () => void;
  onOpenProfile?: () => void;
  onChatDeleted: (chatId: string) => void;
  /** Стена — строка над списком (десктоп); на телефоне у неё вкладка. */
  onOpenWall?: () => void;
  wallSelected?: boolean;
  wallNew?: number;
  onChatCreated: () => void;
  /** «Избранное» на десктопе — строкой над списком (на телефоне у него
   *  своя вкладка, и пропсы не передаются). */
  savedChatId?: string;
  onOpenSaved?: () => void;
  /** «Долгий ящик»: чат с ботом идей (если уже есть) и открытие. */
  ideabox?: { id: string; unread: number; avatar_url?: string | null } | null;
  onOpenIdeabox?: () => void;
}

// Кеш участников переживает перезапуск приложения: имена в списке чатов
// появляются сразу, без ожидания сети. Ключ отдельный от токенов, чтобы
// чистка сессии его не задевала.
const PARTICIPANTS_CACHE_KEY = "chat_participants_cache";

/** Локаль дат и времени в строке чата — по языку интерфейса. */
const LOCALE = { ru: "ru-RU", en: "en-US", ko: "ko-KR" } as const;

/** Превью последнего сообщения сервер для вложений шлёт статичной русской
 *  строкой (chat/serializers.py) — такие переводим, текст людей не трогаем. */
const SERVER_PREVIEWS = new Set(["Стикер", "Видео-сообщение", "Голосовое сообщение", "Файл", "Сообщение", "📍 Геопозиция", "Зашифрованное сообщение"]);
const serverPreview = (s: string) => (s && SERVER_PREVIEWS.has(s) ? t(s) : s);

/** Превью последнего сообщения — со своими эмодзи на их местах (сервер отдаёт
 *  last_message.emoji: offset/length в этом превью, UTF-16 — как в JS). */
type PreviewEmoji = { offset: number; length: number; url: string; repaint?: boolean };
const PreviewText = ({ text, emoji }: { text: string; emoji?: PreviewEmoji[] }) => {
  if (!emoji?.length) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let pos = 0;
  for (const e of [...emoji].sort((a, b) => a.offset - b.offset)) {
    if (e.offset < pos || e.offset + e.length > text.length) continue;
    if (e.offset > pos) parts.push(text.slice(pos, e.offset));
    parts.push(<CustomEmoji key={e.offset} url={e.url} alt={text.slice(e.offset, e.offset + e.length)} repaint={e.repaint} loop={false}
      className="inline-block w-[1.25em] h-[1.25em] align-[-0.25em] object-contain" />);
    pos = e.offset + e.length;
  }
  parts.push(text.slice(pos));
  return <>{parts}</>;
};

function readParticipantsCache(): {[chatId: string]: any[]} {
  try {
    return JSON.parse(localStorage.getItem(PARTICIPANTS_CACHE_KEY) || "{}");
  } catch {
    return {};
  }
}

function writeParticipantsCache(map: {[chatId: string]: any[]}) {
  try {
    localStorage.setItem(PARTICIPANTS_CACHE_KEY, JSON.stringify(map));
  } catch {
    // Переполнено или недоступно — не критично, просто не кешируем.
  }
}

// Прокрутка списка переживает вход в чат и выход из него: на телефоне список
// размонтируется, пока открыт чат, и без этого каждый выход бросал наверх.
let savedListScroll = 0;

const ChatSidebar = ({ 
  userId, 
  username,
  chats,
  onSelectChat,
  onRefresh, 
  selectedChatId, 
  onLogout,
  onOpenProfile,
  onChatDeleted,
  onChatCreated,
  savedChatId,
  onOpenSaved,
  onOpenWall,
  wallSelected,
  wallNew,
  ideabox,
  onOpenIdeabox,
}: ChatSidebarProps) => {
  const isMobileLayout = useIsMobile();
  const mint = useMint() && isMobileLayout;
  // Раздел убран из нижнего меню (lib/navTabs) — на телефоне он строкой в
  // списке, иначе до него не добраться. На компьютере строки как были.
  const dock = useNavTabs(false).tabs;
  const offDock = (id: NavTab) => !!isMobileLayout && !dock.includes(id);
  const navigateTo = useNavigate();
  const listRef = useRef<HTMLDivElement>(null);
  const { pull, refreshing } = usePullToRefresh(listRef, onRefresh);
  // Запоминаем прокрутку списка и возвращаем её при следующем монтировании.
  useEffect(() => {
    const vp = listRef.current?.querySelector("[data-radix-scroll-area-viewport]") as HTMLElement | null;
    if (!vp) return;
    if (savedListScroll > 0) vp.scrollTop = savedListScroll;
    const onScroll = () => { savedListScroll = vp.scrollTop; };
    vp.addEventListener("scroll", onScroll, { passive: true });
    return () => vp.removeEventListener("scroll", onScroll);
  }, []);
  const [searchQuery, setSearchQuery] = useState("");
  // Поиск по списку чатов (поле под шапкой): по названию и именам участников.
  const [listFilter, setListFilter] = useState("");
  // Люди по началу ника (api.searchPeople: без скрывших себя из поиска).
  // Те, с кем уже есть личка, — не здесь: их чат и так в списке.
  const [peopleHits, setPeopleHits] = useState<Profile[]>([]);
  const [peopleAll, setPeopleAll] = useState(false);
  useEffect(() => {
    const q = listFilter.trim().replace(/^@/, "");
    setPeopleAll(false);
    if (q.length < 2) { setPeopleHits([]); return; }
    let off = false;
    const t = setTimeout(() => {
      api.searchPeople(q).then((r) => {
        if (off) return;
        const peers = new Set(chats.filter((c) => !c.is_group && (c.kind || "direct") === "direct")
          .flatMap((c) => (c.participants || []).map((p) => p.id)));
        setPeopleHits((Array.isArray(r) ? r : []).filter((p) => p.id !== userId && !peers.has(p.id)));
      }).catch(() => { if (!off) setPeopleHits([]); });
    }, 350);
    return () => { off = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listFilter, userId]);
  // Сообщения по тексту во всех моих чатах (api.searchMessages) — ниже людей.
  const msgSearch = useMessageSearch(listFilter.replace(/^@/, ""));
  // Служебные строки (Долгий ящик, Стена, Избранное) при поиске — только если
  // запрос совпал с названием: иначе они стояли над результатами всегда.
  const rowMatches = (title: string) => { const q = listFilter.trim().toLowerCase(); return !q || title.toLowerCase().includes(q); };
  // Фильтр-чипы под поиском: все чаты, только с непрочитанным, только каналы.
  const [listTab, setListTab] = useState<"all" | "unread" | "channels">("all");
  // Черновики (lib/drafts): в строке чата вместо последнего сообщения.
  const [drafts, setDrafts] = useState<Record<string, string>>(() => allDrafts());
  // «Печатает…» и прочее — вместо последнего сообщения (lib/chatActivity).
  const activityFor = useAllActivity();
  useEffect(() => {
    const on = () => setDrafts(allDrafts());
    window.addEventListener("hyax:drafts", on);
    return () => window.removeEventListener("hyax:drafts", on);
  }, []);
  const unreadChats = chats.filter((c) => ((c as any).unread_count || 0) > 0).length;
  // Режим диалога «Новый чат»: личный · группа · канал.
  const [mode, setMode] = useState<"user" | "group" | "channel">("user");
  const groupMode = mode === "group";
  const [groupName, setGroupName] = useState("");
  const [groupMembers, setGroupMembers] = useState<Profile[]>([]);
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  const [channelResults, setChannelResults] = useState<any[]>([]);
  // Поля создания канала.
  const [chName, setChName] = useState("");
  const [chUsername, setChUsername] = useState("");
  const [chDesc, setChDesc] = useState("");
  const [chSign, setChSign] = useState(false);
  const [chBusy, setChBusy] = useState(false);
  // Профиль берём из кеша сразу: сеть только обновляет его. Иначе при каждом
  // возврате из чата шапка показывала «Загрузка…», хотя данные уже известны.
  const [currentUser, setCurrentUser] = useState<Profile | null>(
    () => readCache<Profile>("user")
  );
  // Где кончается верхний блок (шапка, поиск, фильтры): под ним встаёт
  // мини-плеер. Иначе он закрывал бы поиск — он-то стоит под шапкой чата,
  // а здесь шапка выше (см. components/MiniPlayer.tsx).
  const topRef = useRef<HTMLDivElement>(null);
  useGlassHeight(topRef, mint);
  useEffect(() => {
    let last = "";
    const set = () => {
      const h = topRef.current?.getBoundingClientRect().bottom;
      if (!h) return;
      const v = `${Math.round(h)}px`;
      // Одно и то же значение не переписываем: setProperty на <html> заставляет
      // пересчитать стили всего дерева.
      // Сравниваем с тем, что стоит на <html> сейчас, а не с last: переменная
      // общая, и окно переписки (пул окон, Избранное) её переписывает; после
      // возврата к списку надо вернуть свою (баг-репорт c66f4428).
      if (document.documentElement.style.getPropertyValue("--player-top") !== v) { last = v; document.documentElement.style.setProperty("--player-top", v); }
    };
    set();
    // Окно переписки ушло со сцены — говорит об этом событием: мерим заново.
    window.addEventListener("hyax:player-top", set);
    // Раньше тут был таймер раз в секунду (фильтры появляются не сразу) — и
    // каждую секунду принудительный пересчёт раскладки. ResizeObserver
    // срабатывает ровно тогда, когда верхний блок меняет высоту.
    const ro = typeof ResizeObserver !== "undefined" && topRef.current ? new ResizeObserver(set) : null;
    if (ro && topRef.current) ro.observe(topRef.current);
    window.addEventListener("resize", set);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", set);
      window.removeEventListener("hyax:player-top", set);
      document.documentElement.style.removeProperty("--player-top");
    };
  }, []);
  // Участники — сразу из кеша, ещё до первой отрисовки: иначе при каждом
  // переходе между вкладками на мгновение показывались служебные названия
  // вида «Чат 32aec835…» — имя собеседника ещё не успевало прочитаться.
  const [chatParticipants, setChatParticipants] = useState<{[chatId: string]: Profile[]}>(
    () => readParticipantsCache()
  );
  const [loadingParticipants, setLoadingParticipants] = useState<{[chatId: string]: boolean}>({});
  const [deletingChats, setDeletingChats] = useState<{[chatId: string]: boolean}>({});
  // Удаление чата: десктоп — меню по правому клику у курсора; телефон —
  // свайп влево открывает красную кнопку.
  const [chatMenu, setChatMenu] = useState<{ x: number; y: number; chatId: string; title: string } | null>(null);
  // Стену и «Долгий ящик» можно скрыть: правый клик или долгое нажатие по
  // строке → «Скрыть»; вернуть — «Внешний вид» → «Разделы».
  const sections = useSections();
  const [sectionMenu, setSectionMenu] = useState<{ x: number; y: number; kind: SectionKey } | null>(null);
  const sectionHoldRef = useRef<{ timer: ReturnType<typeof setTimeout> | null; x: number; y: number; fired: boolean }>({ timer: null, x: 0, y: 0, fired: false });
  // Свайп влево — как у чатов: под строкой кнопка «Скрыть». Открыта одна
  // кнопка на весь список (общий swipedChatId с ключом __wall / __ideabox).
  const swipeKey = (kind: SectionKey) => `__${kind}`;
  const sectionPress = (kind: SectionKey) => ({
    onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); setSectionMenu({ x: e.clientX, y: e.clientY, kind }); },
    onTouchStart: (e: React.TouchEvent) => {
      const t0 = e.touches[0]; const h = sectionHoldRef.current;
      h.x = t0.clientX; h.y = t0.clientY; h.fired = false;
      if (h.timer) clearTimeout(h.timer);
      h.timer = setTimeout(() => { h.fired = true; setSectionMenu({ x: h.x, y: h.y, kind }); }, 550);
    },
    onTouchMove: (e: React.TouchEvent) => {
      const t0 = e.touches[0]; const h = sectionHoldRef.current;
      if (h.timer && (Math.abs(t0.clientX - h.x) > 10 || Math.abs(t0.clientY - h.y) > 10)) { clearTimeout(h.timer); h.timer = null; }
    },
    onTouchEnd: (e: React.TouchEvent) => {
      const h = sectionHoldRef.current;
      if (h.timer) { clearTimeout(h.timer); h.timer = null; }
      if (h.fired) return;
      // На широком экране (компьютер, планшет) скрывают только из меню по
      // правой кнопке или долгому нажатию — свайпа и кнопки под строкой нет.
      if (window.matchMedia("(min-width: 768px)").matches) return;
      const t1 = e.changedTouches[0];
      const dx = t1.clientX - h.x, dy = t1.clientY - h.y;
      if (Math.abs(dx) > Math.abs(dy) * 1.5) {
        if (dx < -45) { setPinSwipedId(null); setSwipedChatId(swipeKey(kind)); h.fired = true; }
        else if (dx > 25 && swipedChatId === swipeKey(kind)) { setSwipedChatId(null); h.fired = true; }
      }
    },
  });
  const swipeStyle = (kind: SectionKey) => ({ transform: swipedChatId === swipeKey(kind) ? "translateX(-80px)" : "translateX(0)" });
  // Кнопка под строкой — только пока строка отъехала свайпом (телефон):
  // иначе на подложке «Мяты» она просвечивала из-под строки и на компьютере.
  const hideSwipeButton = (kind: SectionKey) => swipedChatId === swipeKey(kind) ? (
    <button
      type="button"
      onClick={() => { setSwipedChatId(null); void hideSection(kind); }}
      className="absolute inset-y-0 right-0 w-20 bg-surface-3 text-foreground flex flex-col items-center justify-center gap-0.5 md:hidden"
      aria-label={kind === "wall" ? t("Скрыть Стену") : t("Скрыть «Долгий ящик»")}
    >
      <EyeOff className="w-5 h-5" />
      <span className="text-[10px] font-semibold">{t("Скрыть")}</span>
    </button>
  ) : null;
  /** Клик после долгого нажатия не открывает раздел — открылось меню. */
  const sectionClick = (kind: SectionKey, open: () => void) => () => {
    if (sectionHoldRef.current.fired) { sectionHoldRef.current.fired = false; return; }
    if (swipedChatId === swipeKey(kind)) { setSwipedChatId(null); return; }
    open();
  };
  const hideSection = async (kind: SectionKey) => {
    setSectionMenu(null);
    if (await setSection(kind, false)) toast(t("Скрыто. Вернуть можно в «Профиль» → «Внешний вид» → «Разделы»"));
    else toast.error(t("Не получилось"));
  };
  // Секретные чаты: превью у сервера — шифротекст. Расшифровываем на этом
  // устройстве, если ключ здесь; иначе — нейтральная подпись.
  const [secretPreview, setSecretPreview] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!currentUser?.id) return;
    let off = false;
    (async () => {
      const { chatKey, decryptPayload } = await import("@/lib/secret");
      const next: Record<string, string> = {};
      for (const c of chats as any[]) {
        const cipher = c.kind === "secret" ? c.last_message?.cipher : null;
        if (!cipher) continue;
        const k = await chatKey(c.id, c.secret, currentUser.id).catch(() => null);
        const p = k ? await decryptPayload(k.key, cipher) : null;
        if (p) next[c.id + cipher.slice(0, 16)] = p.t;
      }
      if (!off) setSecretPreview(next);
    })();
    return () => { off = true; };
  }, [chats, currentUser?.id]);
  // Свайп влево открывает удаление, вправо — закрепление.
  const [swipedChatId, setSwipedChatId] = useState<string | null>(null);
  // «Изм.» в шапке «Мяты»: у строк видны «закрепить» и «удалить» без свайпа.
  const [editMode, setEditMode] = useState(false);
  const [pinSwipedId, setPinSwipedId] = useState<string | null>(null);
  // Esc (lib/escape): закрыть меню строки или вернуть отъехавшую свайпом строку.
  useEscape(!!chatMenu || !!sectionMenu || !!swipedChatId || !!pinSwipedId, () => {
    if (chatMenu) setChatMenu(null);
    else if (sectionMenu) setSectionMenu(null);
    else { setSwipedChatId(null); setPinSwipedId(null); }
  });
  // Закрепление применяем сразу на экране, не дожидаясь ответа: иначе строка
  // прыгает вверх с задержкой в полсекунды. При ошибке откатываем.
  const [pinOverride, setPinOverride] = useState<Record<string, string | null>>({});
  const pinnedAt = (c: Chat) => (c.id in pinOverride ? pinOverride[c.id] : c.pinned_at ?? null);

  // Лапка у чата, где сейчас чей-то питомец (свой или собеседника).
  const petsOn = usePetsAvailable();
  const petChatsAll = usePetChats();
  const petChats = petsOn ? petChatsAll : new Set<string>();
  const togglePin = async (chat: Chat) => {
    if ((chat as any).kind === "wall") { setPinSwipedId(null); return; }
    const next = pinnedAt(chat) ? null : new Date().toISOString();
    setPinSwipedId(null);
    setPinOverride((p) => ({ ...p, [chat.id]: next }));
    try {
      await api.pinChat(chat.id, !!next);
      await onRefresh?.();
    } catch (e: any) {
      setPinOverride((p) => { const { [chat.id]: _, ...rest } = p; return rest; });
      toast.error(e?.message || t("Не получилось"));
    }
  };
  const swipeStartRef = useRef<{ x: number; y: number; id: string } | null>(null);
  // После свайпа по строке тап не считается ещё ~0.4 с: click приходит следом за
  // touchend, когда состояние уже «закрыто», и открывал диалог вместо того,
  // чтобы просто вернуть плитку на место (баг-репорт da0707c0, iPhone). Та же
  // пауза — на время анимации возврата плитки.
  const swipeLockRef = useRef(0);
  const SWIPE_LOCK_MS = 400;

  // Свой профиль — при входе, а не на каждое обновление списка: раньше это
  // был запрос раз в 5 секунд (в баг-репорте — 436 за 54 минуты).
  useEffect(() => {
    fetchCurrentUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
  useEffect(() => {
    loadChatParticipants(chats);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chats]);

  // Вернулись в приложение — свежий профиль: аура или её анимация могли
  // смениться на другом устройстве. Не чаще раза в 20 с.
  useEffect(() => {
    let last = Date.now();
    const h = () => {
      if (document.visibilityState !== "visible" || Date.now() - last < 20_000) return;
      last = Date.now();
      void fetchCurrentUser();
    };
    document.addEventListener("visibilitychange", h);
    return () => document.removeEventListener("visibilitychange", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchCurrentUser = async () => {
    try {
      const profile = await api.getCurrentUser();
      
      if (profile && profile.id) {
        setCurrentUser(profile);
        writeCache("user", profile);
        applyServerSettings(profile);
        applyProfileLang(profile);
        // Первый вход: язык устройства — в профиль, чтобы переводы знали, на что переводить.
        if (!(profile as { language?: string }).language) { api.updateProfile(profile.id, { language: getLang() }).catch(() => {}); }
        // Свой аватар и обложку — в память сразу: профиль откроется без скелетона.
        if (profile.avatar_url) preloadImage(mediaUrl(profile.avatar_url));
        if ((profile as { cover_url?: string | null }).cover_url) preloadImage(mediaUrl((profile as { cover_url?: string | null }).cover_url!));
      } else {
        console.warn("No valid user profile found");
      }
    } catch (error: any) {
      console.error("Error fetching current user profile:", error);
      // Молчим, если профиль уже показан из кеша: ругаться на фоновое
      // обновление незачем, пользователь видит рабочий экран.
      if (!currentUser) toast.error(t("Не удалось загрузить профиль"));
    }
  };

  // Загружаем участников для всех чатов.
  //
  // Участники приходят отдельным запросом на каждый чат, поэтому до их ответа
  // в списке вместо имени показывался идентификатор — при каждом открытии
  // приложения. Кешируем их локально: список рисуется мгновенно из кеша, а
  // сеть только обновляет данные в фоне.
  const loadChatParticipants = async (chatsArray: Chat[]) => {
    const cached = readParticipantsCache();
    const participantsMap: {[chatId: string]: Profile[]} = { ...cached };
    const loadingMap: {[chatId: string]: boolean} = {};

    // Показываем кеш сразу и помечаем загрузкой только то, чего в нём нет —
    // иначе известные чаты моргали бы надписью «Загрузка».
    if (Object.keys(cached).length > 0) {
      setChatParticipants(cached);
    }
    chatsArray.forEach(chat => {
      if (!cached[chat.id]) loadingMap[chat.id] = true;
    });
    setLoadingParticipants(loadingMap);

    for (const chat of chatsArray) {
      // Сервер отдаёт участников прямо в списке чатов — отдельный запрос нужен
      // только старым версиям бэкенда, где этого поля ещё нет.
      const inline = (chat as any).participants;
      if (Array.isArray(inline)) {
        participantsMap[chat.id] = inline;
        continue;
      }
      try {
        const participants = await api.getChatParticipants(chat.id);
        participantsMap[chat.id] = Array.isArray(participants) ? participants : [];
      } catch (error) {
        console.error(`Error loading participants for chat ${chat.id}:`, error);
        // Ошибку сети кешем не перетираем: старые имена лучше пустоты.
        participantsMap[chat.id] = participantsMap[chat.id] || [];
      }
    }

    setChatParticipants(participantsMap);
    setLoadingParticipants({});
    writeParticipantsCache(participantsMap);
  };

  const searchUsers = async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    try {
      // Люди — по началу ника (без скрывших себя из поиска), в личном режиме
      // ещё и каналы. Ботов не ищут: к ним — по ссылке и «Начать».
      const [people, chans] = await Promise.all([
        api.searchPeople(query.replace(/^@/, "")).catch(() => [] as Profile[]),
        mode === "user" ? api.discoverChannels(query).catch(() => []) : Promise.resolve([]),
      ]);
      setSearchResults(Array.isArray(people) ? people : []);
      setChannelResults(Array.isArray(chans) ? chans : []);
    } catch (error: any) {
      console.error("Error searching users:", error);
    }
  };

  const createChat = async (friendId: string) => {
    try {
      const chat = await api.createDirectChat(friendId);
      
      onChatCreated();
      handleSelectChat(chat.id);
      
    } catch (error: any) {
      console.error("Error creating chat:", error);
      if (error?.message === "exists") {
        handleSelectChat(error.chatId);
      } else {
        toast.error(t("Ошибка создания чата"));
      }
    }
  };

  // Кого звать в группу: собеседники из личных переписок, недавние первыми.
  // Список виден сразу, ввод его фильтрует; точный ник находит и остальных.
  const groupContacts = useMemo(() => {
    if (!groupMode) return [];
    const seen = new Set<string>();
    const out: Profile[] = [];
    const direct = chats
      .filter((c) => !c.is_group && !["saved", "ideabox", "channel", "secret", "system", "wall"].includes((c as any).kind || "direct"))
      .sort((a, b) => (b.last_message_at || b.created_at || "").localeCompare(a.last_message_at || a.created_at || ""));
    for (const c of direct) {
      const people = chatParticipants[c.id]?.length ? chatParticipants[c.id] : c.participants || [];
      for (const p of people) {
        if (p.id === userId || seen.has(p.id) || (p as any).is_bot) continue;
        seen.add(p.id);
        out.push(p);
      }
    }
    return out;
  }, [groupMode, chats, chatParticipants, userId]);
  const groupQuery = searchQuery.trim().replace(/^@/, "").toLowerCase();
  const groupCandidates: Profile[] = groupMode
    ? [
        ...groupContacts.filter((p) => !groupQuery || (p.username || "").toLowerCase().includes(groupQuery)),
        ...searchResults.filter((r) => r.id !== userId && !groupContacts.some((p) => p.id === r.id)),
      ]
    : searchResults;

  const toggleGroupMember = (user: Profile) => {
    setGroupMembers((prev) =>
      prev.some((m) => m.id === user.id)
        ? prev.filter((m) => m.id !== user.id)
        : [...prev, user]
    );
  };

  const resetDialog = () => {
    setMode("user");
    setGroupName("");
    setGroupMembers([]);
    setSearchQuery("");
    setSearchResults([]);
    setChannelResults([]);
    setChName(""); setChUsername(""); setChDesc(""); setChSign(false);
    setTgUrl("");
  };

  // Зеркало Telegram-канала: ссылка t.me/… → канал WYX, посты придут через минуту.
  const [tgUrl, setTgUrl] = useState("");
  const addTelegram = async () => {
    const url = tgUrl.trim();
    if (!url) return;
    setChBusy(true);
    try {
      const ch = await api.addTelegramChannel(url);
      toast.success(ch.tg_state === "active" ? t("Канал подключён") : t("Подключаем — посты появятся в течение минуты"));
      resetDialog();
      onChatCreated();
      handleSelectChat(ch.id, ch.name, "channel");
    } catch (e: any) {
      toast.error(e?.message || t("Не удалось подключить канал"));
    } finally {
      setChBusy(false);
    }
  };

  const createChannel = async () => {
    const name = chName.trim();
    if (name.length < 2) { toast.error(t("Название короче 2 символов")); return; }
    setChBusy(true);
    try {
      const ch = await api.createChannel({
        name,
        username: chUsername.trim() || undefined,
        description: chDesc.trim() || undefined,
        sign_posts: chSign,
      });
      toast.success(t("Канал создан"));
      resetDialog();
      onChatCreated();
      handleSelectChat(ch.id, ch.name, "channel");
    } catch (e: any) {
      toast.error(e?.message || t("Не удалось создать канал"));
    } finally {
      setChBusy(false);
    }
  };

  const openChannelFromSearch = (ch: any) => {
    // Просто открываем — getChannel работает для любого публичного канала,
    // подписка происходит уже внутри ленты.
    handleSelectChat(ch.id, ch.name, "channel");
  };

  const createGroup = async () => {
    if (groupMembers.length < 2) {
      toast.error(t("Выберите хотя бы двух участников"));
      return;
    }
    try {
      const chat = await api.createChat(
        groupMembers.map((m) => m.id),
        { name: groupName.trim() || groupMembers.map((m) => m.username).join(", ") }
      );
      toast.success(t("Группа создана"));
      resetDialog();
      onChatCreated();
      handleSelectChat(chat.id, chat.name || t("Группа"));
    } catch {
      toast.error(t("Не удалось создать группу"));
    }
  };

  // Функция удаления чата
  const deleteChat = async (chatId: string, chatTitle: string, skipConfirm = false) => {
    setChatMenu(null);
    setSwipedChatId(null);
    const target = chats.find((c) => c.id === chatId) as (Chat & { kind?: string; is_group?: boolean; creator?: string | null }) | undefined;
    // Группу и канал у всех удаляет только владелец. Остальные выходят из
    // группы или отписываются от канала — у других участников всё остаётся.
    const isChannel = target?.kind === "channel";
    if (target && (isChannel || target.is_group) && String(target.creator ?? "") !== String(currentUser?.id ?? "")) {
      const ok = await confirmDialog(
        isChannel ? t("Отписаться от канала «{title}»?", { title: chatTitle }) : t("Выйти из группы «{title}»? У остальных участников переписка останется.", { title: chatTitle }),
        { ok: isChannel ? t("Отписаться") : t("Выйти из группы") },
      );
      if (!ok) return;
      try {
        setDeletingChats(prev => ({ ...prev, [chatId]: true }));
        await api.deleteChat(chatId);
        toast.success(isChannel ? t("Вы отписались от канала") : t("Вы вышли из группы"));
        onChatDeleted(chatId);
      } catch {
        toast.error(t("Не получилось"));
      } finally {
        setDeletingChats(prev => ({ ...prev, [chatId]: false }));
      }
      return;
    }
    if (!skipConfirm && !(await confirmDialog(t("Вы уверены, что хотите удалить чат \"{title}\"?", { title: chatTitle })))) {
      return;
    }
    // Второе подтверждение: удаление стирает переписку у всех, вернуть её нельзя.
    const warn = target?.kind === "channel"
      ? t("Канал удалится вместе со всеми постами и не сохранится.")
      : target?.is_group
        ? t("Группа удалится у всех участников вместе с перепиской и не сохранится.")
        : t("Переписка удалится у вас и у собеседника и не сохранится. Если потом снова начать чат с этим человеком, он будет пустым.");
    if (!(await confirmDialog(warn, { ok: t("Удалить навсегда") }))) return;

    try {
      setDeletingChats(prev => ({ ...prev, [chatId]: true }));
      
      console.log(`Deleting chat ${chatId}...`);
      await api.deleteChat(chatId);
      
      toast.success(t("Чат удален"));
      onChatDeleted(chatId);
      
    } catch (error: any) {
      console.error("Error deleting chat:", error);
      toast.error(t("Не удалось удалить чат"));
    } finally {
      setDeletingChats(prev => ({ ...prev, [chatId]: false }));
    }
  };

  // Обработчик выбора чата - сворачиваем сайдбар
  const handleSelectChat = (chatId: string, title?: string, kind?: string) => {
    onSelectChat(chatId, title, kind);
  };

  // Получаем участников для конкретного чата
  const getChatParticipants = (chatId: string): Profile[] => {
    return chatParticipants[chatId] || [];
  };

  // Проверяем, загружаются ли участники для чата
  const isLoadingParticipants = (chatId: string): boolean => {
    return loadingParticipants[chatId] === true;
  };

  // Проверяем, удаляется ли чат
  const isDeletingChat = (chatId: string): boolean => {
    return deletingChats[chatId] === true;
  };

  return (
    <div
      ref={listRef}
      className="bg-background border-r border-border flex flex-col w-full md:w-80 lg:w-96">
      {/* Шапка: аватар + имя + «В сети», справа шестерёнка и красный «+»
          (открывает диалог нового чата). Ниже — поиск по списку. */}
      <div ref={topRef} className={mint ? "mint-glass mint-glass-over px-4 pt-2 pb-3 pad-safe-top" : "px-4 pt-2 pb-3 pad-safe-top"}>
        <div className={mint ? "mint-head !px-0 !pt-1 !pb-0" : "flex items-center gap-3 h-14 md:h-16"}>
          {mint && (
            <>
              <button type="button" onClick={() => setEditMode((v) => !v)} className="mint-pill mint-btn mint-ink">
                {editMode ? t("Готово") : t("Изм.")}
              </button>
              <span className="mint-title">{t("Чаты")}</span>
            </>
          )}
          {!mint && (
            <>
              <button
                type="button"
                onClick={onOpenProfile}
                disabled={!onOpenProfile}
                className="flex items-center gap-3 flex-1 min-w-0 text-left"
                title={t("Профиль")}
              >
                {/* Свой статус — аурой вокруг аватара, как у собеседников; «Скрыт» — без неё. */}
                <Aura active={!!currentUser && !currentUser.hide_online} owner={currentUser} size={40}>
                  <Identicon
                    id={currentUser?.id || "?"}
                    avatarUrl={currentUser?.avatar_url}
                    className="ui-me-avatar w-10 h-10"
                  />
                </Aura>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-h2 md:text-[15px]">
                    <span className="truncate">{currentUser?.username || t("Загрузка…")}</span>
                  </span>
                  {/* Вместо «В сети» — значение своей ауры; «Скрыт» остаётся подписью:
                      ауры при нём нет, и без подписи было бы непонятно почему. */}
                  {currentUser?.hide_online ? (
                    <span className="ui-status-chip inline-block text-small text-subtle">{t("Скрыт")}</span>
                  ) : currentUser?.aura_text ? (
                    <span className="block text-small text-subtle truncate">{currentUser.aura_text}</span>
                  ) : null}
                </span>
              </button>
              <button
                type="button"
                onClick={() => openTranslator()}
                className="ui-icon-btn p-2 text-muted-foreground active:text-foreground"
                aria-label={t("Переводчик")}
                title={t("Переводчик")}
              >
                <LanguagesIcon className="w-6 h-6" />
              </button>
              <button
                type="button"
                onClick={onOpenProfile}
                className="ui-icon-btn p-2 text-muted-foreground active:text-foreground"
                aria-label={t("Настройки")}
              >
                <SettingsIcon className="w-6 h-6" />
              </button>
            </>
          )}
        {(
          <Dialog>
            <DialogTrigger asChild>
              {mint ? (
                <button type="button" className="mint-lime w-[56px] h-[33px] flex items-center justify-center text-[30px] font-light leading-none pb-1" aria-label={t("Новый чат")} title={t("Новый чат")}>+</button>
              ) : (
              <button
                type="button"
                className="ui-plus w-11 h-11 md:w-9 md:h-9 shrink-0 rounded-full bg-primary text-primary-foreground flex items-center justify-center active:brightness-90 hover:brightness-110"
                aria-label={t("Новый чат")}
                title={t("Новый чат")}
              >
                <PlusIcon className="w-6 h-6 md:w-5 md:h-5" />
              </button>
              )}
            </DialogTrigger>
            <DialogContent className="bg-card border-border">
              <DialogHeader>
                <DialogTitle>{mode === "group" ? t("Новая группа") : mode === "channel" ? t("Новый канал") : t("Найти")}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="flex gap-2">
                  <Button type="button" variant={mode === "user" ? "default" : "outline"} className="flex-1" onClick={() => setMode("user")}>{t("Личный")}</Button>
                  <Button type="button" variant={mode === "group" ? "default" : "outline"} className="flex-1" onClick={() => setMode("group")}>
                    <Users className="w-4 h-4 mr-1.5" />{t("Группа")}</Button>
                  <Button type="button" variant={mode === "channel" ? "default" : "outline"} className="flex-1" onClick={() => setMode("channel")}>
                    <Radio className="w-4 h-4 mr-1.5" />{t("Канал")}</Button>
                </div>

                {mode === "channel" && (
                  <div className="space-y-3">
                    <Input placeholder={t("Название канала")} value={chName} onChange={(e) => setChName(e.target.value)} className="bg-secondary/50" />
                    <Input placeholder={t("@username (необязательно)")} value={chUsername} onChange={(e) => setChUsername(e.target.value)} className="bg-secondary/50" />
                    <textarea placeholder={t("Описание (необязательно)")} value={chDesc} onChange={(e) => setChDesc(e.target.value)} rows={3} className="w-full bg-secondary/50 px-3 py-2 outline-none resize-none text-sm" />
                    <label className="flex items-center gap-2 text-sm text-muted-foreground">
                      <input type="checkbox" checked={chSign} onChange={(e) => setChSign(e.target.checked)} />{t("Показывать авторов постов")}</label>
                    <Button type="button" onClick={createChannel} disabled={chBusy || chName.trim().length < 2} className="w-full bg-gradient-primary">{t("Создать канал")}</Button>
                    <div className="flex items-center gap-3 text-caption text-subtle"><span className="flex-1 h-px bg-border" />{t("или по ссылке")}<span className="flex-1 h-px bg-border" /></div>
                    <Input placeholder={t("Ссылка на публичный канал или @имя")} value={tgUrl} onChange={(e) => setTgUrl(e.target.value)} className="bg-secondary/50" inputMode="url" autoCapitalize="off" />
                    <p className="text-caption text-subtle">{t("Публичный канал появится у вас как канал WYX и будет обновляться сам. Реакции и комментарии — только от людей из WYX.")}</p>
                    <Button type="button" variant="outline" onClick={addTelegram} disabled={chBusy || !tgUrl.trim()} className="w-full">{t("Добавить по ссылке")}</Button>
                  </div>
                )}

                {groupMode && (
                  <>
                    <Input
                      placeholder={t("Название группы")}
                      value={groupName}
                      onChange={(e) => setGroupName(e.target.value)}
                      className="bg-secondary/50"
                    />
                    {groupMembers.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {groupMembers.map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => toggleGroupMember(m)}
                            className="px-2 py-1 text-xs bg-primary text-primary-foreground flex items-center gap-1"
                          >
                            {m.username}
                            <X className="w-3 h-3" />
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}

                {mode === "user" && (
                  <div className="rounded-lg bg-secondary/50 p-3 space-y-2">
                    <p className="text-sm">{t("Поиска по людям нет. Чтобы начать переписку, отправьте человеку ссылку на свой профиль — она откроется у него прямо в WYX.")}</p>
                    <Button
                      type="button"
                      variant="secondary"
                      className="w-full"
                      disabled={!username}
                      onClick={async () => {
                        if (!username) return;
                        const r = await shareProfile(username);
                        if (r === "copied") sonnerToast.success(t("Ссылка скопирована"));
                        else if (r === "error") sonnerToast.error(t("Не удалось поделиться"));
                      }}
                    >
                      <Share2 className="w-4 h-4 mr-2" />{t("Поделиться профилем")}</Button>
                  </div>
                )}

                {mode !== "channel" && (
                <>
                <Input
                  placeholder={mode === "group" ? t("Имя из переписок или ник") : t("Ник человека или название канала")}
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    searchUsers(e.target.value);
                  }}
                  className="bg-secondary/50"
                />
                <ScrollArea className="h-64">
                  <div className="space-y-2">
                    {groupCandidates.map((user) => (
                        <div
                          key={user.id}
                          className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 hover:bg-secondary cursor-pointer transition-colors"
                          onClick={() => (groupMode ? toggleGroupMember(user) : createChat(user.id))}
                        >
                          <div className="flex items-center gap-3">
                            {groupMode ? (
                              <Identicon id={user.id} avatarUrl={user.avatar_url} className="w-10 h-10" />
                            ) : (
                              <Avatar>
                                <AvatarFallback className="bg-gradient-primary text-primary-foreground">
                                  {user.username?.[0]?.toUpperCase() || "?"}
                                </AvatarFallback>
                              </Avatar>
                            )}
                            <span className="font-medium">{user.username}</span>
                            {(user as any).is_bot && (
                              <span className="text-caption text-subtle uppercase tracking-wide">{t("бот")}</span>
                            )}
                          </div>
                          {groupMode && groupMembers.some((m) => m.id === user.id) ? (
                            <Check className="w-4 h-4 text-primary" />
                          ) : (
                            <UserPlus className="w-4 h-4 text-muted-foreground" />
                          )}
                        </div>
                    ))}
                    {/* Каналы в той же выдаче (только в режиме личного) */}
                    {mode === "user" && channelResults.map((ch) => (
                      <div
                        key={ch.id}
                        className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 hover:bg-secondary cursor-pointer transition-colors"
                        onClick={() => openChannelFromSearch(ch)}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="w-9 h-9 shrink-0 bg-secondary flex items-center justify-center">
                            <Radio className="w-5 h-5 text-primary" />
                          </span>
                          <span className="min-w-0">
                            <span className="block font-medium truncate">{ch.name}</span>
                            <span className="block text-xs text-muted-foreground truncate">
                              {t("канал")} · {tn(ch.subscribers_count ?? 0, "{n} подписчик", "{n} подписчика", "{n} подписчиков")}{ch.username ? ` · @${ch.username}` : ""}
                            </span>
                          </span>
                        </div>
                      </div>
                    ))}
                    {groupCandidates.length === 0 && (mode !== "user" || channelResults.length === 0) && (
                      <div className="text-center text-muted-foreground py-8">
                        {searchQuery ? t("Ничего не найдено") : mode === "group" ? t("Введите имя или ник участника") : t("Введите ник человека или название канала")}
                      </div>
                    )}
                  </div>
                </ScrollArea>
                </>
                )}

                {groupMode && (
                  <Button
                    type="button"
                    onClick={createGroup}
                    disabled={groupMembers.length < 2}
                    className="w-full bg-gradient-primary"
                  >
                    {t("Создать группу ({n})", { n: groupMembers.length })}
                  </Button>
                )}
              </div>
            </DialogContent>
          </Dialog>
        )}
        </div>
        {(
          <label className={mint
            ? "mint-pill mt-[11px] flex items-center gap-[12px] h-[42px] px-[14px] mint-muted"
            : "ui-search mt-2 flex items-center gap-2 h-11 md:h-9 px-3 rounded-md bg-surface-1 md:bg-transparent md:border md:border-border text-subtle focus-within:ring-1 focus-within:ring-amber md:focus-within:border-amber md:focus-within:ring-0"}>
            {mint ? <MintIcon name="search" size={[15, 16]} /> : <SearchIcon className="w-5 h-5 md:w-4 md:h-4 shrink-0" />}
            <input
              value={listFilter}
              onChange={(e) => setListFilter(e.target.value)}
              placeholder={mint ? t("Поиск чатов, людей и сообщений") : t("Поиск чатов, людей и сообщений")}
              className={mint ? "flex-1 min-w-0 bg-transparent outline-none text-[14.3px] text-foreground placeholder:text-[var(--mint-muted)]" : "flex-1 min-w-0 bg-transparent outline-none text-body md:text-small text-foreground placeholder:text-subtle"}
            />
            {listFilter && (
              <button type="button" onClick={() => setListFilter("")} className="p-1 -mr-1 text-subtle active:text-foreground" aria-label={t("Очистить")}>
                <XIcon className="w-4 h-4" />
              </button>
            )}
          </label>
        )}
        {(
          <div className={mint
            ? "mint-card mt-[11px] h-[47px] flex items-center gap-2 px-[10px] overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            : "mt-2.5 flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden -mx-4 px-4 pb-1"}>
            {([
              { id: "all", label: t("Все") },
              { id: "unread", label: t("Непрочитанные"), count: unreadChats },
              { id: "channels", label: t("Каналы") },
            ] as const).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setListTab(t.id)}
                aria-pressed={listTab === t.id}
                className={mint
                  ? `shrink-0 h-[26px] px-[13px] text-[12.7px] inline-flex items-center gap-1.5 ${listTab === t.id ? "mint-lime" : "mint-pill mint-ink"}`
                  : `ui-chip shrink-0 h-8 px-3 rounded-full text-small font-medium inline-flex items-center gap-1.5 transition-colors ${
                  listTab === t.id ? "ui-chip-on bg-primary text-primary-foreground" : "bg-surface-1 text-muted-foreground active:bg-surface-3"
                }`}
              >
                {t.label}
                {"count" in t && t.count > 0 && !mint && (
                  <span className="ui-chip-count min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[11px] leading-none font-semibold inline-flex items-center justify-center">
                    {t.count > 99 ? "99+" : t.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
        {/* Плашка обновления — под фильтрами, где до неё точно дотянуться
            (на телефоне; на компьютере она сверху окна, см. pages/Chat). */}
        {isMobileLayout && <div className="px-3 pt-2"><UpdateBanner rounded /></div>}
      </div>

      {/* Индикатор жеста «потянуть вниз»: следует за пальцем, страницу не двигает */}
      <div
        className="relative z-10 flex items-center justify-center overflow-hidden shrink-0"
        style={{
          height: pull,
          transition: refreshing || pull === 0 ? "height 200ms ease-out" : "none",
        }}
      >
        <RefreshCw
          className={`w-4 h-4 text-primary ${refreshing ? "animate-spin" : ""}`}
          style={{ opacity: Math.min(pull / 60, 1) }}
        />
      </div>

      {/* Список чатов. Отступ сверху — под мини-плеер: он стоит полосой над
          списком, и без отступа накрывал бы первую строку. */}
      {/* «Мята»: список уходит под стеклянную шапку (поиск и фильтры) и размывается. */}
      <ScrollArea className="flex-1" style={mint ? { marginTop: "calc(-1 * var(--glass-h, 0px))" } : undefined}>
        {/* Под мини-плеер отступаем только на телефоне: на десктопе он висит
            справа над перепиской, а список от него зря уезжал вниз. */}
        <div className={mint ? "ui-chat-list" : undefined} style={{ paddingTop: mint ? `calc(${isMobileLayout ? "var(--player-h, 0px) + var(--call-h, 0px)" : "0px"} + var(--glass-h, 0px))` : isMobileLayout ? "calc(var(--player-h, 0px) + var(--call-h, 0px))" : "0px", transition: "padding-top 220ms cubic-bezier(0.32,0.72,0,1)" }}>
          {/* «Долгий ящик» — идеи разработчику; доступен всем, всегда первым. */}
          {onOpenIdeabox && sections.ideabox && rowMatches(t("Долгий ящик")) && (
            <div className="relative overflow-hidden">
            {hideSwipeButton("ideabox")}
            <button
              type="button"
              onClick={sectionClick("ideabox", onOpenIdeabox)}
              {...sectionPress("ideabox")}
              style={swipeStyle("ideabox")}
              className={`relative w-full flex items-center gap-3 px-4 py-3 text-left border-l-4 transition-transform ${
                ideabox && selectedChatId === ideabox.id ? "bg-surface-3 border-primary" : "bg-background border-transparent hover:bg-surface-2"
              }`}
            >
              {ideabox?.avatar_url ? (
                <CachedImg src={mediaUrl(ideabox.avatar_url)} alt="" className="w-[46px] h-[46px] md:w-9 md:h-9 shrink-0 rounded-full object-cover bg-surface-1" />
              ) : (
                <div className="w-[46px] h-[46px] md:w-9 md:h-9 shrink-0 rounded-full bg-surface-1 md:bg-transparent flex items-center justify-center">
                  <Lightbulb className="w-6 h-6 md:w-5 md:h-5 text-amber" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-h2 md:text-[15px] truncate">{t("Долгий ящик")}</p>
                <p className="text-small text-subtle truncate">{t("Идеи и предложения разработчику")}</p>
              </div>
              {ideabox && ideabox.unread > 0 ? (
                <span className="shrink-0 min-w-[22px] h-[22px] px-1.5 rounded-full bg-primary text-primary-foreground text-[12px] leading-none font-semibold flex items-center justify-center">
                  {ideabox.unread > 99 ? "99+" : ideabox.unread}
                </span>
              ) : (
                <ArrowRightIcon className="w-5 h-5 md:w-4 md:h-4 text-subtle shrink-0" />
              )}
            </button>
            </div>
          )}
          {(onOpenWall || offDock("wall")) && sections.wall && rowMatches(t("Стена")) && (
            <div className={`relative overflow-hidden ${offDock("wall") ? "block" : "hidden md:block"}`}>
            {hideSwipeButton("wall")}
            <button
              type="button"
              onClick={sectionClick("wall", onOpenWall ?? (() => navigateTo("/wall")))}
              {...sectionPress("wall")}
              style={swipeStyle("wall")}
              className={`relative w-full flex items-center gap-3 px-4 py-3 text-left border-l-4 transition-transform ${
                wallSelected ? "bg-surface-3 border-primary" : "bg-background border-transparent hover:bg-surface-2"
              }`}
            >
              <div className="w-[46px] h-[46px] md:w-9 md:h-9 shrink-0 rounded-full bg-surface-1 md:bg-transparent flex items-center justify-center">
                <Newspaper className="w-6 h-6 md:w-5 md:h-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-h2 md:text-[15px] truncate">{t("Стена")}</p>
                <p className="text-small text-subtle truncate">{wallNew ? t("Общая лента · новых: {n}", { n: wallNew }) : t("Общая лента — пишут все")}</p>
              </div>
              {wallNew ? <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-[11px] font-bold flex items-center justify-center">{wallNew}</span> : <ArrowRightIcon className="w-5 h-5 md:w-4 md:h-4 text-subtle shrink-0" />}
            </button>
            </div>
          )}
          {(isMobileLayout ? offDock("saved") : !!onOpenSaved) && rowMatches(t("Избранное")) && (
            <button
              type="button"
              onClick={onOpenSaved && !isMobileLayout ? onOpenSaved : () => navigateTo("/saved")}
              className={`w-full flex items-center gap-3 px-4 py-3 text-left border-l-4 ${
                savedChatId && selectedChatId === savedChatId ? "bg-surface-3 border-primary" : "border-transparent hover:bg-surface-2"
              }`}
            >
              <div className="w-[46px] h-[46px] md:w-9 md:h-9 shrink-0 rounded-full bg-surface-1 md:bg-transparent flex items-center justify-center">
                <StarIcon className="w-6 h-6 md:w-5 md:h-5 text-amber" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-h2 md:text-[15px] truncate">{t("Избранное")}</p>
                <p className="text-small text-subtle truncate">{t("Сообщения для себя")}</p>
              </div>
              <ArrowRightIcon className="w-5 h-5 md:w-4 md:h-4 text-subtle shrink-0" />
            </button>
          )}
          {offDock("music") && rowMatches(t("Музыка")) && (
            <button type="button" onClick={() => navigateTo("/music")}
              className="w-full flex items-center gap-3 px-4 py-3 text-left border-l-4 border-transparent hover:bg-surface-2">
              <div className="w-[46px] h-[46px] md:w-9 md:h-9 shrink-0 rounded-full bg-surface-1 md:bg-transparent flex items-center justify-center">
                <Music2 className="w-6 h-6 md:w-5 md:h-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-h2 md:text-[15px] truncate">{t("Музыка")}</p>
                <p className="text-small text-subtle truncate">{t("Плейлисты и эфиры")}</p>
              </div>
              <ArrowRightIcon className="w-5 h-5 md:w-4 md:h-4 text-subtle shrink-0" />
            </button>
          )}
          {chats.length > 0 ? (
            // ui-chat-list — общая подложка строк: в стиле «мягкие карточки»
            // список лежит в одной белой карточке (index.css).
            <div className={mint ? undefined : "ui-chat-list"}>{[...chats].sort((x, y) => {
              // Закреплённые сверху, позже закреплённый выше; остальные — по
              // времени последнего сообщения. Тот же порядок отдаёт сервер;
              // здесь он держится и между обновлениями списка (закрепили —
              // строка уезжает вверх сразу, не дожидаясь ответа).
              // Стена — всегда первой строкой.
              const wx = (x as any).kind === "wall", wy = (y as any).kind === "wall";
              if (wx !== wy) return wx ? -1 : 1;
              const px = pinnedAt(x), py = pinnedAt(y);
              if (px && py) return py.localeCompare(px);
              if (px) return -1;
              if (py) return 1;
              const tx = x.last_message_at || x.created_at || "";
              const ty = y.last_message_at || y.created_at || "";
              return ty.localeCompare(tx);
            }).filter((chat) => {
              if (listTab === "unread" && !(((chat as any).unread_count || 0) > 0)) return false;
              if (listTab === "channels" && (chat as any).kind !== "channel" && (chat as any).kind !== "wall") return false;
              const q = listFilter.trim().toLowerCase();
              if (!q) return true;
              if ((chat.name || "").toLowerCase().includes(q)) return true;
              return getChatParticipants(chat.id).some((p) => (p.username || "").toLowerCase().includes(q));
            }).map((chat) => {
              
              // Два источника имён: отдельный кеш участников и сам список чатов
              // (сервер кладёт участников прямо в него, и он тоже кешируется).
              // Без второго при первом запуске мелькало «Чат 32aec835…».
              const cachedPeople = getChatParticipants(chat.id);
              const participants = cachedPeople.length ? cachedPeople : (chat.participants || []);
              const isLoading = isLoadingParticipants(chat.id);
              const isDeleting = isDeletingChat(chat.id);
              const otherParticipants = participants.filter(p => p.id !== currentUser?.id);
              const displayParticipants = otherParticipants.length > 0 ? otherParticipants : participants;
              
              const isWall = (chat as any).kind === "wall";
              const isChannel = (chat as any).kind === "channel" || isWall;
              // Формируем название чата
              let chatTitle = isWall ? t("Стена") : isChannel
                ? ((chat as any).name || t("Канал"))
                : chat.is_group ? (chat.name || t("Группа")) : t("Без названия");

              if (isChannel || chat.is_group) {
                // название уже задано
              } else if (displayParticipants.length > 0) {
                const names = displayParticipants.map(p => p.username).filter(Boolean);
                chatTitle = names.join(", ") || t("Без названия");
              } else if (participants.length === 0) {
                chatTitle = t("Чат {id}...", { id: chat.id.slice(0, 8) });
              }

              return (
                <div
                  key={chat.id}
                  className={`chat-row relative ${mint && swipedChatId !== chat.id && pinSwipedId !== chat.id ? "overflow-visible" : "overflow-hidden"}${swipedChatId === chat.id ? " row-swiped" : ""}${pinSwipedId === chat.id ? " row-pin-swiped" : ""}`}
                >
                  {/* Разделитель с полями 16 px; после последней строки и на десктопе его нет. */}
                  <div className="chat-row-divider absolute bottom-0 left-4 right-4 h-px bg-border pointer-events-none z-10 md:hidden" />
                  {/* Закрепление — свайпом вправо (телефон): кнопка слева, под строкой */}
                  <button
                    type="button"
                    onClick={() => togglePin(chat)}
                    className="absolute inset-y-0 left-0 w-20 bg-amber text-background flex flex-col items-center justify-center gap-0.5 md:hidden"
                    tabIndex={pinSwipedId === chat.id ? 0 : -1}
                    aria-label={pinnedAt(chat) ? t("Открепить чат") : t("Закрепить чат")}
                  >
                    <Pin className="w-5 h-5" />
                    <span className="text-[10px] font-semibold">{pinnedAt(chat) ? t("Открепить") : t("Закрепить")}</span>
                  </button>

                  {/* Красная кнопка удаления — открывается свайпом влево (телефон) */}
                  <button
                    type="button"
                    onClick={() => deleteChat(chat.id, chatTitle, true)}
                    className="absolute inset-y-0 right-0 w-20 bg-destructive text-white flex items-center justify-center md:hidden"
                    tabIndex={swipedChatId === chat.id ? 0 : -1}
                    aria-label={t("Удалить чат")}
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>

                  {/* Содержимое строки: ездит по свайпу, правый клик → меню */}
                  <div
                    className={`chat-row-card group relative pl-3 pr-4 py-3 md:py-2.5 md:mr-1 md:rounded-r-lg flex items-center gap-3.5 md:gap-3 transition-transform border-l-4 ${
                      selectedChatId === chat.id ? "bg-surface-3 border-primary" : "bg-background border-transparent active:bg-surface-2 md:hover:bg-surface-2"
                    } ${isDeleting ? "opacity-50 pointer-events-none" : ""} ${
                      ""
                    }`}
                    style={{ transform: swipedChatId === chat.id ? "translateX(-80px)" : pinSwipedId === chat.id ? "translateX(80px)" : "translateX(0)" }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setChatMenu({ x: e.clientX, y: e.clientY, chatId: chat.id, title: chatTitle });
                    }}
                    onTouchStart={(e) => {
                      swipeStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, id: chat.id };
                    }}
                    onTouchEnd={(e) => {
                      const s = swipeStartRef.current;
                      swipeStartRef.current = null;
                      if (!s || s.id !== chat.id) return;
                      const t = e.changedTouches[0];
                      const dx = t.clientX - s.x, dy = t.clientY - s.y;
                      // Палец заметно сдвинулся — это жест, не тап: click после него не в счёт.
                      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) swipeLockRef.current = Date.now() + SWIPE_LOCK_MS;
                      if (Math.abs(dx) > Math.abs(dy) * 1.5) {
                        // Влево — удаление, вправо — закрепление. Свайп в
                        // обратную сторону сначала закрывает открытую кнопку.
                        if (dx < -45) { setPinSwipedId(null); setSwipedChatId(chat.id); }
                        else if (dx > 45 && swipedChatId !== chat.id) { setSwipedChatId(null); setPinSwipedId(chat.id); }
                        else if (dx > 25) setSwipedChatId(null);
                        else if (dx < -25) setPinSwipedId(null);
                      }
                    }}
                  >
                  <button
                    onClick={() => {
                      if (Date.now() < swipeLockRef.current) return; // хвост свайпа или плитка ещё едет
                      if (swipedChatId === chat.id || pinSwipedId === chat.id) {
                        // Тап по сдвинутой плитке — вернуть на место; пока едет, тапы не считаем.
                        setSwipedChatId(null); setPinSwipedId(null);
                        swipeLockRef.current = Date.now() + SWIPE_LOCK_MS;
                        return;
                      }
                      handleSelectChat(chat.id, chatTitle, (chat as any).kind);
                    }}
                    // min-w-0: без него кнопка (flex-элемент) не ужимается ниже
                    // ширины своего содержимого, и длинное название чата
                    // выталкивало время отправки за правый край экрана.
                    className={`flex items-center gap-3 text-left ${
                      "flex-1 min-w-0"
                    }`}
                    disabled={isDeleting}
                  >
                    {isWall ? (
                      <div className="w-[46px] h-[46px] md:w-9 md:h-9 shrink-0 rounded-full bg-surface-3 flex items-center justify-center">
                        <Newspaper className="w-6 h-6 md:w-5 md:h-5 text-primary" />
                      </div>
                    ) : isChannel ? (
                      (chat as any).avatar_url ? (
                        <CachedImg src={mediaUrl((chat as any).avatar_url)} alt="" className="w-[46px] h-[46px] md:w-9 md:h-9 shrink-0 rounded-md object-cover" />
                      ) : (
                        <div className="w-[46px] h-[46px] md:w-9 md:h-9 shrink-0 rounded-full bg-surface-3 flex items-center justify-center">
                          <Radio className="w-6 h-6 md:w-5 md:h-5 text-primary" />
                        </div>
                      )
                    ) : chat.is_group ? (
                      (chat as any).avatar_url ? (
                        <CachedImg
                          src={mediaUrl((chat as any).avatar_url)}
                          alt=""
                          className="w-[46px] h-[46px] md:w-9 md:h-9 shrink-0 rounded-md object-cover"
                        />
                      ) : (
                        <div className="w-[46px] h-[46px] md:w-9 md:h-9 shrink-0 rounded-full bg-surface-3 flex items-center justify-center">
                          <Users className="w-6 h-6 md:w-5 md:h-5 text-primary" />
                        </div>
                      )
                    ) : (
                      // «В сети» — аурой вокруг аватара (components/Aura.tsx). Статус —
                      // из общего списка чатов: его обновляет сокет.
                      (() => {
                        const other = chat.participants?.find((p) => p.id !== currentUser?.id);
                        return (
                          <Aura active={!!other?.is_online} owner={other} size={40}>
                            <Identicon
                              id={displayParticipants[0]?.id || chat.id}
                              avatarUrl={displayParticipants[0]?.avatar_url}
                              className="w-[46px] h-[46px] md:w-9 md:h-9"
                            />
                          </Aura>
                        );
                      })()
                    )}

                    {(
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="text-h2 md:text-[15px] truncate min-w-0 flex items-center gap-1.5">
                            {pinnedAt(chat) && <Pin className="w-3.5 h-3.5 text-amber shrink-0" aria-label={t("Закреплён")} />}
                            {isChannel && !isWall && <Radio className="w-3.5 h-3.5 text-primary shrink-0" />}
                            {(chat as any).kind === "secret" && <Lock className="w-3.5 h-3.5 text-online shrink-0" aria-label={t("Секретный чат")} />}
                            <span className="truncate">{chatTitle}</span>
                            {petChats.has(chat.id) && <PawPrint className="w-3.5 h-3.5 text-primary shrink-0" aria-label={t("Здесь питомец")} />}
                          </p>
                          {mint && editMode ? (
                            <span className="shrink-0 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                              <span role="button" tabIndex={0} aria-label={pinnedAt(chat) ? t("Открепить") : t("Закрепить")}
                                onClick={(e) => { e.stopPropagation(); void togglePin(chat); }}
                                className={`mint-round !w-8 !h-8 ${pinnedAt(chat) ? "mint-lime" : "mint-pill mint-ink"}`}>
                                <Pin className="w-4 h-4" />
                              </span>
                              <span role="button" tabIndex={0} aria-label={t("Удалить чат")}
                                onClick={(e) => { e.stopPropagation(); void deleteChat(chat.id, chatTitle); }}
                                className="mint-round !w-8 !h-8 mint-pill text-destructive">
                                <Trash2 className="w-4 h-4" />
                              </span>
                            </span>
                          ) : (() => {
                            // Время последнего сообщения, а не изменения чата:
                            // updated_at меняют переименование, смена аватара и
                            // закрепление, и в списке стояло не то время.
                            // Сегодняшние — часы и минуты, вчерашние — «вчера»,
                            // старше — дата.
                            const iso = chat.last_message_at || (chat as any).last_message?.created_at || chat.updated_at;
                            if (!iso) return null;
                            const d = new Date(iso);
                            const today = new Date(); today.setHours(0, 0, 0, 0);
                            const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
                            const loc = LOCALE[getLang()] || "ru-RU";
                            const label = d >= today
                              ? d.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" })
                              : d >= yesterday
                                ? t("вчера")
                                : d.toLocaleDateString(loc, { day: "2-digit", month: "2-digit" });
                            return (
                              <span className="text-caption text-subtle shrink-0 inline-flex items-center gap-1">
                                {(chat as any).last_message?.sender_id === currentUser?.id && (
                                  // Одна галочка — ушло, две — прочитано.
                                  (chat as any).last_message?.read
                                    ? <CheckCheckIcon className="w-4 h-4 text-primary" />
                                    : <Check className="w-4 h-4 text-subtle" />
                                )}
                                {label}
                              </span>
                            );
                          })()}
                        </div>
                        <div className="flex items-center justify-between gap-2 mt-0.5">
                          <p className="text-body md:text-small text-subtle line-clamp-2 md:line-clamp-1 break-words flex-1 min-w-0">
                            {isLoading
                              ? t("Загрузка…")
                              : isWall
                                ? ((chat as any).unread_count ? t("Общая лента · новых: {n}", { n: (chat as any).unread_count }) : t("Общая лента — пишут все"))
                              : (chat as any).pending_for && !(chat as any).last_message
                                ? ((chat as any).pending_for === currentUser?.id ? t("Запрос на переписку") : t("Ждём, когда собеседник примет запрос"))
                              : (chat as any).kind === "secret" && !(chat as any).last_message
                                ? ((chat as any).secret?.state === "pending"
                                    ? ((chat as any).secret?.initiator_id === currentUser?.id ? t("Ждём, когда собеседник примет") : t("Приглашение в секретный чат"))
                                    : (chat as any).secret?.state === "declined" ? t("Секретный чат отклонён") : t("Секретный чат"))
                              : activityFor(chat.id).length
                                ? <span className="text-primary">{activityLabel(activityFor(chat.id), !!(chat as any).is_group)}</span>
                              : drafts[chat.id] && chat.id !== selectedChatId && (chat as any).kind !== "secret"
                                ? <><span className="text-destructive">{t("Черновик:")}</span> {drafts[chat.id].replace(/\s+/g, " ").slice(0, 140)}</>
                              : (chat as any).last_message
                                ? <>{(chat as any).last_message.sender_id === currentUser?.id ? t("Вы: ") : ""}{
                                    (chat as any).last_message.cipher
                                      ? (secretPreview[chat.id + (chat as any).last_message.cipher.slice(0, 16)] ?? t("🔒 Зашифрованное сообщение"))
                                      : <PreviewText text={serverPreview((chat as any).last_message.text)} emoji={(chat as any).last_message.emoji} />}</>
                                : t("Сообщений пока нет")}
                          </p>
                          {(chat as any).unread_mention && (
                            <span aria-label={t("Вас упомянули")} title={t("Вас упомянули или ответили вам")}
                              className="shrink-0 w-[22px] h-[22px] rounded-full bg-primary text-primary-foreground text-[13px] font-bold leading-none flex items-center justify-center">
                              @
                            </span>
                          )}
                          {/* Бейдж без text-caption: в «Мяте» подписи строки красятся в приглушённый цвет, и цифры бледнели. */}
                          {!!chat.unread_count && chat.unread_count > 0 && (
                            <span className="shrink-0 min-w-[22px] h-[22px] px-1.5 rounded-full bg-primary text-primary-foreground text-[12px] leading-none font-semibold flex items-center justify-center">
                              {chat.unread_count > 99 ? "99+" : chat.unread_count}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </button>

                  {/* Индикатор загрузки при удалении */}
                  {isDeleting && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/50">
                      <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                  </div>
                </div>
              );
            })}</div>
          ) : (
            <div className="text-center text-muted-foreground py-8 px-4">
              {t("Нет чатов. Создайте первый чат!")}
              {/* У нового человека чатов нет и писать некому — единственный путь
                  к первому диалогу — отдать друзьям ссылку на свой профиль. Та же
                  системная «Поделиться», что и в профиле, с откатом в буфер. */}
              {(
                <button
                  type="button"
                  disabled={!currentUser?.username}
                  onClick={async () => {
                    if (!currentUser?.username) return;
                    const r = await shareProfile(currentUser.username);
                    if (r === "copied") sonnerToast.success(t("Ссылка на профиль скопирована — отправьте её друзьям"));
                    else if (r === "error") sonnerToast.error(t("Не удалось поделиться"));
                  }}
                  className={mint
                    ? "mint-dark-pill mt-4 h-[42px] px-5 text-[12.7px] inline-flex items-center justify-center gap-[11px]"
                    : "mt-4 h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium inline-flex items-center justify-center gap-2 active:opacity-90"}
                >
                  {mint ? <MintIcon name="share" size={15} /> : <Share2 className="w-4 h-4" />}
                  {t("Пригласить друзей")}
                </button>
              )}
            </div>
          )}
          {/* Ниже моих чатов: люди по нику и сообщения (только мои чаты, каналы
              с подпиской и Стена — chat/views.py MessageSearchView). */}
          {peopleHits.length > 0 && (
            <div className="px-4 pt-2 pb-1">
              <p className="text-caption uppercase tracking-wide text-subtle mb-1">{t("Люди")}</p>
              {(peopleAll ? peopleHits : peopleHits.slice(0, 5)).map((person) => (
                <button key={person.id} type="button" onClick={() => { setListFilter(""); void createChat(person.id); }}
                  className="w-full flex items-center gap-3 py-2 text-left rounded-md hover:bg-surface-2 active:bg-surface-3">
                  <Aura active={false} owner={person as never} size={46}><Identicon id={person.id} avatarUrl={person.avatar_url} className="w-[46px] h-[46px] md:w-9 md:h-9" /></Aura>
                  <span className="min-w-0">
                    <span className="block text-h2 md:text-[15px] truncate">{person.username}</span>
                    <span className="block text-small text-subtle truncate">{(person as { bio?: string }).bio || `@${person.username}`} · {t("написать")}</span>
                  </span>
                </button>
              ))}
              {!peopleAll && peopleHits.length > 5 && (
                <button type="button" onClick={() => setPeopleAll(true)} className="w-full py-2 text-small text-primary text-left">
                  {t("Ещё люди: {n}", { n: peopleHits.length - 5 })}
                </button>
              )}
            </div>
          )}
          {msgSearch.active && (msgSearch.hits.length > 0 || msgSearch.loading) && (
            <div className="px-4 pt-2 pb-1">
              <p className="text-caption uppercase tracking-wide text-subtle mb-1">{t("Сообщения")}</p>
              {msgSearch.loading && !msgSearch.hits.length && <p className="py-2 text-small text-subtle">{t("Ищу…")}</p>}
              <MessageHits hits={msgSearch.hits} q={listFilter} showChat
                onPick={(h) => { setPendingJump(h.chat.id, h.id); setListFilter(""); handleSelectChat(h.chat.id, h.chat.title, h.chat.kind); }}
                hasMore={msgSearch.hasMore} onMore={msgSearch.more} loading={msgSearch.loading} />
            </div>
          )}
        </div>
        {/* Под плавающим островом «Мяты» — место, чтобы последний чат не прятался. */}
        <div aria-hidden style={{ height: "var(--mint-nav-space, 0px)" }} />
      </ScrollArea>

      {/* Меню чата по правому клику (десктоп) */}
      {sectionMenu && (
        <div
          className="fixed inset-0 z-[80]"
          onClick={() => setSectionMenu(null)}
          onContextMenu={(e) => { e.preventDefault(); setSectionMenu(null); }}
        >
          <div
            className="fixed min-w-[190px] bg-card border-2 border-border shadow-xl py-1"
            style={{
              left: Math.max(8, Math.min(sectionMenu.x, window.innerWidth - 208)),
              top: Math.max(8, Math.min(sectionMenu.y, window.innerHeight - 60)),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => void hideSection(sectionMenu.kind)}
              className="w-full px-4 py-2 text-left text-sm hover:bg-secondary flex items-center gap-2"
            >
              {sectionMenu.kind === "wall" ? t("Скрыть Стену") : t("Скрыть «Долгий ящик»")}</button>
          </div>
        </div>
      )}
      {chatMenu && (
        <div
          className="fixed inset-0 z-[80]"
          onClick={() => setChatMenu(null)}
          onContextMenu={(e) => { e.preventDefault(); setChatMenu(null); }}
        >
          <div
            className="fixed min-w-[170px] bg-card border-2 border-border shadow-xl py-1"
            style={{
              left: Math.max(8, Math.min(chatMenu.x, window.innerWidth - 188)),
              top: Math.max(8, Math.min(chatMenu.y, window.innerHeight - 60)),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => deleteChat(chatMenu.chatId, chatMenu.title)}
              className="w-full px-4 py-2 text-left text-sm text-destructive hover:bg-secondary flex items-center gap-2"
            >
              <Trash2 className="w-4 h-4" />{(() => {
                const c = chats.find((x) => x.id === chatMenu.chatId) as (Chat & { kind?: string; is_group?: boolean; creator?: string | null }) | undefined;
                const owner = String(c?.creator ?? "") === String(currentUser?.id ?? "");
                return c?.kind === "channel" && !owner ? t("Отписаться") : c?.is_group && !owner ? t("Выйти из группы") : t("Удалить чат");
              })()}</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatSidebar;