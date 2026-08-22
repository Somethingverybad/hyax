import { useEffect, useRef, useState } from "react";
import { readCache, writeCache, clearSessionCache } from "@/lib/session-cache";
import BottomNav from "@/components/BottomNav";
import { useIsMobile } from "@/hooks/use-mobile";
import { useNavigate } from "react-router-dom";
import ChatSidebar from "@/components/chat/ChatSidebar";
import ChatWindow from "@/components/chat/ChatWindow";
import { api } from "@/api/client";
import { syncNotificationSounds } from "@/lib/notificationSounds";
import { WebSocketService } from "@/services/websocket";
import { OneToOneCallService, type CallState, type IncomingCall } from "@/services/call-service";
import { voip, hasCallKit, type VoipCallPayload } from "@/lib/voip";
import CallOverlay from "@/components/call/CallOverlay";
import { toast } from "sonner";
import { WS_URL, getFreshAccessToken } from "@/api/client";
import { FirebaseMessaging } from '@capacitor-firebase/messaging';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';

interface ChatType {
  id: string;
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

const Chat = () => {
  const isMobile = useIsMobile();
  const [user, setUser] = useState<ProfileType | null>(() => readCache<ProfileType>("user"));
  const [chats, setChats] = useState<ChatType[]>(() => readCache<ChatType[]>("chats") || []);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  // Имя собеседника для шапки: приходит из сайдбара, он единственный, кто его
  // вычисляет — участники грузятся отдельно от списка чатов.
  const [selectedChatTitle, setSelectedChatTitle] = useState<string>("Чат");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

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
  const callRef = useRef<OneToOneCallService | null>(null);
  const lastCallIdRef = useRef<string | null>(null);
  const navigate = useNavigate();

  // 🔔 Проверка аутентификации и получение профиля + инициализация уведомлений
  useEffect(() => {
    const initializeApp = async () => {
      try {
        const profile = await api.getProfile();
        setUser(profile);
        writeCache("user", profile);
        const userChats = await api.getChats();
        setChats(userChats);
        writeCache("chats", userChats);
        
        // 🔔 Инициализация push-уведомлений после успешной аутентификации
        if (Capacitor.isNativePlatform()) {
          await initPushNotifications(profile.id);
          // Аудио-стикеры: докачиваем caf-файлы каталога в Library/Sounds,
          // чтобы пуш мог сослаться на них по имени. Фоном, без ожидания.
          syncNotificationSounds();
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

      // Android 8+: звук уведомления живёт в канале, а не в самом пуше.
      // Канал создаётся однократно, бэкенд шлёт channel_id="messages".
      // Файл — android/app/src/main/res/raw/receive.mp3. На iOS вызов не нужен.
      if (Capacitor.getPlatform() === 'android') {
        await FirebaseMessaging.createChannel({
          id: 'messages',
          name: 'Сообщения',
          importance: 4,
          sound: 'receive',
        });
      }

      // Токен ротируется — слушаем и перерегистрируем.
      await FirebaseMessaging.addListener('tokenReceived', (e) => {
        if (e?.token) sendPushTokenToServer(e.token);
      });

      // По тапу на пуш открываем чат из data.chat_id.
      await FirebaseMessaging.addListener('notificationActionPerformed', (e) => {
        const chatId = (e?.notification?.data as any)?.chat_id;
        if (chatId) setSelectedChatId(String(chatId));
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

  // Сигналинг звонков: пользовательский WebSocket + глобальный сервис звонков.
  useEffect(() => {
    if (!user?.id) return;
    let disposed = false;

    const ws = new WebSocketService(`${WS_URL}/user/${user.id}/`, {
      maxReconnectAttempts: 20,
      onMessage: (msg: any) => {
        const svc = callRef.current;
        if (msg?.type === "notification" && msg.data?.type === "incoming_call") {
          if (hasCallKit()) return; // iOS: входящий уже показал CallKit по VoIP-пушу
          svc?.notifyIncomingCall({
            callId: msg.data.call_id,
            chatId: msg.data.chat_id,
            fromUserId: msg.data.from_user_id,
            fromUsername: msg.data.from_username,
            fromUserAvatar: msg.data.from_user_avatar,
            callType: msg.data.call_type,
          });
        } else if (msg?.type === "call_signal") {
          svc?.handleSignal(msg.signal_type, msg.data);
        } else if (msg?.type === "new_message" || msg?.data?.type === "new_message") {
          refreshChats();
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
      const svc = new OneToOneCallService({
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

      // Ответ с системного экрана CallKit (в том числе с заблокированного
      // экрана, когда приложение только что запустилось этим звонком).
      const handleAnswered = async (c: VoipCallPayload) => {
        await waitForWs();
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
      ws.disconnect();
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const selectedChat = chats.find((c) => c.id === selectedChatId);
  const peer = selectedChat?.participants?.find((p) => p.id !== user?.id) || null;

  const startCall = async () => {
    const svc = callRef.current;
    if (!svc || !peer || !selectedChatId) return;
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

  const callUi = callPeer ? (
    <CallOverlay
      state={callState}
      peer={callPeer}
      muted={muted}
      remoteStream={remoteStream}
      onAccept={acceptCall}
      onReject={rejectCall}
      onHangup={hangup}
      onToggleMute={toggleMute}
      speaker={speaker}
      onToggleSpeaker={toggleSpeaker}
    />
  ) : null;

  // 🔔 Функция обновления списка чатов
  const refreshChats = async () => {
    if (!user) return;
    
    try {
      const userChats = await api.getChats();
      
      // Обновляем состояние только если данные изменились
      if (JSON.stringify(userChats) !== JSON.stringify(chats)) {
        setChats(userChats);
        writeCache("chats", userChats);
        
        // Логируем обновление для отладки
        console.log('Chats updated:', userChats.length, 'chats');
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
        {callUi}
        {selectedChatId ? (
          <ChatWindow
            chatId={selectedChatId}
            userId={user.id}
            peer={peer}
            onCall={startCall}
            onBack={() => setSelectedChatId(null)}
            title={selectedChatTitle}
          />
        ) : (
          <>
          {/* Обёртка растягивает список на всю высоту — иначе бар прилипал
              к последней строке, а под ним оставалась пустота. */}
          <div className="flex-1 min-h-0 flex">
          <ChatSidebar
            userId={user.id}
            chats={chats}
            onSelectChat={(id, title) => {
              setSelectedChatId(id);
              if (title) setSelectedChatTitle(title);
            }}
            onRefresh={refreshChats}
            selectedChatId={selectedChatId}
            onLogout={handleLogout}
            isCollapsed={false}
            onToggleCollapse={toggleSidebar}
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
    <div className="h-screen flex bg-background">
      {callUi}
      <ChatSidebar
        userId={user.id}
        chats={chats}
        onSelectChat={setSelectedChatId}
        selectedChatId={selectedChatId}
        onLogout={handleLogout}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={toggleSidebar}
        onChatDeleted={handleChatDeleted}
        onChatCreated={handleChatCreated}
      />
      
      {/* Показываем ChatWindow только когда сайдбар свернут И выбран чат */}
      {isSidebarCollapsed && selectedChatId && (
        <ChatWindow
          chatId={selectedChatId}
          userId={user.id}
          peer={peer}
          onCall={startCall}
        />
      )}
      
      {/* Сообщение когда сайдбар развернут */}
      {!isSidebarCollapsed}
      
      {/* Сообщение когда сайдбар свернут но чат не выбран */}
      {isSidebarCollapsed && !selectedChatId && (
        <div className="flex-1 flex items-center justify-center bg-gradient-to-br from-background to-primary/5">
          <div className="text-center p-8">
            <div className="w-24 h-24 bg-gradient-primary rounded-3xl mx-auto mb-6 flex items-center justify-center shadow-glow">
              <span className="text-4xl font-black text-primary-foreground">Х</span>
            </div>
            <h2 className="text-2xl font-bold text-foreground mb-4">
              Выберите чат
            </h2>
            <p className="text-muted-foreground max-w-md">
              Нажмите на иконку меню в свернутом сайдбаре чтобы развернуть список чатов и выбрать чат для общения.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default Chat;