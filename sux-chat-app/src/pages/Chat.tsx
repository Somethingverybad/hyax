import { useEffect, useRef, useState } from "react";
import { readCache, writeCache, clearSessionCache } from "@/lib/session-cache";
import BottomNav from "@/components/BottomNav";
import { useIsMobile } from "@/hooks/use-mobile";
import { useNavigate } from "react-router-dom";
import ChatSidebar from "@/components/chat/ChatSidebar";
import ChatWindow from "@/components/chat/ChatWindow";
import ChannelView from "@/components/chat/ChannelView";
import Identicon from "@/components/Identicon";
import UpdateBanner from "@/components/UpdateBanner";
import { api, mediaUrl } from "@/api/client";
import { syncNotificationSounds } from "@/lib/notificationSounds";
import { requestMediaPermissionsOnce } from "@/lib/permissions";
import { playSfx } from "@/lib/sfx";
import { ensureNotifyPermission, showDesktopNotification } from "@/lib/desktopNotify";
import { WebSocketService } from "@/services/websocket";
import { OneToOneCallService, type CallState, type IncomingCall } from "@/services/call-service";
import { GroupCallService, type GroupCallInvite, type GroupCallState } from "@/services/group-call-service";
import { NativeCallService, NativeGroupCallService } from "@/services/native-call-service";
import { hasNativeCalls } from "@/lib/nativeCall";
import { voip, hasCallKit, type VoipCallPayload } from "@/lib/voip";
import CallOverlay from "@/components/call/CallOverlay";
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
  last_message?: { text: string; sender_id: string } | null;
  unread_count?: number;
}

interface ProfileType {
  id: string;
  username: string;
  avatar_url?: string;
  status?: string;
}

/** savedMode — вкладка «Избранное»: вместо списка сразу открыт личный чат
 *  без собеседника (сервер создаёт его при первом обращении). */
