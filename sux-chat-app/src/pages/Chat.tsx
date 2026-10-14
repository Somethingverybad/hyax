import { useEffect, useMemo, useRef, useState } from "react";
import { readCache, writeCache, clearSessionCache } from "@/lib/session-cache";
import BottomNav from "@/components/BottomNav";
import { applog } from "@/lib/applog";
import { clearMessageCache } from "@/lib/messageCache";
import { getPushSecret } from "@/lib/pushSecret";
import { useIsMobile } from "@/hooks/use-mobile";
import { useNavigate, useLocation } from "react-router-dom";
import ChatSidebar from "@/components/chat/ChatSidebar";
import ChatWindow, { type LatestMessage } from "@/components/chat/ChatWindow";
import ChannelView from "@/components/chat/ChannelView";
import Identicon from "@/components/Identicon";
import UpdateBanner from "@/components/UpdateBanner";
import TermsGate from "@/components/TermsGate";
import { syncThemeFromProfile } from "@/lib/theme";
import { api, mediaUrl, type WallState } from "@/api/client";
import { syncNotificationSounds } from "@/lib/notificationSounds";
import { requestMediaPermissionsOnce } from "@/lib/permissions";
import { playSfx } from "@/lib/sfx";
import { rovOn, rovOff, onRovState } from "@/lib/rov";
import { ensureNotifyPermission, showDesktopNotification } from "@/lib/desktopNotify";
import { WebSocketService } from "@/services/websocket";
import { OneToOneCallService, type CallState, type IncomingCall } from "@/services/call-service";
import { GroupCallService, type GroupCallInvite, type GroupCallState } from "@/services/group-call-service";
import { NativeCallService, NativeGroupCallService } from "@/services/native-call-service";
import { hasNativeCalls } from "@/lib/nativeCall";
import { voip, hasCallKit, type VoipCallPayload } from "@/lib/voip";
import CallOverlay, { type CallParticipant } from "@/components/call/CallOverlay";
import AddToCall, { type CallCandidate } from "@/components/call/AddToCall";
import type { PeerStream } from "@/services/group-call-service";
import { toast } from "sonner";
import { WS_URL, getFreshAccessToken } from "@/api/client";
import { FirebaseMessaging } from '@capacitor-firebase/messaging';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';

