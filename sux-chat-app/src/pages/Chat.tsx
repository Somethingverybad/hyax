import { useEffect, useLayoutEffect, useMemo, useRef, useState, memo, lazy, Suspense } from "react";
import { navAnim, NAV_ANIM_EVENT, NAV_STYLES, restFrame, UNDER_SHIFT, EDGE_PX, type NavAnim } from "@/lib/navAnim";
import { ESC_BACK } from "@/lib/escape";
import { startUserSocket, onUserMessage, userSocket, sendViewing } from "@/lib/userSocket";
import { setOtaRestoreState } from "@/lib/ota";
import { petsAvailable } from "@/lib/pets";
import { signedIn } from "@/lib/signedIn";
import { useStable } from "@/lib/useStable";
import { startCall as startCallGlobal } from "@/lib/calls";
import { dismissChatNotifications, sweepReadNotifications } from "@/lib/chatNotifications";
import { readCache, writeCache, clearSessionCache } from "@/lib/session-cache";
import BottomNav from "@/components/BottomNav";
import { applog } from "@/lib/applog";
import { t as tr } from "@/lib/i18n";
import { clearMessageCache } from "@/lib/messageCache";
import { getPushSecret } from "@/lib/pushSecret";
import { useIsMobile } from "@/hooks/use-mobile";
import { useNavigate, useLocation } from "react-router-dom";
import ChatSidebar from "@/components/chat/ChatSidebar";
import type { LatestMessage } from "@/components/chat/ChatWindow";
import UpdateBanner from "@/components/UpdateBanner";
import TermsGate from "@/components/TermsGate";
import { syncThemeFromProfile } from "@/lib/theme";
import { api, mediaUrl, type WallState } from "@/api/client";
import { syncNotificationSounds } from "@/lib/notificationSounds";
import { requestMediaPermissionsOnce } from "@/lib/permissions";
import { playSfx } from "@/lib/sfx";
import { rovOn, rovOff, onRovState } from "@/lib/rov";
import { ensureNotifyPermission, showDesktopNotification } from "@/lib/desktopNotify";
import { isMutedNow, CHAT_MUTED_EVENT, type ChatMutedDetail } from "@/lib/chatMute";
import { toast } from "sonner";
import { FirebaseMessaging } from '@capacitor-firebase/messaging';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import logo from "@/assets/logo.png";

interface ChatType {
  id: string;
  name?: string;
  is_group?: boolean;
  // Даты чата из API бывают не у всех видов (Стена, «Избранное») — необязательные.
  created_at?: string;
  updated_at?: string;
  participants?: ProfileType[];
  /** Закрепление (личное) и время последнего сообщения — порядок списка. */
  pinned_at?: string | null;
  muted?: boolean;
  muted_until?: string | null;
  last_message_at?: string | null;
  last_message?: { text: string; sender_id: string; read?: boolean } | null;
  unread_count?: number;
  /** Непрочитанное упоминание или ответ на моё — «@» в списке. */
  unread_mention?: boolean;
}

const ts = (s?: string | null) => (s ? Date.parse(s) || 0 : 0);

interface ProfileType {
  id: string;
  username: string;
  avatar_url?: string;
  status?: string;
  /** «В сети» — живой статус, обновляется по сокету (событие presence). */
  is_online?: boolean;
  /** Аура — свечение вокруг аватара в сети (components/Aura.tsx). */
  aura_color?: string | null;
  aura_text?: string | null;
  /** null — правила ещё не приняты (см. TermsGate). */
  terms_accepted_at?: string | null;
}

/** savedMode — вкладка «Избранное»: вместо списка сразу открыт личный чат
 *  без собеседника (сервер создаёт его при первом обращении). */
/** Пушей через Google на этом телефоне нет (Huawei без сервисов Google) —
 *  не пробуем заново при каждом открытии экрана чатов до перезапуска. */
let pushUnavailable = false;

// Список и Стена под memo здесь, у места использования: их файлы правит
// другая работа, а перерисовка при каждой смене выбранного чата не нужна.
const MemoSidebar = memo(ChatSidebar);
// Окно переписки и лента каналов — не в стартовом наборе: первый экран на
// телефоне — список, их чанки подгружаются сразу после его отрисовки
// (prefetchChatChunks) и к первому тапу уже на месте (PERF_PLAN.md, п. 1).
const ChatWindow = lazy(() => import("@/components/chat/ChatWindow"));
const ChannelView = lazy(() => import("@/components/chat/ChannelView"));
const MemoChannelView = memo(ChannelView);
const prefetchChatChunks = () => { void import("@/components/chat/ChatWindow"); void import("@/components/chat/ChannelView"); };