const Chat = ({ savedMode = false }: { savedMode?: boolean } = {}) => {
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
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  // Чат «Избранное» — узнаём у сервера один раз; в списке chats его нет.
  const [savedChat, setSavedChat] = useState<ChatType | null>(null);
  useEffect(() => {
    let alive = true;
    api.getSavedChat()
      .then((c) => { if (!alive) return; setSavedChat(c as any); if (savedMode) { setSelectedChatId(c.id); setSelectedKind("saved"); } })
      .catch(() => { if (savedMode) toast.error("Не удалось открыть Избранное"); });
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
  const [groupStreams, setGroupStreams] = useState<MediaStream[]>([]);
  const [groupPeers, setGroupPeers] = useState<string[]>([]);
  // Чаты нужны обработчикам звонка, а те живут вне рендера.
  const chatsRef = useRef<ChatType[]>([]);
  // Активный чат для обработчика сокета: он живёт в эффекте с deps
  // [user?.id] и иначе видел бы устаревший selectedChatId.
  const selectedChatIdRef = useRef<string | null>(null);
  selectedChatIdRef.current = selectedChatId;
  // Растёт на каждое входящее по сокету в открытом чате — ChatWindow по нему
  // перечитывает ленту сразу, а не через опрос.
  const [messagePing, setMessagePing] = useState(0);
  chatsRef.current = chats;
  const navigate = useNavigate();

  // При открытии чата помечаем его прочитанным на сервере и гасим бейдж.
  useEffect(() => {
    if (!selectedChatId) return;
    api.markChatAsRead(selectedChatId).catch(() => {});
    setChats((prev) =>
      prev.map((c) => (c.id === selectedChatId ? { ...c, unread_count: 0 } : c))
    );
  }, [selectedChatId]);

  // 🔔 Проверка аутентификации и получение профиля + инициализация уведомлений
  useEffect(() => {
    const initializeApp = async () => {
      try {
        const profile = await api.getProfile();
        setUser(profile);
        writeCache("user", profile);
        const userChats = await mergeUnread(await api.getChats());
        setChats(userChats);
        writeCache("chats", userChats);
        
        // 🔔 Инициализация push-уведомлений после успешной аутентификации
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
        const chatId = (e?.notification?.data as any)?.chat_id;
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
      await api.registerPushToken(token, Capacitor.getPlatform());
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

    return () => {
      clearInterval(intervalId);
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
          const forGroup =
            msg.signal_type === "call_peers" ||
            (group?.getCallId() && group.getCallId() === msg.data?.call_id);
          if (forGroup) group?.handleSignal(msg.signal_type, msg.data);
          else svc?.handleSignal(msg.signal_type, msg.data);
        } else if (msg?.type === "new_message" || msg?.data?.type === "new_message") {
          refreshChats();
          // Системный баннер для веб/десктопа. На мобильных — нативный пуш.
          const m = msg?.data?.message ?? msg?.message;
          const chatId = msg?.data?.chat_id ?? m?.chat;
          const senderId = m?.sender?.id;
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
            showDesktopNotification({
              title: m.sender?.username || "Новое сообщение",
              body: preview.slice(0, 150),
              tag: chatId ? String(chatId) : undefined,
              onClick: () => { if (chatId) setSelectedChatId(String(chatId)); },
            });
            // Звук: аудио-стикер сообщения или дефолтный «receive». Баннер
            // системного уведомления сам звук не проигрывает, поэтому вручную.
            try {
              const url = m.sound?.url ? mediaUrl(m.sound.url) : "/sounds/receive.mp3";
              void playSfx(url, { volume: 0.6 });
            } catch { /* без звука не критично */ }
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
          if (st === "active") voip.setSpeaker(true);
          if (st === "idle") {
            setGroupInvite(null);
            setGroupStreams([]);
            setGroupPeers([]);
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
          if (svc.getCurrentCallId() !== callId) return;
          const peerId = callPeer?.id;
          if (svc.getState() === "incoming" && peerId) svc.rejectIncomingCall(callId, peerId);
          else svc.endCall("ended", true);
        }),
        voip.on("callMuted", ({ muted: m }: any) => {
          if (svc.isMuted() !== m) svc.toggleMute();
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
  const isSavedOpen = !!selectedChatId && (selectedKind === "saved" || (selectedChat as any)?.kind === "saved");
  // «Избранное» живёт на своей вкладке — из общего списка его убираем.
  const listChats = chats.filter((c) => (c as any).kind !== "saved");
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

  const groupCallUi = groupState !== "idle" ? (
    <CallOverlay
      state={groupState === "outgoing" ? "outgoing" : groupState === "incoming" ? "incoming" : "active"}
      peer={{
        id: groupInvite?.chatId || selectedChatId || "group",
        name: groupInvite?.chatName || selectedChat?.name || "Группа",
      }}
      isGroup
      participantsCount={groupPeers.length}
      muted={muted}
      streams={groupStreams}
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

  const callUi = groupCallUi ?? (callPeer ? (
    <CallOverlay
      state={callState}
      peer={callPeer}
      muted={muted}
      streams={remoteStream ? [remoteStream] : []}
      onAccept={acceptCall}
      onReject={rejectCall}
      onHangup={hangup}
      onToggleMute={toggleMute}
      speaker={speaker}
      onToggleSpeaker={toggleSpeaker}
    />
  ) : null);

  // 🔔 Функция обновления списка чатов
  // getChats счётчик непрочитанного не отдаёт — берём его из отдельного
  // эндпоинта и подмешиваем. Открытый чат сразу считаем прочитанным.
  const mergeUnread = async (list: ChatType[]): Promise<ChatType[]> => {
    try {
      const u = await api.getUnreadCount();
      const openId = selectedChatIdRef.current;
      return list.map((c) => ({
        ...c,
        unread_count: c.id === openId ? 0 : (u.unread_by_chat?.[c.id] || 0),
      }));
    } catch {
      return list;
    }
  };

  const refreshChats = async () => {
    if (!user) return;
    try {
      const userChats = await mergeUnread(await api.getChats());
      if (JSON.stringify(userChats) !== JSON.stringify(chats)) {
        setChats(userChats);
        writeCache("chats", userChats);
      }
    } catch (error) {
      console.error('Error refreshing chats:', error);
    }
  };

  const handleLogout = async () => {
    clearSessionCache();
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

  // На телефоне два экрана вместо двух колонок: список чатов и переписка.
  // Показываем что-то одно — так же, как в привычных мессенджерах.
  if (isMobile) {
    return (
      <div className="h-screen flex flex-col bg-background">
        <UpdateBanner />
        {callUi}
        {savedMode ? (
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
                  title="Избранное"
                />
              ) : (
                <p className="flex-1 flex items-center justify-center text-sm text-muted-foreground">Загрузка…</p>
              )}
            </div>
            <BottomNav />
          </>
        ) : selectedChatId ? (
          isChannelOpen ? (
            <ChannelView
              channelId={selectedChatId}
              userId={user.id}
              onBack={() => setSelectedChatId(null)}
              onDeleted={() => { setSelectedChatId(null); refreshChats(); }}
            />
          ) : (
          <ChatWindow
            chatId={selectedChatId}
            userId={user.id}
            peer={peer}
            group={selectedChat?.is_group ? selectedChat : null}
            saved={isSavedOpen}
            chats={listChats}
            savedChatId={savedChat?.id}
            onGroupUpdated={refreshChats}
            onCall={startCall}
            messagePing={messagePing}
            onBack={() => setSelectedChatId(null)}
            title={chatHeaderTitle}
          />
          )
        ) : (
          <>
          {/* Обёртка растягивает список на всю высоту — иначе бар прилипал
              к последней строке, а под ним оставалась пустота. */}
          <div className="flex-1 min-h-0 flex">
          <ChatSidebar
            userId={user.id}
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
          <BottomNav />
          </>
        )}
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      <UpdateBanner />
      <div className="flex-1 flex min-h-0">
      {callUi}
      <ChatSidebar
        userId={user.id}
        chats={listChats}
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
        isChannelOpen ? (
          <ChannelView
            channelId={selectedChatId}
            userId={user.id}
            onDeleted={() => { setSelectedChatId(null); refreshChats(); }}
          />
        ) : (
        <ChatWindow
          chatId={selectedChatId}
          userId={user.id}
          peer={peer}
          group={selectedChat?.is_group ? selectedChat : null}
          saved={isSavedOpen}
          chats={listChats}
          savedChatId={savedChat?.id}
          onGroupUpdated={refreshChats}
          onCall={startCall}
          messagePing={messagePing}
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