interface ChatType {
  id: string;
  name?: string;
  is_group?: boolean;
  created_at: string;
  updated_at: string;
  participants?: ProfileType[];
  /** Закрепление (личное) и время последнего сообщения — порядок списка. */
  pinned_at?: string | null;
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
const Chat = ({ savedMode = false, wallMode = false }: { savedMode?: boolean; wallMode?: boolean } = {}) => {
  const isMobile = useIsMobile();
  const [user, setUser] = useState<ProfileType | null>(() => readCache<ProfileType>("user"));
  const [chats, setChats] = useState<ChatType[]>(() => readCache<ChatType[]>("chats") || []);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  // Имя собеседника для шапки: приходит из сайдбара, он единственный, кто его
  // вычисляет — участники грузятся отдельно от списка чатов.
  const [selectedChatTitle, setSelectedChatTitle] = useState<string>("Чат");
  // Подсказка типа выбранного чата: канал из поиска может отсутствовать в
  // списке chats (пока не подписан), поэтому храним kind отдельно.
  const [selectedKind, setSelectedKind] = useState<string | undefined>(undefined);
  // Стена: строка наверху списка, пока она включена (chat/wall.py).
  const [wall, setWall] = useState<WallState | null>(() => readCache<WallState>("wall"));
  const refreshWall = () => api.getWall().then((w) => {
    setWall(w); writeCache("wall", w);
    // Бейдж на вкладке живёт в BottomNav — ему сообщаем событием.
    window.dispatchEvent(new CustomEvent("hyax:wall", { detail: w }));
  }).catch(() => {});
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  // Список чатов «приезжает» слева только как возврат из переписки: при
  // запуске приложения он просто на месте.
  const hadChatOpenRef = useRef(false);
  useEffect(() => { if (selectedChatId) hadChatOpenRef.current = true; }, [selectedChatId]);

  // Чат «Избранное» — узнаём у сервера один раз; в списке chats его нет.
  // Из кеша он берётся сразу, поэтому вкладка открывается с сообщениями, а не
  // с «Загрузка…»; ответ сервера потом только подтверждает id.
  const [savedChat, setSavedChat] = useState<ChatType | null>(() => readCache<ChatType>("saved"));
  useEffect(() => {
    let alive = true;
    const cached = readCache<ChatType>("saved");
    if (savedMode && cached?.id) { setSelectedChatId(cached.id); setSelectedKind("saved"); }
    api.getSavedChat()
      .then((c) => {
        if (!alive) return;
        setSavedChat(c as any);
        writeCache("saved", c);
        if (savedMode) { setSelectedChatId(c.id); setSelectedKind("saved"); }
      })
      .catch(() => { if (savedMode && !cached?.id) toast.error("Не удалось открыть Избранное"); });
    return () => { alive = false; };
  }, [savedMode]);

  // ===== Звонки =====
  // Один WebSocket и один сервис звонков на всё приложение: входящий должен
  // прийти, какой бы чат ни был открыт. На iOS входящий показывает CallKit
  // (VoIP-пуш), наш экран — только после ответа; на Android/в вебе всё наше.
  const [callState, setCallState] = useState<CallState>("idle");
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [callPeer, setCallPeer] = useState<{ id: string; name: string; avatarUrl?: string | null } | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [muted, setMuted] = useState(false);
  // Громкая связь по умолчанию: телефон обычно лежит на столе, а не у уха.
  const [speaker, setSpeaker] = useState(true);
  const wsRef = useRef<WebSocketService | null>(null);
  const callRef = useRef<OneToOneCallService | NativeCallService | null>(null);
  const lastCallIdRef = useRef<string | null>(null);
  // Групповой звонок ведёт отдельный сервис: там mesh из нескольких
  // соединений, а не единственный собеседник.
  const groupCallRef = useRef<GroupCallService | NativeGroupCallService | null>(null);
  const [groupState, setGroupState] = useState<GroupCallState>("idle");
  const [groupInvite, setGroupInvite] = useState<GroupCallInvite | null>(null);
  const [groupStreams, setGroupStreams] = useState<PeerStream[]>([]);
  const [groupPeers, setGroupPeers] = useState<string[]>([]);
  const groupCallIdRef = useRef<string | null>(null);
  // Громкость каждого участника у меня (1 — как есть); сбрасывается с концом звонка.
  const [peerVolumes, setPeerVolumes] = useState<Record<string, number>>({});
  // Имена и аватары участников звонка, которых нет в моих чатах.
  const [peopleInfo, setPeopleInfo] = useState<Record<string, { name: string; avatarUrl?: string | null }>>({});
  const [addToCallOpen, setAddToCallOpen] = useState(false);
  // Чаты нужны обработчикам звонка, а те живут вне рендера.
  const chatsRef = useRef<ChatType[]>([]);
  // Активный чат для обработчика сокета: он живёт в эффекте с deps
  // [user?.id] и иначе видел бы устаревший selectedChatId.
  const selectedChatIdRef = useRef<string | null>(null);
  selectedChatIdRef.current = selectedChatId;
  // Растёт на каждое входящее по сокету в открытом чате — ChatWindow по нему
  // перечитывает ленту сразу, а не через опрос.
  const [messagePing, setMessagePing] = useState(0);
  // Последнее событие о реакциях — ChatWindow применяет его к своей ленте.
  const [reactionEvent, setReactionEvent] = useState<{
    chat_id: string; message_id: string;
    reactions: { emoji: string; count: number; users: string[] }[]; at: number;
  } | null>(null);
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
    const tell = (chat: string | null) => wsRef.current?.send({ type: "viewing", chat });
    tell(selectedChatId);
    if (viewingTimerRef.current) clearInterval(viewingTimerRef.current);
    if (selectedChatId) {
      viewingTimerRef.current = setInterval(() => tell(selectedChatIdRef.current), 45000);
    }
    return () => {
      if (viewingTimerRef.current) { clearInterval(viewingTimerRef.current); viewingTimerRef.current = null; }
    };
  }, [selectedChatId]);

  // Свернули приложение или вкладку — чат больше не «открыт», пуши снова нужны.
  useEffect(() => {
    const onVisible = () => {
      const visible = document.visibilityState === "visible";
      wsRef.current?.send({ type: "viewing", chat: visible ? selectedChatIdRef.current : null });
      // «В сети» у собеседников — только пока приложение на экране.
      wsRef.current?.send({ type: "active", active: visible });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const rovTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sendRov = (on: boolean) => {
    const chatId = selectedChatIdRef.current;
    if (!chatId) return;
    if (rovTimerRef.current) { clearInterval(rovTimerRef.current); rovTimerRef.current = null; }
    wsRef.current?.send({ type: "rov", chat: chatId, on });
    if (on) {
      // Повторяем «держу», пока палец на площадке: приёмник глушит вибрацию
      // по тишине, если сигналы перестали приходить.
      rovTimerRef.current = setInterval(() => {
        wsRef.current?.send({ type: "rov", chat: chatId, on: true });
      }, 400);
    }
  };
  useEffect(() => () => { if (rovTimerRef.current) clearInterval(rovTimerRef.current); rovOff(); }, []);

  // Показываем, кто нас ревёт: вибрация вибрацией, но на десктопе её нет.
  useEffect(() => {
    onRovState((active, from) => {
      if (active) toast(`${from || "Собеседник"} ревёт`, { id: "rov", duration: 60000 });
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
    setChats((prev) =>
      prev.map((c) => (c.id === selectedChatId ? { ...c, unread_count: 0, unread_mention: false } : c))
    );
    // И при уходе из чата: всё, что пришло, пока он был открыт, тоже прочитано.
    // Несколько секунд считаем его прочитанным и в списке (см. mergeUnread),
    // пока сервер не применил отметку, — иначе бейдж мигал бы.
    return () => {
      leftChatRef.current = { id: selectedChatId, until: Date.now() + 8000 };
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
        navigate("/auth");
      }
    };
    
    initializeApp();
  }, [navigate]);

  // 🔔 Функция инициализации push-уведомлений
  // Firebase, а не @capacitor/push-notifications: тот на iOS отдаёт сырой
  // APNs-токен, который FCM отправить не может. Firebase SDK сам меняет его
  // на FCM-овский — бэкенд работает с iOS и будущим Android одинаково.
  const initPushNotifications = async (_userId: string) => {
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

      // По тапу на пуш открываем чат из data.chat_id.
      await FirebaseMessaging.addListener('notificationActionPerformed', (e) => {
        const data = (e?.notification?.data as any) || {};
        if (data.kind === "vibe") { navigate("/profile"); return; }
        const chatId = data.chat_id;
        if (chatId) {
          setSelectedChatId(String(chatId));
          // Чат мог быть новым — подтянем список, чтобы заголовок и участники
          // подхватились, а не остались от предыдущего диалога.
          refreshChats();
        }
      });

      // Тихий пуш «отбой»: звонящий отменил вызов, пока наш WebSocket молчал.
      await FirebaseMessaging.addListener('notificationReceived', (e) => {
        const d = ((e as any)?.notification?.data as Record<string, string>) || {};
        if (d.type === 'call_ended' && d.call_id) {
          voip.endCall(String(d.call_id));
          const svc = callRef.current;
          if (svc && svc.getCurrentCallId() === String(d.call_id)) svc.endCall("ended", false);
          const group = groupCallRef.current;
          if (group && group.getCallId() === String(d.call_id) && group.getState() === "incoming") group.reject();
        }
      });

      const { token } = await FirebaseMessaging.getToken();
      await sendPushTokenToServer(token);
    } catch (error) {
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

    // Устанавливаем интервал для автообновления чатов
    const intervalId = setInterval(() => {
      refreshChats();
    }, 5000); // Обновляем каждые 5 секунд
    // Стена: счётчик новых постов — реже, он не срочный.
    void refreshWall();
    const wallTimer = setInterval(() => { void refreshWall(); }, 30000);

    return () => {
      clearInterval(intervalId);
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
      appStateListener.remove();
    };
  }, []);

  // Аппаратная кнопка «назад» (Android): из открытого чата — назад к списку;
  // на списке — свернуть приложение. Без обработчика системная кнопка ничего
  // не делала внутри чата.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let handle: { remove: () => void } | undefined;
    App.addListener('backButton', () => {
      if (selectedChatIdRef.current) {
        setSelectedChatId(null);
      } else {
        App.minimizeApp();
      }
    }).then((h) => { handle = h; });
    return () => { handle?.remove(); };
  }, []);

  // Сигналинг звонков: пользовательский WebSocket + глобальный сервис звонков.
  useEffect(() => {
    if (!user?.id) return;
    let disposed = false;

    const ws = new WebSocketService(`${WS_URL}/user/${user.id}/`, {
      maxReconnectAttempts: 20,
      // Сервер считает новое соединение «на экране»; если переподключились
      // в фоне — сразу поправляем, чтобы у собеседников не горело «в сети».
      onOpen: () => ws.send({ type: "active", active: document.visibilityState === "visible" }),
      onMessage: (msg: any) => {
        const svc = callRef.current;
        if (msg?.type === "notification" && msg.data?.type === "incoming_call") {
          if (msg.data.group === "1" || msg.data.group === true) {
            groupCallRef.current?.notifyIncoming({
              callId: msg.data.call_id,
              chatId: msg.data.chat_id,
              fromUserId: msg.data.from_user_id,
              fromUsername: msg.data.from_username,
              chatName: msg.data.chat_name || "Группа",
            });
            return;
          }
          if (hasCallKit()) {
            // iOS: экран вызова рисует система. Пуш мог не дойти — просим
            // показать вызов и по сигналу из сокета, дубли отсекаются по id.
            voip.reportIncomingCall({
              callId: msg.data.call_id,
              chatId: msg.data.chat_id,
              fromUserId: msg.data.from_user_id,
              fromUsername: msg.data.from_username,
              fromUserAvatar: msg.data.from_user_avatar,
              callType: msg.data.call_type || "audio",
            });
            return;
          }
          svc?.notifyIncomingCall({
            callId: msg.data.call_id,
            chatId: msg.data.chat_id,
            fromUserId: msg.data.from_user_id,
            fromUsername: msg.data.from_username,
            fromUserAvatar: msg.data.from_user_avatar,
            callType: msg.data.call_type,
          });
        } else if (msg?.type === "call_signal") {
          const group = groupCallRef.current;
          // В личный звонок добавили людей: сервер прислал состав (call_peers).
          // Отдаём живое соединение групповому сервису — разговор не прерывается.
          if (msg.signal_type === "call_peers" && group && group.getState() === "idle" && svc
              && svc.getCurrentCallId() && svc.getCurrentCallId() === msg.data?.call_id) {
            const d = svc.detach();
            if (d) {
              group.adopt(d as any);
              lastCallIdRef.current = null;
              setCallPeer(null);
              setRemoteStream(null);
              setIncomingCall(null);
            }
          }
          const forGroup =
            msg.signal_type === "call_peers" ||
            (group?.getCallId() && group.getCallId() === msg.data?.call_id);
          if (forGroup) group?.handleSignal(msg.signal_type, msg.data);
          else svc?.handleSignal(msg.signal_type, msg.data);
        } else if (msg?.data?.type === "reaction") {
          // Реакции приходят событием: обычная синхронизация их не приносит —
          // само сообщение при этом не меняется.
          setReactionEvent({ ...msg.data, at: Date.now() });
        } else if (msg?.data?.type === "session_revoked") {
          // Сеанс завершили из «Устройств» на другом устройстве — выходим и чистим кэш.
          void import("@/lib/secret").then(({ deviceId }) => {
            const me = deviceId();
            const d = msg.data as { device_id?: string; all_except?: string };
            if (d.device_id === me || ("all_except" in d && d.all_except !== me)) {
              void import("@/lib/forceLogout").then((m) => m.forceLogout("revoked"));
            }
          });
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
          toast(ban ? "Вам запретили писать на Стену" : "Вам снова можно писать на Стену", { id: "wall-ban" });
        } else if (msg?.data?.type === "vibe") {
          // Подняли вайб: тост с именем (или без — анонимно) и свежее число в кеше профиля.
          const who = msg.data.from?.username;
          toast.success(who ? `${who} поднял(а) ваш вайб` : "Кто-то поднял ваш вайб", { description: `Вайбометр: ${msg.data.vibe}`, id: "vibe" });
          playSfx("sent");
          setUser((u) => { if (!u) return u; const n = { ...u, vibe: msg.data.vibe }; writeCache("user", n); return n; });
        } else if (msg?.data?.type === "rov") {
          // Сигнал живёт, только пока приложение открыто: в истории его нет.
          if (msg.data.on) rovOn(msg.data.from_username);
          else rovOff();
        } else if (msg?.type === "new_message" || msg?.data?.type === "new_message") {
          refreshChats();
          // Системный баннер для веб/десктопа. На мобильных — нативный пуш.
          const m = msg?.data?.message ?? msg?.message;
          const chatId = msg?.data?.chat_id ?? m?.chat;
          const senderId = m?.sender?.id;
          // «Глюк-стикер» от собеседника: открытый чат разыграет эффект.
          if (m?.effect === "burst" && m?.sticker?.file_url && senderId && senderId !== user?.id) {
            window.dispatchEvent(new CustomEvent("hyax:burst", { detail: { chat_id: String(chatId), url: m.sticker.file_url } }));
          }
          const active = document.visibilityState === "visible" &&
            chatId && String(chatId) === selectedChatIdRef.current;
          // Открытая переписка обновляется сразу, даже если вкладка в фоне:
          // вернувшись, пользователь увидит сообщение уже на месте.
          if (chatId && String(chatId) === selectedChatIdRef.current) {
            setMessagePing((n) => n + 1);
          }
          if (m && senderId && senderId !== user.id && !active) {
            const preview =
              (m.content || "").trim() ||
              (m.sticker ? "Стикер" :
               m.video_url ? "Видео-сообщение" :
               m.voice_url ? "Голосовое сообщение" :
               m.file_url ? "Файл" : "Новое сообщение");
            // Из группы — заголовок с названием группы, в тексте автор: сразу
            // видно, откуда сообщение. Личное — просто имя собеседника.
            const chatRow = chatsRef.current.find((c) => String(c.id) === String(chatId)) as (ChatType & { is_group?: boolean; kind?: string; name?: string; notify_sound?: { url?: string } | null }) | undefined;
            const fromGroup = !!chatRow?.is_group && chatRow?.kind !== "channel";
            showDesktopNotification({
              title: fromGroup ? (chatRow?.name || "Группа") : (m.sender?.username || "Новое сообщение"),
              body: (fromGroup && m.sender?.username ? `${m.sender.username}: ${preview}` : preview).slice(0, 150),
              tag: chatId ? String(chatId) : undefined,
              avatar: m.sender?.avatar_url ? mediaUrl(m.sender.avatar_url) : undefined,
              onClick: () => { if (chatId) setSelectedChatId(String(chatId)); },
            });
            // Звук — только там, где нет пушей (веб/десктоп): на телефоне об
            // этом же сообщении звенит пуш, дублировать его в приложении не надо.
            // Порядок: аудио-стикер сообщения → «мой звук» отправителя → receive.
            if (!Capacitor.isNativePlatform()) {
              try {
                const custom = m.sound?.url || (chatsRef.current.find((c) => String(c.id) === String(chatId)) as { notify_sound?: { url?: string } | null } | undefined)?.notify_sound?.url || m.sender?.notify_sound?.url;
                void playSfx(custom ? mediaUrl(custom) : "/sounds/receive.mp3", { volume: 0.6 });
              } catch { /* без звука не критично */ }
            }
          }
        }
      },
    });
    void ws.connect(getFreshAccessToken);
    wsRef.current = ws;

    // iOS рвёт сокет в фоне — при возврате переподключаемся сразу.
    const appStatePromise = App.addListener("appStateChange", ({ isActive }) => {
      if (isActive && !ws.isConnected()) void ws.connect();
    });

    const waitForWs = async () => {
      for (let i = 0; i < 50 && !ws.isConnected(); i++) {
        await new Promise((r) => setTimeout(r, 100));
      }
    };

    const listeners: Array<Promise<{ remove: () => Promise<void> } | null>> = [];

    (async () => {
      const iceServers = await api.getIceServers();
      if (disposed) return;
      // В приложении разговор ведёт нативный движок: в WebView звук не
      // уживался с CallKit и умирал при блокировке экрана. В браузере
      // остаётся прежний путь.
      const CallImpl = hasNativeCalls() ? NativeCallService : OneToOneCallService;
      const svc = new CallImpl({
        wsService: ws,
        chatId: "",
        userId: user.id,
        iceServers,
        onStateChange: (state) => {
          setCallState(state);
          const id = svc.getCurrentCallId();
          if (id) lastCallIdRef.current = id;
          if (state === "active" && id) {
            voip.reportConnected(id);
            voip.setSpeaker(true);
            setSpeaker(true);
          }
        },
        onIncomingCall: (c) => {
          setIncomingCall(c);
          setCallPeer({ id: c.fromUserId, name: c.fromUsername, avatarUrl: c.fromUserAvatar });
        },
        onRemoteStream: (stream) => setRemoteStream(stream),
        onCallEnded: () => {
          if (lastCallIdRef.current) voip.endCall(lastCallIdRef.current);
          lastCallIdRef.current = null;
          setIncomingCall(null);
          setRemoteStream(null);
          setMuted(false);
          setCallPeer(null);
        },
        onError: (message) => toast.error(message),
      });
      callRef.current = svc;

      const GroupImpl = hasNativeCalls() ? NativeGroupCallService : GroupCallService;
      groupCallRef.current = new GroupImpl({
        wsService: ws,
        userId: user.id,
        iceServers,
        onStateChange: (st) => {
          setGroupState(st);
          const gid = groupCallRef.current?.getCallId();
          if (st !== "idle" && gid) groupCallIdRef.current = gid;
          if (st === "active") voip.setSpeaker(true);
          if (st === "idle") {
            // Звонок, который начинался личным, CallKit знает по тому же id.
            if (groupCallIdRef.current) voip.endCall(groupCallIdRef.current);
            groupCallIdRef.current = null;
            setGroupInvite(null);
            setGroupStreams([]);
            setGroupPeers([]);
            setPeerVolumes({});
            setMuted(false);
            setAddToCallOpen(false);
          }
        },
        onIncoming: (invite) => setGroupInvite(invite),
        onStreams: setGroupStreams,
        onPeers: setGroupPeers,
        onError: (m) => toast.error(m),
      });

      // Ответ с системного экрана CallKit (в том числе с заблокированного
      // экрана, когда приложение только что запустилось этим звонком).
      const handleAnswered = async (c: VoipCallPayload) => {
        await waitForWs();
        const chat = chatsRef.current.find((x) => x.id === c.chatId);
        if (c.group || chat?.is_group) {
          const group = groupCallRef.current;
          group?.notifyIncoming({
            callId: c.callId,
            chatId: c.chatId,
            fromUserId: c.fromUserId,
            fromUsername: c.fromUsername,
            chatName: c.chatName || chat?.name || "Группа",
          });
          await group?.accept();
          if (c.chatId) setSelectedChatId(c.chatId);
          return;
        }
        svc.notifyIncomingCall({
          callId: c.callId,
          chatId: c.chatId,
          fromUserId: c.fromUserId,
          fromUsername: c.fromUsername,
          fromUserAvatar: c.fromUserAvatar,
          callType: c.callType,
        });
        await svc.acceptIncomingCall(c.callId, c.fromUserId);
        setIncomingCall(null);
        if (c.chatId) setSelectedChatId(c.chatId);
        if (c.fromUsername) setSelectedChatTitle(c.fromUsername);
      };

      const toIncoming = (c: VoipCallPayload) => ({
        callId: c.callId,
        chatId: c.chatId,
        fromUserId: c.fromUserId,
        fromUsername: c.fromUsername,
        fromUserAvatar: c.fromUserAvatar,
        callType: c.callType,
      });

      listeners.push(
        voip.on("voipToken", ({ token: t }: any) => {
          api.registerPushToken(t, "ios_voip").catch(() => {});
        }),
        voip.on("callAnswered", (c: any) => handleAnswered(c)),
        // Android: звонок пришёл пушем (приложение на экране или открыто
        // из уведомления поверх блокировки) — показываем свой экран входящего.
        voip.on("callIncoming", (c: any) => {
          if (svc.getState() === "idle") svc.notifyIncomingCall(toIncoming(c));
        }),
        voip.on("callEnded", ({ callId }: any) => {
          const group = groupCallRef.current;
          if (group && group.getCallId() === callId) {
            if (group.getState() === "incoming") group.reject(); else group.leave();
            return;
          }
          if (svc.getCurrentCallId() !== callId) return;
          const peerId = callPeer?.id;
          if (svc.getState() === "incoming" && peerId) svc.rejectIncomingCall(callId, peerId);
          else svc.endCall("ended", true);
        }),
        voip.on("callMuted", ({ muted: m }: any) => {
          const group = groupCallRef.current;
          if (group && group.getState() !== "idle") {
            if (group.isMuted() !== m) group.toggleMute();
          } else if (svc.isMuted() !== m) svc.toggleMute();
          setMuted(m);
        })
      );
      await voip.register();
      const pending = await voip.getPendingAnswer();
      if (pending && !disposed) {
        if (pending.answered) handleAnswered(pending.call);
        else svc.notifyIncomingCall(toIncoming(pending.call));
      }
    })();

    return () => {
      disposed = true;
      listeners.forEach((l) => l?.then((h) => h?.remove()));
      appStatePromise.then((h) => h.remove());
      callRef.current?.dispose();
      callRef.current = null;
      groupCallRef.current?.dispose();
      groupCallRef.current = null;
      ws.disconnect();
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const selectedChat = chats.find((c) => c.id === selectedChatId) || (savedChat?.id === selectedChatId ? savedChat : undefined);
  const isChannelOpen = selectedKind === "channel" || (selectedChat as any)?.kind === "channel";
  const isWallOpen = selectedKind === "wall";
  const openChannelFromWall = (id: string, title?: string) => {
    setSelectedChatId(id);
    setSelectedKind("channel");
    if (title) setSelectedChatTitle(title);
  };
  const isSavedOpen = !!selectedChatId && (selectedKind === "saved" || (selectedChat as any)?.kind === "saved");
  // «Избранное» живёт на своей вкладке — из общего списка его убираем.
  // «Долгий ящик» — своя строка наверху списка (ChatSidebar), в общем списке его нет.
  const listChats = chats.filter((c) => (c as any).kind !== "saved" && (c as any).kind !== "ideabox");
  // Стена — своя вкладка (/wall) и строка над списком на десктопе; в самом списке её нет.
  const openWall = () => {
    if (isMobile) { navigate("/wall"); return; }
    if (!wall) { toast.error("Стена ещё не загрузилась"); return; }
    setSelectedChatId(wall.id); setSelectedKind("wall"); setSelectedChatTitle("Стена");
  };
  const ideaboxChat = chats.find((c) => (c as any).kind === "ideabox") || null;
  const openIdeabox = async () => {
    try {
      const id = ideaboxChat?.id || (await api.getIdeabox()).id;
      if (!ideaboxChat) await refreshChats();
      setSelectedChatId(id);
      setSelectedKind("ideabox");
      setSelectedChatTitle("Долгий ящик");
    } catch (e) {
      toast.error((e as Error).message || "Не удалось открыть");
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
    ? "Избранное"
    : selectedChat
    ? selectedChat.is_group
      ? selectedChat.name || "Группа"
      : peer?.username || selectedChatTitle
    : selectedChatTitle;

  const startCall = async () => {
    if (!selectedChatId) return;
    if (selectedChat?.is_group) {
      await groupCallRef.current?.start(selectedChatId);
      return;
    }
    const svc = callRef.current;
    if (!svc || !peer) return;
    if (svc.getState() !== "idle") return;
    svc.updateChatId(selectedChatId);
    setCallPeer({ id: peer.id, name: peer.username, avatarUrl: peer.avatar_url });
    await svc.startOutgoingCall(peer.id);
    const id = svc.getCurrentCallId();
    if (id) voip.reportOutgoingCall(id, peer.username);
    else setCallPeer(null);
  };

  const acceptCall = async () => {
    const svc = callRef.current;
    if (!svc || !incomingCall) return;
    await svc.acceptIncomingCall(incomingCall.callId, incomingCall.fromUserId);
    setSelectedChatId(incomingCall.chatId);
    setSelectedChatTitle(incomingCall.fromUsername);
    setIncomingCall(null);
  };

  const rejectCall = () => {
    const svc = callRef.current;
    if (!svc || !incomingCall) return;
    svc.rejectIncomingCall(incomingCall.callId, incomingCall.fromUserId);
    setIncomingCall(null);
  };

  const hangup = () => callRef.current?.endCall("ended", true);

  const toggleMute = () => {
    const m = callRef.current?.toggleMute();
    setMuted(!!m);
  };

  const toggleSpeaker = () => {
    const next = !speaker;
    setSpeaker(next);
    voip.setSpeaker(next);
  };

  /** Кто это: из участников чатов, иначе из кеша, иначе подтянем с сервера. */
  const personInfo = (id: string): { name: string; avatarUrl?: string | null } => {
    for (const c of chatsRef.current) {
      const p = c.participants?.find((x) => x.id === id);
      if (p) return { name: p.username, avatarUrl: p.avatar_url };
    }
    return peopleInfo[id] || { name: "…" };
  };
  useEffect(() => {
    const missing = groupPeers.filter((id) => personInfo(id).name === "…" && !peopleInfo[id]);
    if (!missing.length) return;
    let alive = true;
    Promise.all(missing.map((id) => api.getProfileById(id).then((p) => [id, { name: p.username, avatarUrl: p.avatar_url }] as const).catch(() => null)))
      .then((rows) => { if (alive) setPeopleInfo((prev) => { const n = { ...prev }; rows.forEach((r) => { if (r) n[r[0]] = r[1]; }); return n; }); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupPeers]);

  /** Громкость участника у меня: в вебе — элементом, в приложении — движком. */
  const setPeerVolume = (id: string, v: number) => {
    setPeerVolumes((prev) => ({ ...prev, [id]: v }));
    const group = groupCallRef.current;
    if (group && "setPeerVolume" in group && group.getState() !== "idle") (group as NativeGroupCallService).setPeerVolume(id, v);
    else if (hasNativeCalls() && callPeer && callState === "active") (callRef.current as NativeCallService | null)?.setPeerVolume?.(id, v);
  };

  /** Позвать ещё людей: сервер разошлёт им вызов и вернёт состав, после
   *  чего личный звонок станет групповым сам (см. обработку call_peers). */
  const addToCall = (ids: string[]) => {
    setAddToCallOpen(false);
    const group = groupCallRef.current;
    const svc = callRef.current;
    if (group && group.getState() !== "idle") { group.addParticipants(ids); return; }
    const callId = svc?.getCurrentCallId();
    if (callId && wsRef.current) {
      wsRef.current.send({ type: "call_add", data: { chat_id: selectedChatId, call_id: callId, user_ids: ids } });
    }
  };

  // Кого можно позвать: участники открытого чата и люди из личных переписок,
  // кроме себя и тех, кто уже в звонке.
  const inCall = new Set<string>([user?.id || "", ...groupPeers, callPeer?.id || ""]);
  const callCandidates: CallCandidate[] = (() => {
    const map = new Map<string, CallCandidate>();
    const add = (p?: { id: string; username: string; avatar_url?: string | null; is_bot?: boolean } | null) => {
      if (!p || inCall.has(p.id) || (p as any).is_bot) return;
      if (!map.has(p.id)) map.set(p.id, { id: p.id, name: p.username, avatarUrl: p.avatar_url });
    };
    selectedChat?.participants?.forEach((p) => add(p as any));
    chats.filter((c) => !(c as any).is_group && !["saved", "ideabox", "channel", "secret", "system"].includes((c as any).kind || "direct"))
      .forEach((c) => c.participants?.forEach((p) => add(p as any)));
    return [...map.values()];
  })();

  const groupParticipants: CallParticipant[] = groupPeers.map((id) => {
    const info = personInfo(id);
    const st = groupStreams.find((x) => x.peerId === id);
    return { id, name: info.name, avatarUrl: info.avatarUrl, stream: st?.stream || null, connected: !!st || hasNativeCalls() };
  });

  const groupCallUi = groupState !== "idle" ? (
    <CallOverlay
      state={groupState === "outgoing" ? "outgoing" : groupState === "incoming" ? "incoming" : "active"}
      peer={{
        id: groupInvite?.chatId || selectedChatId || "group",
        name: groupInvite?.chatName || (groupPeers.length <= 1 && groupPeers[0] ? personInfo(groupPeers[0]).name : selectedChat?.name || "Групповой звонок"),
      }}
      isGroup
      participants={groupParticipants}
      volumes={peerVolumes}
      onVolume={setPeerVolume}
      onAdd={() => setAddToCallOpen(true)}
      muted={muted}
      onAccept={async () => {
        await groupCallRef.current?.accept();
        if (groupInvite?.chatId) setSelectedChatId(groupInvite.chatId);
      }}
      onReject={() => groupCallRef.current?.reject()}
      onHangup={() => groupCallRef.current?.leave()}
      onToggleMute={() => {
        const m = groupCallRef.current?.toggleMute();
        setMuted(!!m);
      }}
      speaker={speaker}
      onToggleSpeaker={toggleSpeaker}
    />
  ) : null;

  const callUi = (
    <>
      {groupCallUi ?? (callPeer ? (
    <CallOverlay
      state={callState}
      peer={callPeer}
      muted={muted}
      participants={[{ id: callPeer.id, name: callPeer.name, avatarUrl: callPeer.avatarUrl, stream: remoteStream, connected: callState === "active" }]}
      volumes={peerVolumes}
      onVolume={setPeerVolume}
      onAdd={() => setAddToCallOpen(true)}
      onAccept={acceptCall}
      onReject={rejectCall}
      onHangup={hangup}
      onToggleMute={toggleMute}
      speaker={speaker}
      onToggleSpeaker={toggleSpeaker}
    />
  ) : null)}
      {addToCallOpen && <AddToCall candidates={callCandidates} onClose={() => setAddToCallOpen(false)} onConfirm={addToCall} />}
    </>
  );

  // 🔔 Функция обновления списка чатов
  // getChats счётчик непрочитанного не отдаёт — берём его из отдельного
  // эндпоинта и подмешиваем. Открытый чат сразу считаем прочитанным.
  const mergeUnread = async (list: ChatType[]): Promise<ChatType[]> => {
    try {
      const u = await api.getUnreadCount();
      const openId = selectedChatIdRef.current;
      // Только что закрытый чат тоже прочитан: отметка «прочитано» уходит при
      // выходе, и ответ счётчика, собранный до неё, на миг вернул бы бейдж.
      const left = leftChatRef.current;
      const leftId = left && Date.now() < left.until ? left.id : null;
      return list.map((c) => ({
        ...c,
        unread_count: c.id === openId || c.id === leftId ? 0 : (u.unread_by_chat?.[c.id] || 0),
        unread_mention: c.id === openId || c.id === leftId ? false : !!u.mention_by_chat?.[c.id],
      }));
    } catch {
      return list;
    }
  };

  // Последнее сообщение, которое уже видела открытая переписка: ответ опроса
  // /chats/, отправленный раньше, не должен откатывать строку назад.
  const latestRef = useRef<Record<string, LatestMessage>>({});
  const leftChatRef = useRef<{ id: string; until: number } | null>(null);

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

  const handleLatest = (chatId: string, latest: LatestMessage) => {
    latestRef.current[chatId] = latest;
    setChats((prev) => {
      const next = sortChats(withLatest(prev).map((c) => (c.id === chatId ? { ...c, unread_count: 0, unread_mention: false } : c)));
      writeCache("chats", next);
      return next;
    });
  };

  const refreshChats = async () => {
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

  const toggleSidebar = () => {
    setIsSidebarCollapsed(!isSidebarCollapsed);
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
  if (isMobile) {
    return (
      <div className="h-screen flex flex-col bg-background">
        {termsGate}
        {callUi}
        {wallMode ? (
          <>
            <div className="flex-1 min-h-0 flex">
              {wall ? (
                <ChannelView
                  key="wall-tab"
                  channelId={wall.id}
                  userId={user.id}
                  wall
                  onOpenChannel={(id, title) => navigate("/chat", { state: { chatId: id, kind: "channel", title } })}
                  onWallChanged={() => { void refreshWall(); }}
                />
              ) : (
                <p className="flex-1 flex items-center justify-center text-sm text-muted-foreground">Загрузка…</p>
              )}
            </div>
            <BottomNav />
          </>
        ) : savedMode ? (
          <>
            <div className="flex-1 min-h-0 flex">
              {selectedChatId ? (
                <ChatWindow
                  chatId={selectedChatId}
                  userId={user.id}
                  peer={null}
                  group={null}
                  saved
                  chats={listChats}
                  savedChatId={savedChat?.id}
                  messagePing={messagePing}
            onLatest={handleLatest}
            unreadAtOpen={unreadAtOpen}
          reactionEvent={reactionEvent}
            reactionEvent={reactionEvent}
                  reactionEvent={reactionEvent}
                  title="Избранное"
                />
              ) : (
                <p className="flex-1 flex items-center justify-center text-sm text-muted-foreground">Загрузка…</p>
              )}
            </div>
            <BottomNav />
          </>
        ) : selectedChatId ? (
          // Смены маршрута тут нет — список и переписка живут на одном экране,
          // поэтому движение задаём сами: переписка въезжает справа, список
          // возвращается слева. Ключ по чату перезапускает анимацию при
          // переходе из чата в чат.
          <div key={selectedChatId} className="flex-1 min-w-0 min-h-0 flex screen-push">
          {isChannelOpen || isWallOpen ? (
            <ChannelView
              key={isWallOpen ? "wall" : selectedChatId}
              channelId={selectedChatId}
              userId={user.id}
              wall={isWallOpen}
              onOpenChannel={openChannelFromWall}
              onWallChanged={() => { void refreshWall(); }}
              onBack={() => { setSelectedChatId(null); if (isWallOpen) void refreshWall(); }}
              onDeleted={() => { setSelectedChatId(null); refreshChats(); }}
            />
          ) : (
          <ChatWindow
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
            messagePing={messagePing}
            onLatest={handleLatest}
            unreadAtOpen={unreadAtOpen}
          reactionEvent={reactionEvent}
            reactionEvent={reactionEvent}
            onBack={() => setSelectedChatId(null)}
            title={chatHeaderTitle}
          />
          )}
          </div>
        ) : (
          <>
          {/* Обёртка растягивает список на всю высоту — иначе бар прилипал
              к последней строке, а под ним оставалась пустота. */}
          <div className={`flex-1 min-h-0 flex${hadChatOpenRef.current ? " screen-pop" : ""}`}>
          <ChatSidebar
            ideabox={ideaboxChat ? { id: ideaboxChat.id, unread: (ideaboxChat as any).unread_count || 0, avatar_url: ideaboxChat.participants?.find((p) => (p as { is_bot?: boolean }).is_bot)?.avatar_url } : null}
            onOpenIdeabox={openIdeabox}
            userId={user.id}
            username={user.username}
            chats={listChats}
            onSelectChat={(id, title, kind) => {
              setSelectedChatId(id);
              if (title) setSelectedChatTitle(title);
              setSelectedKind(kind);
            }}
            onRefresh={refreshChats}
            selectedChatId={selectedChatId}
            onLogout={handleLogout}
            isCollapsed={false}
            onToggleCollapse={toggleSidebar}
            onOpenProfile={() => navigate("/profile")}
            onChatDeleted={handleChatDeleted}
            onChatCreated={handleChatCreated}
          />
          </div>
          {/* Плашка обновления на телефоне живёт в списке чатов под фильтрами
              (ChatSidebar): внизу её накрывал плавающий остров навигации
              «Мяты» (баг-репорт 8ade5c86), сверху — вырез под камеру. */}
          <BottomNav />
          </>
        )}
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      <UpdateBanner />
      {termsGate}
      <div className="flex-1 flex min-h-0">
      {callUi}
      <ChatSidebar
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
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={toggleSidebar}
        onOpenProfile={() => navigate("/profile")}
        onChatDeleted={handleChatDeleted}
        onChatCreated={handleChatCreated}
      />

      {selectedChatId ? (
        isChannelOpen || isWallOpen ? (
          <ChannelView
            key={isWallOpen ? "wall" : selectedChatId}
            channelId={selectedChatId}
            userId={user.id}
            wall={isWallOpen}
            onOpenChannel={openChannelFromWall}
            onWallChanged={() => { void refreshWall(); }}
            onDeleted={() => { setSelectedChatId(null); refreshChats(); }}
          />
        ) : (
        <ChatWindow
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
          messagePing={messagePing}
            onLatest={handleLatest}
            unreadAtOpen={unreadAtOpen}
          reactionEvent={reactionEvent}
          title={chatHeaderTitle}
        />
        )
      ) : (
        <div className="flex-1 flex items-center justify-center bg-gradient-to-br from-background to-primary/5">
          <div className="text-center p-8">
            <div className="w-24 h-24 mx-auto mb-6">
              <Identicon id="hyax-empty" avatarUrl={null} className="w-24 h-24" />
            </div>
            <h2 className="text-2xl font-bold text-foreground mb-2">Выберите чат</h2>
            <p className="text-muted-foreground max-w-md">
              Слева — список чатов. Откройте любой, чтобы начать переписку или позвонить.
            </p>
          </div>
        </div>
      )}
      </div>
    </div>
  );
};

export default Chat;