const Chat = ({ savedMode = false, wallMode = false }: { savedMode?: boolean; wallMode?: boolean } = {}) => {
  const isMobile = useIsMobile();
  const [user, setUser] = useState<ProfileType | null>(() => readCache<ProfileType>("user"));
  useEffect(() => { prefetchChatChunks(); }, []);
  // Разделы скрыли/вернули (lib/sections) — держим свою копию профиля в
  // актуальном виде, иначе она записала бы в кеш старое значение.
  useEffect(() => {
    const on = (e: Event) => {
      const patch = (e as CustomEvent<Partial<ProfileType>>).detail;
      if (patch) setUser((u) => (u ? { ...u, ...patch } : u));
    };
    window.addEventListener("hyax:profile-patch", on);
    return () => window.removeEventListener("hyax:profile-patch", on);
  }, []);
  const [chats, setChats] = useState<ChatType[]>(() => readCache<ChatType[]>("chats") || []);
  // Уведомления чата поменяли (меню списка, профиль собеседника) — баннеры и
  // звук на компьютере слушаются сразу, не дожидаясь обновления списка.
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<ChatMutedDetail>).detail;
      setChats((prev) => prev.map((c) => (c.id === d.chatId ? { ...c, muted: d.muted, muted_until: d.muted_until } : c)));
    };
    window.addEventListener(CHAT_MUTED_EVENT, on);
    return () => window.removeEventListener(CHAT_MUTED_EVENT, on);
  }, []);
  // Вкладки «Избранное» и «Стена» (на широком окне) открываются сразу с нужным
  // чатом из кеша: раньше его подставлял эффект после первой отрисовки, и
  // каждый переход на вкладку мелькал «Загрузка…» / «Выберите чат»
  // (баг-репорт 08f7f108). Сервер потом только подтверждает id.
  const initialOpen = (): { id: string; kind: string; title?: string } | null => {
    if (savedMode && !isMobile) { const c = readCache<ChatType>("saved"); return c?.id ? { id: c.id, kind: "saved" } : null; }
    if (wallMode && !isMobile) { const w = readCache<WallState>("wall"); return w?.id ? { id: w.id, kind: "wall", title: tr("Стена") } : null; }
    return null;
  };
  const [selectedChatId, setSelectedChatId] = useState<string | null>(() => initialOpen()?.id ?? null);
  // Имя собеседника для шапки: приходит из сайдбара, он единственный, кто его
  // вычисляет — участники грузятся отдельно от списка чатов.
  const [selectedChatTitle, setSelectedChatTitle] = useState<string>(() => initialOpen()?.title ?? tr("Чат"));
  // Подсказка типа выбранного чата: канал из поиска может отсутствовать в
  // списке chats (пока не подписан), поэтому храним kind отдельно.
  const [selectedKind, setSelectedKind] = useState<string | undefined>(() => initialOpen()?.kind);
  // Стена: строка наверху списка, пока она включена (chat/wall.py).
  const [wall, setWall] = useState<WallState | null>(() => readCache<WallState>("wall"));
  const refreshWall = () => api.getWall().then((w) => {
    setWall(w); writeCache("wall", w);
    // Бейдж на вкладке живёт в BottomNav — ему сообщаем событием.
    window.dispatchEvent(new CustomEvent("hyax:wall", { detail: w }));
  }).catch(() => {});
  // Список чатов «приезжает» слева только как возврат из переписки: при
  // запуске приложения он просто на месте.
  const hadChatOpenRef = useRef(false);
  useEffect(() => { if (selectedChatId) hadChatOpenRef.current = true; }, [selectedChatId]);

  // Телефон: переход «список ↔ переписка» на выбор (lib/navAnim). «Обычные» —
  // CSS (screen-push/pop) у слоёв; остальные ведём здесь Web Animations на
  // самих слоях, «Сдвиг» — ещё и свайп назад за пальцем. Список прячется
  // (invisible), только когда переписка доехала, а уходящая переписка видна,
  // пока уезжает, — состоянием React, а не видимостью в кадрах анимации.
  const [navMode, setNavMode] = useState<NavAnim>(navAnim);
  useEffect(() => {
    const on = () => setNavMode(navAnim());
    window.addEventListener(NAV_ANIM_EVENT, on);
    return () => window.removeEventListener(NAV_ANIM_EVENT, on);
  }, []);
  const navStyle = isMobile ? NAV_STYLES[navMode] : undefined;
  const navStyleRef = useRef(navStyle);
  navStyleRef.current = navStyle;
  const layerNav = !!navStyle;
  const listLayerRef = useRef<HTMLDivElement>(null);
  const dimRef = useRef<HTMLDivElement>(null);
  const chatLayersRef = useRef(new Map<string, HTMLDivElement>());
  const [listCovered, setListCovered] = useState(() => !!selectedChatId);
  const [leavingId, setLeavingId] = useState<string | null>(null);
  const navPrevRef = useRef<string | null>(selectedChatId);
  const gestureClosedRef = useRef(false);
  const navAnimsRef = useRef<Animation[]>([]);
  const layerOf = (id: string | null) => (id ? chatLayersRef.current.get(id) ?? null : null);
  // Список под перепиской при свайпе «Сдвига» — за пальцем.
  const underX = (dx = 0) => `translateX(calc(${-UNDER_SHIFT * 100}% + ${dx * UNDER_SHIFT}px))`;
  const runNav = (el: Element | null | undefined, frames: Keyframe[], ms = navStyleRef.current?.ms ?? 0, ease = navStyleRef.current?.ease) => {
    if (!el?.animate || !navStyleRef.current) return null;
    const a = el.animate(frames, { duration: ms, easing: ease, fill: "both" });
    navAnimsRef.current.push(a);
    return a;
  };
  /** Снять анимации прошлого перехода. После кадра: слой, что уезжал, к
   *  этому времени уже спрятан, — иначе мелькнул бы на месте. */
  const dropNavAnims = (later = false) => {
    const list = navAnimsRef.current;
    navAnimsRef.current = [];
    const drop = () => list.forEach((a) => a.cancel());
    if (later) requestAnimationFrame(() => requestAnimationFrame(drop)); else drop();
  };
  // Открыли: переписка въезжает, список уходит под неё; спрятать по приезде.
  // Слоя новой переписки может ещё не быть (пул пополняется следующим
  // рендером) — тогда переход стартует, когда слой появится (ref ниже).
  const pendingOpenRef = useRef<string | null>(null);
  const startOpen = (el: HTMLElement) => {
    const st = navStyleRef.current;
    if (!st) return;
    const a = runNav(el, [st.chat, restFrame(st.chat)]);
    if (st.list) runNav(listLayerRef.current, [restFrame(st.list), st.list]);
    if (st.dim) runNav(dimRef.current, [{ opacity: 0 }, { opacity: st.dim }]);
    const done = () => { setListCovered(true); dropNavAnims(); };
    if (a) a.onfinish = done; else done();
    // Страховка: переход прервали (свайп, новый переход) — onfinish не придёт,
    // а список под перепиской должен спрятаться.
    window.setTimeout(() => { if (selectedChatIdRef.current && !dragRef.current) setListCovered(true); }, st.ms + 200);
  };
  const layerRef = (id: string) => (el: HTMLDivElement | null) => {
    if (!el) { chatLayersRef.current.delete(id); return; }
    chatLayersRef.current.set(id, el);
    if (pendingOpenRef.current === id) { pendingOpenRef.current = null; startOpen(el); }
  };
  useLayoutEffect(() => {
    const prev = navPrevRef.current, cur = selectedChatId;
    navPrevRef.current = cur;
    const st = navStyleRef.current;
    if (!st || prev === cur) return;
    pendingOpenRef.current = null;
    if (cur && !prev) {
      dropNavAnims();
      setLeavingId(null);
      setListCovered(false);
      const el = layerOf(cur);
      if (el) startOpen(el); else pendingOpenRef.current = cur;
      return;
    }
    if (!cur && prev) {
      // Свайп уже довёл переписку до края — осталось убрать его анимации.
      if (gestureClosedRef.current) { gestureClosedRef.current = false; setListCovered(false); dropNavAnims(true); return; }
      dropNavAnims();
      setListCovered(false);
      setLeavingId(prev);
      const ms = st.close?.ms ?? st.ms, ease = st.close?.ease ?? st.ease;
      const a = runNav(layerOf(prev), [restFrame(st.chat), st.chat], ms, ease);
      if (st.list) runNav(listLayerRef.current, [st.list, restFrame(st.list)], ms, ease);
      if (st.dim) runNav(dimRef.current, [{ opacity: st.dim }, { opacity: 0 }], ms, ease);
      const done = () => { setLeavingId((x) => (x === prev ? null : x)); dropNavAnims(true); };
      if (a) a.onfinish = done; else done();
      return;
    }
    // Одна переписка сменилась другой (из уведомления) — без анимации.
    dropNavAnims();
    setListCovered(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChatId, layerNav]);
  // «Сдвиг»: свайп от левого края — переписка едет за пальцем, список выходит из-под неё.
  const dragRef = useRef<{ x0: number; y0: number; on: boolean; w: number; x: number; t: number; v: number } | null>(null);
  const placeDrag = (dx: number, w: number) => {
    const el = layerOf(selectedChatId), list = listLayerRef.current, dim = dimRef.current;
    if (el) el.style.transform = `translateX(${dx}px)`;
    if (list) list.style.transform = underX(dx);
    if (dim) dim.style.opacity = String((navStyleRef.current?.dim ?? 0) * (1 - dx / w));
  };
  const onEdgeStart = (e: React.TouchEvent) => {
    if (!navStyle?.swipe || !selectedChatId || e.touches.length !== 1) return;
    const t = e.touches[0];
    if (t.clientX > EDGE_PX) return;
    dragRef.current = { x0: t.clientX, y0: t.clientY, on: false, w: e.currentTarget.clientWidth || window.innerWidth, x: 0, t: performance.now(), v: 0 };
  };
  const onEdgeMove = (e: React.TouchEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const t = e.touches[0];
    const dx = Math.max(0, t.clientX - d.x0), dy = t.clientY - d.y0;
    if (!d.on) {
      if (Math.abs(dy) > 12 && Math.abs(dy) > dx) { dragRef.current = null; return; }
      if (dx < 10 || dx < Math.abs(dy) * 1.3) return;
      d.on = true;
      dropNavAnims();
      setListCovered(false);
    }
    const now = performance.now();
    d.v = (dx - d.x) / Math.max(1, now - d.t);
    d.x = dx; d.t = now;
    placeDrag(dx, d.w);
  };
  const onEdgeEnd = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d?.on) return;
    const id = selectedChatId;
    const el = layerOf(id), list = listLayerRef.current, dim = dimRef.current;
    // Дотянул дальше трети или смахнул быстро — назад; иначе на место.
    const close = d.x > d.w * 0.35 || d.v > 0.5;
    const left = close ? (d.w - d.x) / d.w : d.x / d.w;
    const dimMax = navStyleRef.current?.dim ?? 0;
    const ms = Math.max(160, (navStyleRef.current?.ms ?? 0) * left);
    const fromChat = `translateX(${d.x}px)`, fromList = underX(d.x), fromDim = dimMax * (1 - d.x / d.w);
    if (el) el.style.transform = "";
    if (list) list.style.transform = "";
    if (dim) dim.style.opacity = "0";
    const a = runNav(el, [{ transform: fromChat }, { transform: close ? "translateX(100%)" : "translateX(0)" }], ms);
    runNav(list, [{ transform: fromList }, { transform: close ? "translateX(0)" : underX() }], ms);
    runNav(dim, [{ opacity: fromDim }, { opacity: close ? 0 : dimMax }], ms);
    const done = () => {
      if (close) { gestureClosedRef.current = true; closeChat(); }
      else { setListCovered(true); dropNavAnims(); }
    };
    if (a) a.onfinish = done; else done();
  };

  // Чат «Избранное» — узнаём у сервера один раз; в списке chats его нет.
  // Из кеша он берётся сразу, поэтому вкладка открывается с сообщениями, а не
  // с «Загрузка…»; ответ сервера потом только подтверждает id.
  const [savedChat, setSavedChat] = useState<ChatType | null>(() => readCache<ChatType>("saved"));
  useEffect(() => {
    let alive = true;
    const cached = readCache<ChatType>("saved");
    // На телефоне Избранное — отдельный слой со своим chatId (savedChat), выбор
    // чата ему не нужен; на широком окне оно открывается в правой колонке.
    const pick = savedMode && !isMobile;
    if (pick && cached?.id) { setSelectedChatId(cached.id); setSelectedKind("saved"); }
    api.getSavedChat()
      .then((c) => {
        if (!alive) return;
        setSavedChat(c as any);
        writeCache("saved", c);
        if (pick) { setSelectedChatId(c.id); setSelectedKind("saved"); }
      })
      .catch(() => { if (savedMode && !cached?.id) toast.error(tr("Не удалось открыть Избранное")); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedMode, isMobile]);

  // Вкладки списка, Избранного и Стены — слои одного экрана (см. App.tsx
  // CHAT_TABS): переключение их не пересоздаёт. Какие уже открывали — те и
  // смонтированы; уход со вкладки чатов закрывает открытую переписку, как и
  // раньше (скрытый чат не должен отмечать входящие прочитанными).
  const closeChat = useStable(() => setSelectedChatId(null));
  const selectChat = useStable((id: string, title?: string, kind?: string) => {
    setSelectedChatId(id);
    if (title) setSelectedChatTitle(title);
    setSelectedKind(kind);
  });
  const refreshWallStable = useStable(() => { void refreshWall(); });
  const openChannelFromWallNav = useStable((id: string, title?: string) => navigate("/chat", { state: { chatId: id, kind: "channel", title } }));
  const openProfile = useStable(() => navigate("/profile"));
  const tab: "wall" | "saved" | "chat" = wallMode ? "wall" : savedMode ? "saved" : "chat";
  // Пул недавних переписок (телефон): последние POOL_SIZE личных и групповых
  // чатов остаются смонтированными скрытыми слоями — повторное открытие не
  // строит окно заново (PERF_PLAN.md, п. 4). Каналы и Стена — не в пуле.
  const POOL_SIZE = 3;
  const [recentChats, setRecentChats] = useState<string[]>([]);
  useEffect(() => {
    if (!isMobile || !selectedChatId) return;
    const kind = selectedKind || (chatsRef.current.find((c) => c.id === selectedChatId) as { kind?: string } | undefined)?.kind;
    if (kind === "channel" || kind === "wall" || kind === "saved") return;
    setRecentChats((prev) => [...prev.filter((id) => id !== selectedChatId), selectedChatId].slice(-POOL_SIZE));
  }, [selectedChatId, selectedKind, isMobile]);
  // Чат удалили или его нет в списке — из пула долой.
  useEffect(() => {
    setRecentChats((prev) => prev.filter((id) => chats.some((c) => c.id === id) || id === selectedChatId));
  }, [chats, selectedChatId]);
  const [visitedTabs, setVisitedTabs] = useState<Set<string>>(() => new Set([tab]));
  useEffect(() => {
    setVisitedTabs((v) => (v.has(tab) ? v : new Set([...v, tab])));
    if (tab !== "chat" && isMobile && selectedChatIdRef.current) { setSelectedChatId(null); setSelectedKind(undefined); }
    // Широкое окно: вкладка «Чаты» после Стены или Избранного — «Выберите чат», как раньше.
    if (tab === "chat" && !isMobile && (selectedKindRef.current === "wall" || selectedKindRef.current === "saved")) { setSelectedChatId(null); setSelectedKind(undefined); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Звонки ведёт components/call/CallHost над всеми экранами (lib/calls),
  // события сокета — общий lib/userSocket: экран чатов на них только подписан.
  // Чаты нужны обработчикам звонка, а те живут вне рендера.
  const chatsRef = useRef<ChatType[]>([]);
  // Активный чат для обработчика сокета: он живёт в эффекте с deps
  // [user?.id] и иначе видел бы устаревший selectedChatId.
  const selectedChatIdRef = useRef<string | null>(null);
  selectedChatIdRef.current = selectedChatId;
  const selectedKindRef = useRef<string | undefined>(undefined);
  selectedKindRef.current = selectedKind;
  // Растёт на каждое входящее по сокету в открытом чате — ChatWindow по нему
  // перечитывает ленту сразу, а не через опрос.

  // Последнее событие о реакциях — ChatWindow применяет его к своей ленте.
  chatsRef.current = chats;
  // Непрочитанные в момент открытия: эффект ниже обнулит бейдж, а лента должна
  // встать к первому непрочитанному (ChatWindow.unreadAtOpen).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const unreadAtOpen = useMemo(() => chatsRef.current.find((c) => c.id === selectedChatId)?.unread_count || 0, [selectedChatId]);
  const navigate = useNavigate();

  // Р.Ё.В: пока держат площадку, повторяем «держу» — приёмник глушит
  // вибрацию по тишине, если сигналы перестали приходить (сеть, сворачивание).
  // Частота своя, с запасом под серверный потолок в 10 событий в секунду.
  // Сообщаем серверу, какой чат открыт: по нему он не будет слать пуш —
  // сообщение и так на экране. Повторяем, пока чат открыт: отметка на
  // сервере живёт ограниченное время и протухает, если связь оборвалась.
  const viewingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    // ttl 15 и подтверждение каждые 10 с: свернули приложение — пуши пойдут
    // через ~15 с, даже если «больше не смотрю» потерялось (chat/presence.py).
    const tell = (chat: string | null) => sendViewing(chat);
    tell(selectedChatId);
    if (viewingTimerRef.current) clearInterval(viewingTimerRef.current);
    if (selectedChatId) {
      viewingTimerRef.current = setInterval(() => {
        if (document.visibilityState === "visible") tell(selectedChatIdRef.current);
      }, 10000);
    }
    return () => {
      if (viewingTimerRef.current) { clearInterval(viewingTimerRef.current); viewingTimerRef.current = null; }
    };
  }, [selectedChatId]);

  // Свернули приложение или вкладку — чат больше не «открыт», пуши снова нужны.
  useEffect(() => {
    const onVisible = () => {
      const visible = document.visibilityState === "visible";
      sendViewing(visible ? selectedChatIdRef.current : null);
      // «В сети» по сворачиванию сообщает сам сокет (lib/userSocket) — на любом экране.
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const rovTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sendRov = useStable((on: boolean) => {
    const chatId = selectedChatIdRef.current;
    if (!chatId) return;
    if (rovTimerRef.current) { clearInterval(rovTimerRef.current); rovTimerRef.current = null; }
    userSocket()?.send({ type: "rov", chat: chatId, on });
    if (on) {
      // Повторяем «держу», пока палец на площадке: приёмник глушит вибрацию
      // по тишине, если сигналы перестали приходить.
      rovTimerRef.current = setInterval(() => {
        userSocket()?.send({ type: "rov", chat: chatId, on: true });
      }, 400);
    }
  });
  useEffect(() => () => { if (rovTimerRef.current) clearInterval(rovTimerRef.current); rovOff(); }, []);

  // Показываем, кто нас ревёт: вибрация вибрацией, но на десктопе её нет.
  useEffect(() => {
    onRovState((active, from) => {
      if (active) toast(from ? tr("{name} ревёт", { name: from }) : tr("Собеседник ревёт"), { id: "rov", duration: 60000 });
      else toast.dismiss("rov");
    });
    return () => onRovState(null);
  }, []);

  // Со страницы профиля по ссылке (/u/<ник>) приходим с уже созданным чатом —
  // открываем его сразу, не заставляя искать в списке. Состояние навигации
  // читаем один раз: при следующих перерисовках оно не должно перебивать выбор.
  const location = useLocation();
  const openChatFromStateRef = useRef<{ chatId: string; kind?: string; title?: string } | null>(
    (location.state as any)?.chatId ? { chatId: (location.state as any).chatId, kind: (location.state as any).kind, title: (location.state as any).title } : null);

  // А это повторные переходы в /chat с chatId, когда мы уже здесь: «Написать»
  // на карточке профиля в сообщении. Экран не пересоздаётся, и начальное
  // чтение выше их не видит — ловим по смене location.key. Чат мог быть только
  // что создан, поэтому список подтягиваем заново.
  const firstLocationKeyRef = useRef(location.key);
  useEffect(() => {
    if (location.key === firstLocationKeyRef.current) return;
    const st = location.state as { chatId?: string; kind?: string; title?: string } | null;
    if (!st?.chatId) return;
    setSelectedChatId(st.chatId);
    setSelectedKind(st.kind);
    if (st.title) setSelectedChatTitle(st.title);
    void refreshChats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  // При открытии чата помечаем его прочитанным на сервере и гасим бейдж.
  useEffect(() => {
    if (!selectedChatId) return;
    api.markChatAsRead(selectedChatId).catch(() => {});
    // Его уведомления на экране телефона больше не нужны.
    dismissChatNotifications([selectedChatId]);
    setChats((prev) =>
      prev.map((c) => (c.id === selectedChatId ? { ...c, unread_count: 0, unread_mention: false } : c))
    );
    // И при уходе из чата: всё, что пришло, пока он был открыт, тоже прочитано.
    // Несколько секунд считаем его прочитанным и в списке (см. mergeUnread),
    // пока сервер не применил отметку, — иначе бейдж мигал бы. Но только до
    // последнего сообщения на момент выхода (lastAt): написали уже после —
    // это новое непрочитанное.
    return () => {
      const row = chatsRef.current.find((c) => c.id === selectedChatId);
      const lastAt = Math.max(ts(row?.last_message_at), ts(latestRef.current[selectedChatId]?.created_at));
      leftChatRef.current = { id: selectedChatId, until: Date.now() + 8000, lastAt };
      api.markChatAsRead(selectedChatId).catch(() => {});
    };
  }, [selectedChatId]);

  // 🔔 Проверка аутентификации и получение профиля + инициализация уведомлений
  useEffect(() => {
    const initializeApp = async () => {
      try {
        const profile = await api.getProfile();
        setUser(profile);
        // Тема хранится в профиле: на новом устройстве включаем ту же (lib/theme).
        void syncThemeFromProfile((profile as any).active_theme);
        writeCache("user", profile);
        const userChats = await mergeUnread(await api.getChats());
        setChats(userChats);
        writeCache("chats", userChats);
        if (openChatFromStateRef.current) {
          const o = openChatFromStateRef.current;
          setSelectedChatId(o.chatId);
          if (o.kind) setSelectedKind(o.kind);
          if (o.title) setSelectedChatTitle(o.title);
          openChatFromStateRef.current = null;
        }
        
        // 🔔 Инициализация push-уведомлений после успешной аутентификации.
        // Сбой регистрации пушей (нет APNs в симуляторе, недоступен Firebase)
        // — не повод разлогинивать: раньше любая ошибка здесь уводила на
        // экран входа при живом токене.
        try {
          if (Capacitor.isNativePlatform()) {
            await initPushNotifications(profile.id);
            // Аудио-стикеры: докачиваем caf-файлы каталога в Library/Sounds,
            // чтобы пуш мог сослаться на них по имени. Фоном, без ожидания.
            syncNotificationSounds();
            // Камера и микрофон — спрашиваем один раз при первом запуске.
            void requestMediaPermissionsOnce();
          } else {
            // Веб/десктоп: разрешение на системные баннеры (self-guard внутри).
            ensureNotifyPermission();
          }
        } catch (e) {
          applog.warn(`push init failed: ${(e as Error)?.message || e}`);
        }
      } catch (error) {
        // Сеть подвела — остаёмся на кэше; без токена — на вход.
        if (!signedIn()) navigate("/auth");
        else applog.warn(`init: ${(error as Error)?.message || error}`);
      }
    };
    
    initializeApp();
  // Один раз на экран: navigate меняется при каждом переходе, и эффект шёл заново.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 🔔 Функция инициализации push-уведомлений
  // Firebase, а не @capacitor/push-notifications: тот на iOS отдаёт сырой
  // APNs-токен, который FCM отправить не может. Firebase SDK сам меняет его
  // на FCM-овский — бэкенд работает с iOS и будущим Android одинаково.
  const initPushNotifications = async (_userId: string) => {
    if (pushUnavailable) return;
    try {
      let permission = await FirebaseMessaging.checkPermissions();
      if (permission.receive === 'prompt' || permission.receive === 'prompt-with-rationale') {
        permission = await FirebaseMessaging.requestPermissions();
      }
      if (permission.receive !== 'granted') return;

      // Токен ротируется — слушаем и перерегистрируем.
      await FirebaseMessaging.addListener('tokenReceived', (e) => {
        if (e?.token) sendPushTokenToServer(e.token);
      });

      // Тап по пушу ведёт в чат — слушатель живёт в App.tsx (PushOpen): этот
      // экран на «Музыке» или в профиле размонтирован, и переключение чата
      // здесь уходило в никуда.

      // Тихий пуш «отбой»: звонящий отменил вызов, пока наш WebSocket молчал.
      await FirebaseMessaging.addListener('notificationReceived', (e) => {
        const d = ((e as any)?.notification?.data as Record<string, string>) || {};
        if (d.type === 'call_ended' && d.call_id) {
          // Звонки ведёт CallHost — передаём ему.
          window.dispatchEvent(new CustomEvent("hyax:call-ended-push", { detail: { callId: String(d.call_id) } }));
        }
      });

      const { token } = await FirebaseMessaging.getToken();
      await sendPushTokenToServer(token);
    } catch (error) {
      if (/MISSING_INSTANCEID_SERVICE|SERVICE_NOT_AVAILABLE|Google Play services/i.test(String((error as Error)?.message || error))) {
        pushUnavailable = true;
        console.warn('Push: на телефоне нет сервисов Google — пуши через FCM недоступны');
        return;
      }
      console.error('Error initializing push notifications:', error);
    }
  };

  // 🔔 Функция отправки push-токена на сервер
  const sendPushTokenToServer = async (token: string) => {
    try {
      await api.registerPushToken(token, Capacitor.getPlatform(), (await getPushSecret()) || undefined);
    } catch (error) {
      console.error('Error sending push token to server:', error);
    }
  };

  // 🔔 Автообновление списка чатов
  useEffect(() => {
    if (!user) return;

    // Сразу загружаем чаты при загрузке компонента
    refreshChats();

    // Список чатов обновляют события личного сокета (new_message, read,
    // chat_changed, …). Опрос — страховка: раз в минуту при живом сокете,
    // раз в 10 с без него. Раньше опрос шёл каждые 5 с с каждого устройства,
    // и один список чатов давал около 5 ГБ трафика в сутки.
    let pollTimer = 0;
    const schedule = () => {
      window.clearTimeout(pollTimer);
      pollTimer = window.setTimeout(() => { refreshChats(); schedule(); }, userSocket()?.isConnected() ? 60000 : 10000);
    };
    schedule();
    // Сокет (пере)подключился — пропущенные события наверстать сразу. Кроме
    // первого подключения при старте: список только что загружен.
    const onSocketOpen = () => { if (Date.now() - lastRefreshRef.current > 5000) refreshChats(); schedule(); };
    window.addEventListener("hyax:socket-open", onSocketOpen);
    // Стена: счётчик новых постов — реже, он не срочный.
    void refreshWall();
    const wallTimer = setInterval(() => { void refreshWall(); }, 60000);

    return () => {
      window.clearTimeout(pollTimer);
      window.removeEventListener("hyax:socket-open", onSocketOpen);
      clearInterval(wallTimer);
    };
  }, [user]);

  // 🔔 Обработчик состояния приложения (foreground/background)
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    // Слушаем переход приложения в foreground
    const appStateListener = App.addListener('appStateChange', ({ isActive }) => {
      console.log('App state changed, isActive:', isActive);
      
      if (isActive) {
        // При возвращении в приложение обновляем данные
        refreshChats();
      }
    });

    return () => {
      // addListener отдаёт Promise: синхронный remove() устарел (предупреждение в логе iOS).
      void appStateListener.then((h) => h.remove());
    };
  }, []);

  // Системная кнопка «Назад» (Android) — общая с Esc, components/EscapeKey:
  // открытый чат закрывается по ESC_BACK ниже, со списка приложение сворачивается.

  // Esc (components/EscapeKey): открытый чат закрывается — на широком окне
  // остаётся «Выберите чат», на узком — список. Вкладки «Стена» и
  // «Избранное» — отдельные экраны, там Esc — обычный шаг назад.
  useEffect(() => {
    if (wallMode || savedMode) return;
    const onEsc = (e: Event) => {
      if (!selectedChatIdRef.current) return;
      e.preventDefault();
      setSelectedChatId(null);
      if (selectedKind === "wall") void refreshWall();
    };
    window.addEventListener(ESC_BACK, onEsc);
    return () => window.removeEventListener(ESC_BACK, onEsc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallMode, savedMode, selectedKind]);

  // События пользовательского сокета (lib/userSocket). Сам сокет живёт на всё
  // приложение: уход с экрана его больше не закрывает — звонок, который идёт
  // по нему (components/call/CallHost), не обрывается.
  useEffect(() => {
    if (!user?.id) return;
    startUserSocket(user.id);
    const off = onUserMessage((msg: any) => {
      if (msg?.data?.type === "reaction") {
        // Реакции приходят событием: обычная синхронизация их не приносит —
        // само сообщение при этом не меняется.
        window.dispatchEvent(new CustomEvent("hyax:reaction", { detail: { ...msg.data, at: Date.now() } }));
      } else if (msg?.data?.type === "chat_request") {
        // Запрос на переписку пришёл или принят — список и открытый чат перечитываются.
        refreshChats();
        window.dispatchEvent(new CustomEvent("hyax:chatreq", { detail: msg.data }));
      } else if (msg?.data?.type === "chat_removed") {
        // Чат удалён (собеседником или отклонённый запрос) — убрать из списка и закрыть.
        const removedId = String(msg.data.chat_id || "");
        setChats((prev) => prev.filter((c) => String(c.id) !== removedId));
        if (selectedChatIdRef.current === removedId) {
          setSelectedChatId(null);
          if (String(msg.data.by || "") !== String(user?.id || "")) {
            toast(msg.data.reason === "declined" ? tr("Собеседник отклонил запрос на переписку")
              : msg.data.reason === "removed" ? tr("Владелец удалил вас из группы")
              : tr("Собеседник удалил этот чат"));
          }
        }
        refreshChats();
      } else if (msg?.data?.type === "group_updated") {
        // Состав или владелец группы изменились — список и открытые настройки перечитываются.
        refreshChats();
        window.dispatchEvent(new CustomEvent("hyax:group", { detail: msg.data }));
      } else if (msg?.data?.type === "secret_chat") {
        // Секретный чат создан, принят или отклонён — список и открытая переписка перечитываются.
        refreshChats();
        window.dispatchEvent(new CustomEvent("hyax:secret", { detail: msg.data }));
      } else if (msg?.data?.type === "wallpaper") {
        // Собеседник сменил обои чата — открытая переписка перечитает чат.
        window.dispatchEvent(new CustomEvent("hyax:wallpaper", { detail: msg.data }));
      } else if (msg?.data?.type === "inline_results") {
        // Ответ inline-бота на «@бот запрос» — ChatWindow слушает и рисует список.
        window.dispatchEvent(new CustomEvent("hyax:inline", { detail: msg.data }));
      } else if (msg?.data?.type === "read") {
        // Собеседник прочитал: вторая галочка у последнего сообщения в списке
        // и у своих сообщений в открытой переписке (ChatWindow слушает событие).
        const chatId = String(msg.data.chat_id);
        setChats((prev) => prev.map((c: any) =>
          c.id === chatId && c.last_message && !c.last_message.read && String(msg.data.reader_id) !== c.last_message.sender_id
            ? { ...c, last_message: { ...c.last_message, read: true } }
            : c));
        window.dispatchEvent(new CustomEvent("hyax:read", { detail: msg.data }));
      } else if (msg?.data?.type === "presence") {
        // Собеседник зашёл или вышел: правим его в участниках чатов — оттуда
        // статус читают и список, и шапка переписки.
        const pid = String(msg.data.profile_id);
        const online = !!msg.data.online;
        setChats((prev) => prev.map((c) =>
          c.participants?.some((p) => p.id === pid && p.is_online !== online)
            ? { ...c, participants: c.participants.map((p) => (p.id === pid ? { ...p, is_online: online } : p)) }
            : c));
      } else if (msg?.data?.type === "wall_ban") {
        // Админ запретил (или снова разрешил) писать на Стену — экран
        // Стены переключается сразу, без перезахода.
        const ban = msg.data.ban || null;
        setWall((w) => { const n = w ? { ...w, ban } : w; if (n) writeCache("wall", n); return n; });
        window.dispatchEvent(new CustomEvent("hyax:wall-ban", { detail: ban }));
        toast(ban ? tr("Вам запретили писать на Стену") : tr("Вам снова можно писать на Стену"), { id: "wall-ban" });
      } else if (msg?.data?.type === "vibe") {
        // Подняли вайб: тост с именем (или без — анонимно) и свежее число в кеше профиля.
        const who = msg.data.from?.username;
        toast.success(who ? tr("{name} поднял(а) ваш вайб", { name: who }) : tr("Кто-то поднял ваш вайб"), { description: tr("Вайбометр: {n}", { n: msg.data.vibe }), id: "vibe" });
        playSfx("sent");
        setUser((u) => { if (!u) return u; const n = { ...u, vibe: msg.data.vibe }; writeCache("user", n); return n; });
      } else if (msg?.data?.type === "pet") {
        // За моим питомцем поухаживал кто-то другой — короткая заметка (свой уход — без неё).
        const by = msg.data.by;
        const me = readCache<{ id?: string }>("user")?.id;
        const name = msg.data.pet?.name || tr("ваш питомец");
        if (msg.data.action === "home" && petsAvailable()) {
          // Моего питомца отправили домой из группы: её владелец или уменьшенный лимит.
          const chat = msg.data.chat?.name || tr("группы");
          toast(msg.data.reason === "admin" && by ? tr("{who} отправил(а) {name} домой из «{chat}»", { who: by.username, name, chat }) : tr(msg.data.pet?.sex === "f" ? "В «{chat}» стало меньше мест для питомцев — {name} вернулась домой" : "В «{chat}» стало меньше мест для питомцев — {name} вернулся домой", { chat, name }), { id: "pet" });
        } else if (by && by.id !== me && petsAvailable()) {
          toast(msg.data.action === "feed" ? tr("{who} покормил(а) питомца — {name}", { who: by.username, name }) : tr("{who} погладил(а) питомца — {name}", { who: by.username, name }), { id: "pet" });
        }
      } else if (msg?.data?.type === "rov") {
        // Сигнал живёт, только пока приложение открыто: в истории его нет.
        if (msg.data.on) rovOn(msg.data.from_username);
        else rovOff();
      } else if (msg?.data?.type === "chat_changed") {
        // Правка или удаление последнего сообщения — превью в списке.
        refreshChats();
      } else if (msg?.type === "new_message" || msg?.data?.type === "new_message") {
        refreshChats();
        // Системный баннер для веб/десктопа. На мобильных — нативный пуш.
        const m = msg?.data?.message ?? msg?.message;
        const chatId = msg?.data?.chat_id ?? m?.chat;
        const senderId = m?.sender?.id;
        // «Глюк-стикер» от собеседника: открытый чат разыграет эффект.
        if (m?.effect === "burst" && m?.sticker?.file_url && senderId && senderId !== user?.id) {
          window.dispatchEvent(new CustomEvent("hyax:burst", { detail: { chat_id: String(chatId), url: m.sticker.file_url, id: m.id } }));
        }
        const active = document.visibilityState === "visible" &&
          chatId && String(chatId) === selectedChatIdRef.current;
        // Пинг — всем смонтированным окнам (открытое, пул недавних, Избранное):
        // каждое синхронизируется, только если пинг про его чат (pingChatId).
        if (chatId) window.dispatchEvent(new CustomEvent("hyax:ping", { detail: { chat_id: String(chatId) } }));
        // Уведомления чата выключены у меня (lib/chatMute) — ни баннера, ни
        // звука; в открытом чате звук свой (ChatWindow), он остаётся.
        const mutedNow = isMutedNow(chatsRef.current.find((c) => String(c.id) === String(chatId)));
        if (m && senderId && senderId !== user.id && !active && !mutedNow) {
          const preview =
            (m.content || "").trim() ||
            (m.sticker ? tr("Стикер") :
             m.video_url ? tr("Видео-сообщение") :
             m.voice_url ? tr("Голосовое сообщение") :
             m.file_url ? tr("Файл") : tr("Новое сообщение"));
          // Из группы — заголовок с названием группы, в тексте автор: сразу
          // видно, откуда сообщение. Личное — просто имя собеседника.
          const chatRow = chatsRef.current.find((c) => String(c.id) === String(chatId)) as (ChatType & { is_group?: boolean; kind?: string; name?: string; notify_sound?: { url?: string } | null }) | undefined;
          const fromGroup = !!chatRow?.is_group && chatRow?.kind !== "channel";
          // Пост канала — от имени канала (как в пуше на телефоне): заголовок и
          // аватар канала, а не автора. Тип и название приходят в самом событии —
          // канала может ещё не быть в загруженном списке.
          const d = (msg?.data ?? msg) || {};
          const fromChannel = d.chat_kind === "channel" || chatRow?.kind === "channel";
          const channelName = d.chat_name || chatRow?.name || tr("Канал");
          const channelAvatar = d.chat_avatar || (chatRow as { avatar_url?: string | null } | undefined)?.avatar_url || "";
          // «Звук входящих» выключен: обычные сообщения — без звука, играет
          // только звук, приложенный к сообщению специально.
          const silent = !!readCache<{ notify_silent?: boolean }>("user")?.notify_silent;
          showDesktopNotification({
            silent,
            title: fromChannel ? channelName : fromGroup ? (chatRow?.name || tr("Группа")) : (m.sender?.username || tr("Новое сообщение")),
            body: (fromGroup && m.sender?.username ? `${m.sender.username}: ${preview}` : preview).slice(0, 150),
            tag: chatId ? String(chatId) : undefined,
            avatar: fromChannel ? (channelAvatar ? mediaUrl(channelAvatar) : undefined) : m.sender?.avatar_url ? mediaUrl(m.sender.avatar_url) : undefined,
            onClick: () => { if (chatId) setSelectedChatId(String(chatId)); },
          });
          // Звук — только там, где нет пушей (веб/десктоп): на телефоне об
          // этом же сообщении звенит пуш, дублировать его в приложении не надо.
          // Порядок: аудио-стикер сообщения → «мой звук» отправителя → receive.
          if (!Capacitor.isNativePlatform()) {
            try {
              const custom = m.sound?.url || (silent ? null : (chatsRef.current.find((c) => String(c.id) === String(chatId)) as { notify_sound?: { url?: string } | null } | undefined)?.notify_sound?.url || m.sender?.notify_sound?.url);
              if (custom || !silent) void playSfx(custom ? mediaUrl(custom) : "/sounds/receive.mp3", { volume: 0.6 });
            } catch { /* без звука не критично */ }
          }
        }
      }
    });
    return () => {
      off();
      // Экран чатов закрыт — никакой чат не «открыт», пуши снова нужны.
      sendViewing(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const selectedChat = chats.find((c) => c.id === selectedChatId) || (savedChat?.id === selectedChatId ? savedChat : undefined);
  const isChannelOpen = selectedKind === "channel" || (selectedChat as any)?.kind === "channel";
  const isWallOpen = selectedKind === "wall";
  const openChannelFromWall = useStable((id: string, title?: string) => {
    setSelectedChatId(id);
    setSelectedKind("channel");
    if (title) setSelectedChatTitle(title);
  });
  const isSavedOpen = !!selectedChatId && (selectedKind === "saved" || (selectedChat as any)?.kind === "saved");
  // «Избранное» живёт на своей вкладке — из общего списка его убираем.
  // «Долгий ящик» — своя строка наверху списка (ChatSidebar), в общем списке его нет.
  const listChats = useMemo(() => chats.filter((c) => (c as any).kind !== "saved" && (c as any).kind !== "ideabox"), [chats]);
  // Стена — своя вкладка (/wall) и строка над списком на десктопе; в самом списке её нет.
  const openWall = () => {
    if (isMobile) { navigate("/wall"); return; }
    if (!wall) { toast.error(tr("Стена ещё не загрузилась")); return; }
    setSelectedChatId(wall.id); setSelectedKind("wall"); setSelectedChatTitle(tr("Стена"));
  };
  // Широкое окно: вкладка «Стена» в левой панели (/wall) — Стена справа от списка.
  useEffect(() => {
    if (!wallMode || isMobile !== false || !wall) return;
    setSelectedChatId(wall.id); setSelectedKind("wall"); setSelectedChatTitle(tr("Стена"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallMode, isMobile, wall?.id]);
  const ideaboxChat = chats.find((c) => (c as any).kind === "ideabox") || null;
  const openIdeabox = async () => {
    try {
      const id = ideaboxChat?.id || (await api.getIdeabox()).id;
      if (!ideaboxChat) await refreshChats();
      setSelectedChatId(id);
      setSelectedKind("ideabox");
      setSelectedChatTitle(tr("Долгий ящик"));
    } catch (e) {
      toast.error((e as Error).message || tr("Не удалось открыть"));
    }
  };
  // В группе «собеседника» нет: find(!= me) вернул бы первого участника, и
  // шапка шла бы по ветке 1:1 (профиль) вместо настроек группы. Поэтому для
  // групп peer всегда null.
  const peer = selectedChat?.is_group || isSavedOpen
    ? null
    : selectedChat?.participants?.find((p) => p.id !== user?.id) || null;

  // Заголовок шапки берём из самого чата, а не из selectedChatTitle: при
  // открытии из пуша тайтл не передавался и висел от предыдущего диалога.
  const chatHeaderTitle = isSavedOpen
    ? tr("Избранное")
    : selectedChat
    ? selectedChat.is_group
      ? selectedChat.name || tr("Группа")
      : peer?.username || selectedChatTitle
    : selectedChatTitle;

  // Перезагрузка ради обновления по воздуху (lib/ota) возвращает в этот же чат.
  const restoreRef = useRef<unknown>(null);
  restoreRef.current = selectedChatId && !savedMode && !wallMode ? { chatId: selectedChatId, kind: selectedKind, title: chatHeaderTitle } : null;
  useEffect(() => {
    setOtaRestoreState(() => restoreRef.current);
    return () => setOtaRestoreState(null);
  }, []);

  // Позвонить из открытого чата: звонок ведёт CallHost (lib/calls), он и
  // переживает уход с экрана чатов.
  const startCall = useStable(async () => {
    if (!selectedChatId) return;
    await startCallGlobal({
      chatId: selectedChatId,
      isGroup: !!selectedChat?.is_group,
      chatName: selectedChat?.name,
      peer: peer ? { id: peer.id, name: peer.username, avatarUrl: peer.avatar_url } : undefined,
    });
  });

  // 🔔 Функция обновления списка чатов
  // getChats счётчик непрочитанного не отдаёт — берём его из отдельного
  // эндпоинта и подмешиваем. Открытый чат сразу считаем прочитанным.
  const mergeUnread = async (list: ChatType[]): Promise<ChatType[]> => {
    try {
      const u = await api.getUnreadCount();
      const openId = selectedChatIdRef.current;
      // Только что закрытый чат тоже прочитан: отметка «прочитано» уходит при
      // выходе, и ответ счётчика, собранный до неё, на миг вернул бы бейдж.
      // Кроме случая, когда после выхода туда написали: тогда непрочитанное
      // настоящее — с бейджем и уведомлением. Раньше 8 с после выхода такие
      // сообщения считались прочитанными, и sweepReadNotifications стирал их
      // уведомления с экрана сразу по приходе (баг-репорт 763bedfb).
      const left = leftChatRef.current;
      const leftId = left && Date.now() < left.until ? left.id : null;
      return list.map((c) => {
        const read = c.id === openId || (c.id === leftId && ts(c.last_message_at) <= left!.lastAt);
        return {
          ...c,
          unread_count: read ? 0 : (u.unread_by_chat?.[c.id] || 0),
          unread_mention: read ? false : !!u.mention_by_chat?.[c.id],
        };
      });
    } catch {
      return list;
    }
  };

  // Последнее сообщение, которое уже видела открытая переписка: ответ опроса
  // /chats/, отправленный раньше, не должен откатывать строку назад.
  const latestRef = useRef<Record<string, LatestMessage>>({});
  const leftChatRef = useRef<{ id: string; until: number; lastAt: number } | null>(null);

  const withLatest = (list: ChatType[]): ChatType[] => list.map((c) => {
    const l = latestRef.current[c.id];
    if (!l || ts(l.created_at) < ts(c.last_message_at)) return c;
    return {
      ...c,
      last_message: { text: l.text, sender_id: l.sender_id, read: l.read || !!c.last_message?.read },
      last_message_at: l.created_at,
    };
  });

  const sortChats = (list: ChatType[]) => [...list].sort((x, y) => {
    const px = ts(x.pinned_at), py = ts(y.pinned_at);
    if (px || py) return py - px;
    return ts(y.last_message_at || y.created_at) - ts(x.last_message_at || x.created_at);
  });

  const handleLatest = useStable((chatId: string, latest: LatestMessage) => {
    latestRef.current[chatId] = latest;
    setChats((prev) => {
      const next = sortChats(withLatest(prev).map((c) => (c.id === chatId ? { ...c, unread_count: 0, unread_mention: false } : c)));
      writeCache("chats", next);
      return next;
    });
  });

  // Залп событий (несколько сообщений подряд, read + new_message) — один
  // запрос: пока идёт загрузка, следующий вызов лишь просит повторить после.
  const refreshingRef = useRef<{ busy: boolean; again: boolean }>({ busy: false, again: false });
  const lastRefreshRef = useRef(0);
  const refreshChats = useStable(async () => {
    const st = refreshingRef.current;
    if (st.busy) { st.again = true; return; }
    st.busy = true;
    try { await refreshChatsNow(); lastRefreshRef.current = Date.now(); }
    finally { st.busy = false; if (st.again) { st.again = false; void refreshChats(); } }
  });
  const refreshChatsNow = async () => {
    if (!user) return;
    try {
      const userChats = withLatest(await mergeUnread(await api.getChats()));
      // Сравниваем с тем, что на экране сейчас (chatsRef), а не с chats из
      // замыкания: опрос живёт в эффекте с первого рендера, и там chats —
      // давний снимок. Сравнение было всегда «изменилось», и каждые 5 с
      // перерисовывалось всё, включая открытую переписку на сотни сообщений.
      if (JSON.stringify(userChats) !== JSON.stringify(chatsRef.current)) {
        setChats(userChats);
        writeCache("chats", userChats);
      }
      // Уведомления чатов, где всё прочитано (в том числе на другом
      // устройстве), — с экрана телефона долой.
      if (document.visibilityState === "visible") {
        void sweepReadNotifications((id) => {
          const c = userChats.find((x) => String(x.id) === id);
          return !c || (c.unread_count || 0) > 0;
        });
      }
    } catch (error) {
      console.error('Error refreshing chats:', error);
    }
  };

  const handleLogout = async () => {
    clearSessionCache();
    // Ключи секретных чатов живут только на устройстве — после выхода их нет.
    void import("@/lib/secret").then((m) => m.wipeSecretKeys());
    void clearMessageCache();
    try {
      // 🔔 Удаляем listeners при выходе
      if (Capacitor.isNativePlatform()) {
        FirebaseMessaging.removeAllListeners();
      }
      
      await api.logout();
      navigate("/auth");
    } catch {
      console.error("Ошибка при выходе");
    }
  };



  // Обработчик удаления чата
  const handleChatDeleted = (deletedChatId: string) => {
    setChats(prev => prev.filter(chat => chat.id !== deletedChatId));
    if (selectedChatId === deletedChatId) {
      setSelectedChatId(null);
    }
  };

  // Обработчик создания чата - перезагружаем список
  const handleChatCreated = async () => {
    try {
      await refreshChats();
    } catch (error) {
      console.error("Error refreshing chats after creation:", error);
    }
  };

  if (!user) return null;

  // Правила появились позже первых аккаунтов: кто их ещё не принимал, видит
  // экран согласия поверх чатов. Строго null — поле пришло и оно пустое.
  const termsGate = user.terms_accepted_at === null ? (
    <TermsGate
      onAccepted={(p) => { const next = { ...user, terms_accepted_at: p.terms_accepted_at }; setUser(next); writeCache("user", next); }}
      onLogout={handleLogout}
    />
  ) : null;

  // На телефоне два экрана вместо двух колонок: список чатов и переписка.
  // Показываем что-то одно — так же, как в привычных мессенджерах.
  // На телефоне два экрана вместо двух колонок: список чатов и переписка.
  // Показываем что-то одно — так же, как в привычных мессенджерах. Вкладки
  // (список, Избранное, Стена) — слои поверх друг друга: неактивные скрыты
  // visibility (прокрутка и состояние сохраняются), но остаются смонтированы,
  // и переключение не строит экран заново (PERF_PLAN.md, п. 4).
  if (isMobile) {
    const layer = (key: string, active: boolean, children: React.ReactNode) => (
      <div
        key={key}
        className={`absolute inset-0 flex min-h-0 ${active ? "" : "invisible pointer-events-none"}`}
        aria-hidden={!active}
        {...(active ? {} : { inert: "" as unknown as boolean })}
      >
        {children}
      </div>
    );
    return (
      <div className="h-screen flex flex-col bg-background nav-rail-pad">
        {termsGate}
        <div className="flex-1 min-h-0 relative">
          {visitedTabs.has("wall") && layer("wall", tab === "wall", (
            <div className="flex-1 min-h-0 flex">
              {wall ? (
                <Suspense fallback={null}><MemoChannelView
                  key="wall-tab"
                  channelId={wall.id}
                  userId={user.id}
                  wall
                  onOpenChannel={openChannelFromWallNav}
                  onWallChanged={refreshWallStable}
                /></Suspense>
              ) : (
                <p className="flex-1 flex items-center justify-center text-sm text-muted-foreground">{tr("Загрузка…")}</p>
              )}
            </div>
          ))}
          {visitedTabs.has("saved") && layer("saved", tab === "saved", (
            <div className="flex-1 min-h-0 flex">
              {savedChat?.id ? (
                <Suspense fallback={null}><ChatWindow
                  chatId={savedChat.id}
                  active={tab === "saved"}
                  userId={user.id}
                  peer={null}
                  group={null}
                  saved
                  chats={listChats}
                  savedChatId={savedChat?.id}
            onLatest={handleLatest}
            unreadAtOpen={unreadAtOpen}
                  title={tr("Избранное")}
                /></Suspense>
              ) : (
                <p className="flex-1 flex items-center justify-center text-sm text-muted-foreground">{tr("Загрузка…")}</p>
              )}
            </div>
          ))}
          {layer("chat", tab === "chat", (
            <div className="flex-1 min-w-0 min-h-0 relative"
              onTouchStart={onEdgeStart} onTouchMove={onEdgeMove} onTouchEnd={onEdgeEnd} onTouchCancel={onEdgeEnd}>
              {/* Список — всегда смонтирован; виден, когда переписка не открыта. */}
              {/* isolate (iPhone): «стеклянная» шапка списка со своим z-index не
                  вылезает поверх переписки, пока список под ней (баг-репорт 29f00ae7). */}
              <div ref={listLayerRef} className={`absolute inset-0 flex min-h-0 ${layerNav
                ? selectedChatId ? listCovered ? "isolate invisible pointer-events-none" : "isolate pointer-events-none" : "isolate"
                : selectedChatId ? "invisible pointer-events-none" : hadChatOpenRef.current ? "screen-pop" : ""}`}
                aria-hidden={!!selectedChatId} {...(selectedChatId ? { inert: "" as unknown as boolean } : {})}>
          <MemoSidebar
            ideabox={ideaboxChat ? { id: ideaboxChat.id, unread: (ideaboxChat as any).unread_count || 0, avatar_url: ideaboxChat.participants?.find((p) => (p as { is_bot?: boolean }).is_bot)?.avatar_url } : null}
            onOpenIdeabox={openIdeabox}
            userId={user.id}
            username={user.username}
            chats={listChats}
            onSelectChat={selectChat}
            onRefresh={refreshChats}
            selectedChatId={selectedChatId}
            onLogout={handleLogout}
            onOpenProfile={openProfile}
            onChatDeleted={handleChatDeleted}
            onChatCreated={handleChatCreated}
          />
              </div>
              {/* Затемнение списка под въезжающей перепиской (lib/navAnim). */}
              {layerNav && <div ref={dimRef} className="absolute inset-0 bg-black pointer-events-none" style={{ opacity: 0 }} aria-hidden />}
              {/* Канал (не в пуле) — поверх списка, как раньше. */}
              {selectedChatId && (isChannelOpen || isWallOpen) && (
                <div key={`ch-${selectedChatId}`} ref={layerRef(selectedChatId)}
                  className={`absolute inset-0 flex min-h-0 ${layerNav ? "isolate bg-background" : "screen-push"}`}>
            <Suspense fallback={null}><MemoChannelView
              key={isWallOpen ? "wall" : selectedChatId}
              channelId={selectedChatId}
              userId={user.id}
              wall={isWallOpen}
              onOpenChannel={openChannelFromWall}
              onWallChanged={() => { void refreshWall(); }}
              onBack={() => { setSelectedChatId(null); if (isWallOpen) void refreshWall(); }}
              onDeleted={() => { setSelectedChatId(null); refreshChats(); }}
            /></Suspense>
                </div>
              )}
              {/* Пул недавних переписок: активная — видна с въездом справа, остальные скрыты. */}
              {recentChats.map((id) => {
                const activeChat = id === selectedChatId && !isChannelOpen && !isWallOpen;
                const c = chats.find((x) => x.id === id);
                const p = c?.is_group ? null : c?.participants?.find((x) => x.id !== user.id) || null;
                return (
                  <div key={id} ref={layerRef(id)}
                    className={`absolute inset-0 flex min-h-0 ${layerNav
                      ? activeChat ? "isolate bg-background" : id === leavingId ? "isolate bg-background pointer-events-none" : "invisible pointer-events-none"
                      : activeChat ? "screen-push" : "invisible pointer-events-none"}`}
                    aria-hidden={!activeChat} {...(activeChat ? {} : { inert: "" as unknown as boolean })}>
                    <Suspense fallback={null}><ChatWindow
                      chatId={id}
                      active={activeChat}
                      userId={user.id}
                      onRov={sendRov}
                      peer={p}
                      group={c?.is_group ? c : null}
                      chats={listChats}
                      savedChatId={savedChat?.id}
                      onGroupUpdated={refreshChats}
                      onCall={startCall}
                      onLatest={handleLatest}
                      unreadAtOpen={activeChat ? unreadAtOpen : 0}
                      onBack={closeChat}
                      title={activeChat ? chatHeaderTitle : (c?.is_group ? c.name || tr("Группа") : p?.username || tr("Чат"))}
                    /></Suspense>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        {/* Панель вкладок — только над списком и вкладками: при открытой переписке
            или канале она закрывала поле ввода (баг-репорт 94e2ce74). */}
        {!(tab === "chat" && selectedChatId) && <BottomNav />}
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background nav-rail-pad">
      <UpdateBanner />
      {termsGate}
      <div className="flex-1 flex min-h-0">
      <MemoSidebar
            ideabox={ideaboxChat ? { id: ideaboxChat.id, unread: (ideaboxChat as any).unread_count || 0, avatar_url: ideaboxChat.participants?.find((p) => (p as { is_bot?: boolean }).is_bot)?.avatar_url } : null}
            onOpenIdeabox={openIdeabox}
        userId={user.id}
        chats={listChats}
        onOpenWall={openWall}
        wallSelected={isWallOpen}
        wallNew={wall?.new_count || 0}
        savedChatId={savedChat?.id}
        onOpenSaved={() => { if (savedChat) { setSelectedChatId(savedChat.id); setSelectedKind("saved"); } }}
        onSelectChat={(id, title, kind) => {
          setSelectedChatId(id);
          if (title) setSelectedChatTitle(title);
          setSelectedKind(kind);
        }}
        selectedChatId={selectedChatId}
        onLogout={handleLogout}
        onOpenProfile={() => navigate("/profile")}
        onChatDeleted={handleChatDeleted}
        onChatCreated={handleChatCreated}
      />

      {selectedChatId ? (
        isChannelOpen || isWallOpen ? (
          <Suspense fallback={null}><MemoChannelView
            key={isWallOpen ? "wall" : selectedChatId}
            channelId={selectedChatId}
            userId={user.id}
            wall={isWallOpen}
            onOpenChannel={openChannelFromWall}
            onWallChanged={() => { void refreshWall(); }}
            onDeleted={() => { setSelectedChatId(null); refreshChats(); }}
          /></Suspense>
        ) : (
        <Suspense fallback={null}><ChatWindow
          chatId={selectedChatId}
          userId={user.id}
          onRov={sendRov}
          peer={peer}
          group={selectedChat?.is_group ? selectedChat : null}
          saved={isSavedOpen}
          chats={listChats}
          savedChatId={savedChat?.id}
          onGroupUpdated={refreshChats}
          onCall={startCall}
            onLatest={handleLatest}
            unreadAtOpen={unreadAtOpen}
          title={chatHeaderTitle}
        /></Suspense>
        )
      ) : (
        <div className="flex-1 flex items-center justify-center bg-gradient-to-br from-background to-primary/5">
          <div className="text-center p-8">
            {/* Логотип, как на экране входа (раньше — пустая заглушка аватара). */}
            <img src={logo} alt="WYX" draggable={false} className="w-24 h-24 mx-auto mb-6 rounded-[18px] select-none pointer-events-none" />
            <h2 className="text-2xl font-bold text-foreground mb-2">{tr("Выберите чат")}</h2>
            <p className="text-muted-foreground max-w-md">
              {tr("Слева — список чатов. Откройте любой, чтобы начать переписку или позвонить.")}
            </p>
          </div>
        </div>
      )}
      </div>
      <BottomNav />
    </div>
  );
};

export default Chat;