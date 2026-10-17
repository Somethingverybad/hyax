import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/api/client";
import { readCache } from "@/lib/session-cache";
import { t as tr } from "@/lib/i18n";
import { onUserMessage, onUserSocketChange } from "@/lib/userSocket";
import { setCallStarter, type StartCallOptions } from "@/lib/calls";
import type { WebSocketService } from "@/services/websocket";
import { OneToOneCallService, type CallMedia, type CallState, type IncomingCall } from "@/services/call-service";
import { GroupCallService, type GroupCallInvite, type GroupCallState, type GroupMedia, type PeerStream } from "@/services/group-call-service";
import { NativeCallService, NativeGroupCallService } from "@/services/native-call-service";
import { hasNativeCalls, nativeCall, type AudioLevels, type PeerRect, type VideoRect } from "@/lib/nativeCall";
import { voip, hasCallKit, type VoipCallPayload } from "@/lib/voip";
import CallOverlay, { type CallParticipant } from "@/components/call/CallOverlay";
import type { StageTile } from "@/components/call/GroupStage";
import AddToCall, { type CallCandidate } from "@/components/call/AddToCall";
import { ObsRelay, obsLink, type ObsSource } from "@/lib/obsRelay";
import { getMicSettings, onMicSettings, setMicSettings, MIC_TRACK_EVENT } from "@/lib/micSettings";

/** Чат из кеша списка (session-cache «chats») — ровно то, что нужно звонку. */
type CachedChat = {
  id: string;
  name?: string;
  is_group?: boolean;
  kind?: string;
  participants?: { id: string; username: string; avatar_url?: string | null; is_bot?: boolean }[];
};
const cachedChats = () => readCache<CachedChat[]>("chats") || [];

/** Серверы связи: свежие с сервера, а если сеть молчит (приложение запустил
 *  VoIP-пуш, в фоне запросы стоят) — последние сохранённые через 3 с, чтобы
 *  ответ из CallKit не ждал их бесконечно. */
const ICE_KEY = "hyax:ice-servers";
function iceServersFast(): Promise<RTCIceServer[]> {
  const fresh = api.getIceServers().then((list) => {
    try { localStorage.setItem(ICE_KEY, JSON.stringify(list)); } catch { /* приватный режим */ }
    return list;
  });
  let cached: RTCIceServer[] | null = null;
  try { cached = JSON.parse(localStorage.getItem(ICE_KEY) || "null"); } catch { cached = null; }
  // Без сохранённых и без сети — пустой список: соединение пойдёт напрямую.
  if (!cached?.length) return fresh.catch(() => []);
  return Promise.race([fresh.catch(() => cached!), new Promise<RTCIceServer[]>((r) => setTimeout(() => r(cached!), 3000))]);
}

/**
 * Звонки на всё приложение: сервисы личного и группового звонка, CallKit,
 * экран звонка и его свёрнутый вид — виджет, как у мини-плеера.
 *
 * Раньше всё это жило в экране чатов (pages/Chat.tsx) вместе с сокетом, и
 * уход в настройки, музыку или на любую вкладку обрывал разговор. Теперь
 * хост стоит над экранами (App.tsx, рядом с MiniPlayer), сокет общий
 * (lib/userSocket), а звонок начинают через lib/calls.startCall.
 */
/** Где нативному движку рисовать видео (рамки с экрана звонка). */
const nativeVideoLayout = (remotes: PeerRect[], local: VideoRect | null) =>
  void nativeCall.setVideoLayout(remotes, local).catch(() => {});
const NO_LEVELS: AudioLevels = { peers: {}, local: 0 };

const CallHost = () => {
  const navigate = useNavigate();
  const [callState, setCallState] = useState<CallState>("idle");
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [callPeer, setCallPeer] = useState<{ id: string; name: string; avatarUrl?: string | null } | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [muted, setMuted] = useState(false);
  // Громкая связь по умолчанию: телефон обычно лежит на столе, а не у уха.
  const [speaker, setSpeaker] = useState(true);
  // Свёрнут: вместо экрана звонка — виджет, можно ходить по приложению.
  const [minimized, setMinimized] = useState(false);
  // Чат текущего звонка: для «добавить участника» и заголовка группового.
  const [callChat, setCallChat] = useState<{ id: string; name?: string } | null>(null);
  const callRef = useRef<OneToOneCallService | NativeCallService | null>(null);
  const lastCallIdRef = useRef<string | null>(null);
  // Групповой звонок ведёт отдельный сервис: mesh из нескольких соединений.
  const groupCallRef = useRef<GroupCallService | NativeGroupCallService | null>(null);
  const [groupState, setGroupState] = useState<GroupCallState>("idle");
  const [groupInvite, setGroupInvite] = useState<GroupCallInvite | null>(null);
  const [groupStreams, setGroupStreams] = useState<PeerStream[]>([]);
  const [groupPeers, setGroupPeers] = useState<string[]>([]);
  const [groupMedia, setGroupMedia] = useState<GroupMedia | null>(null);
  const groupCallIdRef = useRef<string | null>(null);
  // Громкость каждого участника у меня (1 — как есть); сбрасывается с концом звонка.
  const [peerVolumes, setPeerVolumes] = useState<Record<string, number>>({});
  // Имена и аватары участников, которых нет в моих чатах.
  const [peopleInfo, setPeopleInfo] = useState<Record<string, { name: string; avatarUrl?: string | null }>>({});
  const [addToCallOpen, setAddToCallOpen] = useState(false);
  const wsRef = useRef<WebSocketService | null>(null);
  const userIdRef = useRef<string | null>(null);
  // Видео и шумодав личного звонка (пока — веб и компьютер: в приложениях
  // звонок ведёт нативный движок без видео).
  const [media, setMedia] = useState<CallMedia | null>(null);
  // Камеру включили, пока звонок звонил, а ответил собеседник без видео —
  // сервис её выключил; говорим почему.
  const camWasOn = useRef(false);
  useEffect(() => {
    if (camWasOn.current && media && !media.localOn && media.peerKnown && !media.peerCanVideo) {
      toast(tr("У собеседника версия без видеозвонков — видео появится, когда он обновит приложение"));
    }
    camWasOn.current = !!media?.localOn;
  }, [media]);
  const [videoBusy, setVideoBusy] = useState(false);
  // Шумодав — общая настройка микрофона (Настройки → Микрофон).
  const [noiseOn, setNoiseOn] = useState(() => getMicSettings().noiseSuppression);
  useEffect(() => onMicSettings((m) => setNoiseOn(m.noiseSuppression)), []);
  // Трансляция в OBS (браузер и компьютер): звук звонка — странице в OBS.
  const obsRef = useRef<ObsRelay | null>(null);
  const iceRef = useRef<RTCIceServer[]>([]);
  const obsSourcesRef = useRef<() => ObsSource[]>(() => []);
  const [obsOn, setObsOn] = useState(false);
  const [obsPages, setObsPages] = useState(0);

  /** Открыть чат звонка на экране чатов (после ответа — как раньше). */
  const openChat = (chatId?: string | null, title?: string | null) => {
    if (chatId) navigate("/chat", { state: { chatId, title: title || undefined } });
  };
  const openChatRef = useRef(openChat);
  openChatRef.current = openChat;

  // Звонок кончился — следующий начнётся развёрнутым.
  useEffect(() => {
    if (callState === "idle" && groupState === "idle") {
      setMinimized(false); setCallChat(null);
      // Трансляция — на звонок: следующий начнётся без неё.
      if (obsRef.current?.active) { obsRef.current.stop(); setObsOn(false); }
    }
  }, [callState, groupState]);

  // Сервисы — на каждый сокет (вход, смена пользователя); выход — закрываем
  // вместе со звонком. Сеанс — сервисы и слушатели CallKit одного сокета.
  const sessionRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    const off = onUserSocketChange((ws, userId) => {
      if (ws === wsRef.current && userId === userIdRef.current) return;
      sessionRef.current?.();
      sessionRef.current = null;
      wsRef.current = ws;
      userIdRef.current = userId;
      if (ws && userId) sessionRef.current = startSession(ws, userId);
    });
    return () => { off(); sessionRef.current?.(); sessionRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startSession(ws: WebSocketService, userId: string): () => void {
    let disposed = false;
    const listeners: Array<Promise<{ remove: () => Promise<void> } | null>> = [];
    const waitForWs = async () => {
      for (let i = 0; i < 50 && !ws.isConnected(); i++) await new Promise((r) => setTimeout(r, 100));
    };
    // Сервисы готовы — обработчики CallKit ждут этого. Подписываемся на
    // события сразу, а не после запроса серверов связи: приложение мог
    // запустить VoIP-пуш, сеть в фоне стоит, и ответ из CallKit приходил,
    // когда подписки ещё не было (баг-репорт 17c48d63).
    // Трансляция в OBS — только браузер и компьютер: в приложениях звук
    // звонка у нативного движка, переслать его странице нельзя.
    if (!hasNativeCalls()) {
      obsRef.current = new ObsRelay(
        (data) => ws.send({ type: "obs_signal", data }),
        () => obsSourcesRef.current(),
        () => iceRef.current,
        setObsPages,
      );
    }
    let markReady!: () => void;
    const ready = new Promise<void>((r) => { markReady = r; });
    const svcReady = async () => { await ready; return disposed ? null : callRef.current; };

    // Ответ с системного экрана CallKit (в том числе с заблокированного
    // экрана, когда приложение только что запустилось этим звонком).
    const handleAnswered = async (c: VoipCallPayload) => {
      const svc = await svcReady();
      if (!svc) return;
      await waitForWs();
      const chat = cachedChats().find((x) => x.id === c.chatId);
      if (c.group || chat?.is_group) {
        const group = groupCallRef.current;
        group?.notifyIncoming({
          callId: c.callId,
          chatId: c.chatId,
          fromUserId: c.fromUserId,
          fromUsername: c.fromUsername,
          chatName: c.chatName || chat?.name || tr("Группа"),
        });
        await group?.accept();
        openChatRef.current(c.chatId, c.chatName || chat?.name);
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
      openChatRef.current(c.chatId, c.fromUsername);
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
      voip.on("callAnswered", (c: any) => { void handleAnswered(c); }),
      // Android: звонок пришёл пушем (приложение на экране или открыто
      // из уведомления поверх блокировки) — показываем свой экран входящего.
      voip.on("callIncoming", async (c: any) => {
        const svc = await svcReady();
        if (svc && svc.getState() === "idle") svc.notifyIncomingCall(toIncoming(c));
      }),
      voip.on("callEnded", async ({ callId }: any) => {
        const svc = await svcReady();
        const group = groupCallRef.current;
        if (group && group.getCallId() === callId) {
          if (group.getState() === "incoming") group.reject(); else group.leave();
          return;
        }
        if (!svc || svc.getCurrentCallId() !== callId) return;
        // Собеседник — из сервиса: в старом коде брался из устаревшего
        // замыкания и был всегда null, отклонение с CallKit не доходило.
        const peerId = svc.getPeerId();
        if (svc.getState() === "incoming" && peerId) svc.rejectIncomingCall(callId, peerId);
        else svc.endCall("ended", true);
      }),
      voip.on("callMuted", async ({ muted: m }: any) => {
        const svc = await svcReady();
        const group = groupCallRef.current;
        if (group && group.getState() !== "idle") {
          if (group.isMuted() !== m) group.toggleMute();
        } else if (svc && svc.isMuted() !== m) svc.toggleMute();
        setMuted(m);
      }),
    );

    (async () => {
      const iceServers = await iceServersFast();
      iceRef.current = iceServers;
      if (disposed || wsRef.current !== ws) return;
      // В приложении разговор ведёт нативный движок: в WebView звук не
      // уживался с CallKit и умирал при блокировке экрана.
      const CallImpl = hasNativeCalls() ? NativeCallService : OneToOneCallService;
      const svc = new CallImpl({
        wsService: ws,
        chatId: "",
        userId,
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
          setCallChat({ id: c.chatId });
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
        onMedia: setMedia,
      } as ConstructorParameters<typeof OneToOneCallService>[0]);
      callRef.current = svc;
      setMedia(svc.getMedia());

      const GroupImpl = hasNativeCalls() ? NativeGroupCallService : GroupCallService;
      groupCallRef.current = new GroupImpl({
        wsService: ws,
        userId,
        iceServers,
        onStateChange: (st) => {
          setGroupState(st);
          const gid = groupCallRef.current?.getCallId();
          if (st !== "idle" && gid) groupCallIdRef.current = gid;
          // Камеру можно включить, ещё пока звонок звонит.
          if (st !== "idle" && groupCallRef.current) setGroupMedia(groupCallRef.current.getMedia());
          if (st === "active") voip.setSpeaker(true);
          if (st === "idle") {
            // Звонок, который начинался личным, CallKit знает по тому же id.
            if (groupCallIdRef.current) voip.endCall(groupCallIdRef.current);
            groupCallIdRef.current = null;
            setGroupInvite(null);
            setGroupStreams([]);
            setGroupPeers([]);
            setGroupMedia(null);
            setPeerVolumes({});
            setMuted(false);
            setAddToCallOpen(false);
          }
        },
        onIncoming: (invite) => { setGroupInvite(invite); setCallChat({ id: invite.chatId, name: invite.chatName }); },
        onStreams: setGroupStreams,
        onPeers: setGroupPeers,
        onMedia: setGroupMedia,
        onError: (m) => toast.error(m),
      });

      markReady();
      await voip.register();
      const pending = await voip.getPendingAnswer();
      if (pending && !disposed) {
        if (pending.answered) void handleAnswered(pending.call);
        else svc.notifyIncomingCall(toIncoming(pending.call));
      }
    })();

    return () => {
      disposed = true;
      obsRef.current?.stop(); obsRef.current = null; setObsOn(false);
      listeners.forEach((l) => l?.then((h) => h?.remove()));
      callRef.current?.dispose(); callRef.current = null;
      groupCallRef.current?.dispose(); groupCallRef.current = null;
    };
  }

  // Сигналы звонков из общего сокета.
  useEffect(() => onUserMessage((msg: any) => {
    if (msg?.type === "obs_signal") { obsRef.current?.handle(msg.data); return; }
    const svc = callRef.current;
    if (msg?.type === "notification" && msg.data?.type === "incoming_call") {
      if (msg.data.group === "1" || msg.data.group === true) {
        groupCallRef.current?.notifyIncoming({
          callId: msg.data.call_id,
          chatId: msg.data.chat_id,
          fromUserId: msg.data.from_user_id,
          fromUsername: msg.data.from_username,
          chatName: msg.data.chat_name || tr("Группа"),
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
    } else if (msg?.type === "call_signal" && msg.signal_type === "call_handled_elsewhere") {
      // Звонок приняли или отклонили на другом моём устройстве — здесь молча
      // перестаём звонить (ничего не отправляя: иначе отбой ушёл бы и туда).
      const id = msg.data?.call_id;
      if (svc && id && svc.getCurrentCallId() === id && svc.getState() === "incoming") {
        svc.endCall("ended", false);
        setIncomingCall(null);
      }
      const group = groupCallRef.current;
      if (group && id && group.getCallId() === id && group.getState() === "incoming") group.dismissIncoming();
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
    }
  }), []);

  // Тихий пуш «отбой» (pages/Chat.tsx, Firebase): звонящий отменил вызов,
  // пока сокет молчал.
  useEffect(() => {
    const on = (e: Event) => {
      const callId = String((e as CustomEvent<{ callId?: string }>).detail?.callId || "");
      if (!callId) return;
      voip.endCall(callId);
      const svc = callRef.current;
      if (svc && svc.getCurrentCallId() === callId) svc.endCall("ended", false);
      const group = groupCallRef.current;
      if (group && group.getCallId() === callId && group.getState() === "incoming") group.reject();
    };
    window.addEventListener("hyax:call-ended-push", on);
    return () => window.removeEventListener("hyax:call-ended-push", on);
  }, []);

  // Начать звонок с экрана чата (lib/calls.startCall).
  useEffect(() => {
    setCallStarter(async (o: StartCallOptions) => {
      if (o.isGroup) {
        setCallChat({ id: o.chatId, name: o.chatName });
        await groupCallRef.current?.start(o.chatId);
        return;
      }
      const svc = callRef.current;
      if (!svc || !o.peer) return;
      if (svc.getState() !== "idle") return;
      svc.updateChatId(o.chatId);
      setCallChat({ id: o.chatId, name: o.chatName });
      setCallPeer(o.peer);
      await svc.startOutgoingCall(o.peer.id);
      const id = svc.getCurrentCallId();
      if (id) voip.reportOutgoingCall(id, o.peer.name);
      else setCallPeer(null);
    });
    return () => setCallStarter(null);
  }, []);

  const acceptCall = async () => {
    const svc = callRef.current;
    if (!svc || !incomingCall) return;
    await svc.acceptIncomingCall(incomingCall.callId, incomingCall.fromUserId);
    openChat(incomingCall.chatId, incomingCall.fromUsername);
    setIncomingCall(null);
  };
  const rejectCall = () => {
    const svc = callRef.current;
    if (!svc || !incomingCall) return;
    svc.rejectIncomingCall(incomingCall.callId, incomingCall.fromUserId);
    setIncomingCall(null);
  };
  const hangup = () => callRef.current?.endCall("ended", true);

  const webSvc = () => (callRef.current instanceof OneToOneCallService ? callRef.current : null);
  /** Видео — и в браузере, и в приложении (там камеру ведёт нативный движок). */
  const videoSvc = () => webSvc() || (callRef.current instanceof NativeCallService ? callRef.current : null);
  /** Камера: нет разрешения — подсказка, где его дать; следующее нажатие
   *  запрашивает снова (браузер или система спросят, если не запрещено навсегда).
   *  group — камера группового звонка. */
  const toggleVideo = async (group = false) => {
    const svc = group ? groupCallRef.current : videoSvc();
    if (!svc || videoBusy) return;
    setVideoBusy(true);
    try {
      await svc.setVideo(!svc.getMedia().localOn);
    } catch (e) {
      const name = (e as { name?: string })?.name || "";
      if (name === "NotAllowedError" && hasNativeCalls()) {
        // Отказ в приложении система второй раз не спрашивает — ведём в настройки.
        toast.error(tr("Нет доступа к камере. Разрешите его в настройках телефона"), {
          action: { label: tr("Настройки"), onClick: () => void nativeCall.openSettings().catch(() => {}) },
        });
      } else {
        toast.error(name === "NotAllowedError" || name === "SecurityError"
          ? tr("Нет доступа к камере. Разрешите его в настройках браузера или системы и нажмите ещё раз")
          : name === "NotFoundError" ? tr("Камера не найдена") : tr("Не удалось включить камеру"));
      }
    } finally { setVideoBusy(false); }
  };
  const flipCamera = async (group = false) => {
    try { await (group ? groupCallRef.current : videoSvc())?.flipCamera(); } catch { toast.error(tr("Не удалось переключить камеру")); }
  };
  /** Кто говорит в групповом звонке (подсветка и режим «Говорящий»). */
  const getGroupLevels = useCallback(
    () => groupCallRef.current?.getAudioLevels().catch(() => NO_LEVELS) ?? Promise.resolve(NO_LEVELS),
    [],
  );
  const toggleNoise = async () => {
    const svc = webSvc();
    // Личный звонок ждёт, пока микрофон переоткроется, — чтобы сказать об ошибке.
    try { if (svc && callState !== "idle") await svc.setNoiseSuppression(!noiseOn); else setMicSettings({ noiseSuppression: !noiseOn }); }
    catch { toast.error(tr("Не удалось переключить шумоподавление")); }
  };

  // ── Трансляция в OBS ──
  const groupWeb = () => (groupCallRef.current instanceof GroupCallService ? groupCallRef.current : null);
  const toggleObs = () => {
    const r = obsRef.current;
    if (!r) return;
    if (r.active) { r.stop(); setObsOn(false); }
    else { r.start(); setObsOn(true); }
  };
  const copyObsLink = async (peerId?: string | null, renew = false) => {
    try {
      const link = obsLink(await api.obsKey(renew), peerId);
      await navigator.clipboard.writeText(link);
      toast.success(renew ? tr("Новая ссылка скопирована — прежние больше не работают") : tr("Ссылка для OBS скопирована"));
    } catch (e) {
      toast.error((e as Error)?.message || tr("Не удалось скопировать ссылку"));
    }
  };
  // Участники видят пометку: флаг уходит им сигналом webrtc_media.
  useEffect(() => {
    webSvc()?.setBroadcasting(obsOn && callState !== "idle");
    groupWeb()?.setBroadcasting(obsOn && groupState !== "idle");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obsOn, callState, groupState]);
  // Состав и дорожки поменялись — странице OBS тоже.
  useEffect(() => { obsRef.current?.sync(); }, [groupStreams, groupPeers, remoteStream, callState, groupState, peopleInfo, obsOn]);
  useEffect(() => {
    const h = () => obsRef.current?.sync();
    window.addEventListener(MIC_TRACK_EVENT, h);
    remoteStream?.addEventListener("addtrack", h);
    return () => { window.removeEventListener(MIC_TRACK_EVENT, h); remoteStream?.removeEventListener("addtrack", h); };
  }, [remoteStream]);
  const toggleMute = () => setMuted(!!callRef.current?.toggleMute());
  const toggleSpeaker = () => {
    const next = !speaker;
    setSpeaker(next);
    voip.setSpeaker(next);
  };

  /** Кто это: из участников чатов, иначе из кеша, иначе подтянем с сервера. */
  const personInfo = (id: string): { name: string; avatarUrl?: string | null } => {
    for (const c of cachedChats()) {
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
   *  чего личный звонок станет групповым сам (см. call_peers). */
  const addToCall = (ids: string[]) => {
    setAddToCallOpen(false);
    const group = groupCallRef.current;
    const svc = callRef.current;
    if (group && group.getState() !== "idle") { group.addParticipants(ids); return; }
    const callId = svc?.getCurrentCallId();
    if (callId && wsRef.current) {
      wsRef.current.send({ type: "call_add", data: { chat_id: callChat?.id, call_id: callId, user_ids: ids } });
    }
  };

  // Кого можно позвать: участники чата звонка и люди из личных переписок,
  // кроме себя и тех, кто уже в звонке.
  const me = readCache<{ id?: string }>("user")?.id || "";
  const callCandidates: CallCandidate[] = (() => {
    if (!addToCallOpen) return [];
    const inCall = new Set<string>([me, ...groupPeers, callPeer?.id || ""]);
    const map = new Map<string, CallCandidate>();
    const add = (p?: { id: string; username: string; avatar_url?: string | null; is_bot?: boolean } | null) => {
      if (!p || inCall.has(p.id) || p.is_bot) return;
      if (!map.has(p.id)) map.set(p.id, { id: p.id, name: p.username, avatarUrl: p.avatar_url });
    };
    const chats = cachedChats();
    chats.find((c) => c.id === callChat?.id)?.participants?.forEach((p) => add(p));
    chats.filter((c) => !c.is_group && !["saved", "ideabox", "channel", "secret", "system"].includes(c.kind || "direct"))
      .forEach((c) => c.participants?.forEach((p) => add(p)));
    return [...map.values()];
  })();

  const groupParticipants: CallParticipant[] = groupPeers.map((id) => {
    const info = personInfo(id);
    const st = groupStreams.find((x) => x.peerId === id);
    return { id, name: info.name, avatarUrl: info.avatarUrl, stream: st?.stream || null, connected: !!st || hasNativeCalls() };
  });
  // Плитки группового звонка: участники и я (последним).
  const myInfo = readCache<{ id?: string; username?: string; avatar_url?: string | null }>("user");
  const groupTiles: StageTile[] = [
    ...groupParticipants.map((p) => {
      const m = groupMedia?.peers[p.id];
      return {
        id: p.id, name: p.name, avatarUrl: p.avatarUrl,
        stream: p.stream, video: !!m?.video, muted: !!m?.muted,
        connecting: !(m?.connected || p.stream),
      };
    }),
    {
      id: myInfo?.id || "me", name: myInfo?.username || tr("Вы"), avatarUrl: myInfo?.avatar_url, self: true,
      stream: groupMedia?.localVideo || null, video: !!groupMedia?.localOn, mirrored: groupMedia?.front ?? true, muted,
    },
  ];

  // Что слышит страница OBS: каждый участник своей дорожкой и мой микрофон.
  obsSourcesRef.current = () => {
    const me = { id: myInfo?.id || "me", name: myInfo?.username || tr("Вы"), avatarUrl: myInfo?.avatar_url, self: true };
    if (groupState !== "idle") {
      return [
        ...groupParticipants.map((p) => ({ id: p.id, name: p.name, avatarUrl: p.avatarUrl, track: p.stream?.getAudioTracks()[0] ?? null })),
        { ...me, track: groupWeb()?.getLocalStream()?.getAudioTracks()[0] ?? null },
      ];
    }
    if (callState !== "idle" && callPeer) {
      return [
        { id: callPeer.id, name: callPeer.name, avatarUrl: callPeer.avatarUrl, track: remoteStream?.getAudioTracks()[0] ?? null },
        { ...me, track: webSvc()?.getLocalStream()?.getAudioTracks()[0] ?? null },
      ];
    }
    return [];
  };
  // Кто транслирует звонок: все участники видят пометку.
  const broadcasters = groupState !== "idle"
    ? groupParticipants.filter((p) => groupMedia?.peers[p.id]?.obs).map((p) => p.name)
    : callPeer && media?.peerObs ? [callPeer.name] : [];
  const broadcastText = obsOn
    ? tr("Вы транслируете звонок в OBS")
    : broadcasters.length ? tr("{name} транслирует звонок", { name: broadcasters.join(", ") }) : null;
  const shownBroadcasters = useRef("");
  useEffect(() => {
    const key = broadcasters.join(", ");
    if (key && key !== shownBroadcasters.current) toast(tr("{name} транслирует звонок", { name: key }));
    shownBroadcasters.current = key;
  });
  const obsPeople = obsSourcesRef.current().map((x) => ({ id: x.id, name: x.self ? tr("Я") : x.name }));
  const obs = obsRef.current && (callState !== "idle" || groupState !== "idle") ? {
    on: obsOn,
    pages: obsPages,
    onToggle: toggleObs,
    onCopy: (peerId?: string | null) => void copyObsLink(peerId),
    onRenew: () => void copyObsLink(null, true),
    people: obsPeople,
  } : undefined;
  const noise = !hasNativeCalls() ? { on: noiseOn, onToggle: () => void toggleNoise() } : undefined;

  const common = {
    muted,
    broadcast: broadcastText,
    obs,
    noise,
    volumes: peerVolumes,
    onVolume: setPeerVolume,
    onAdd: () => setAddToCallOpen(true),
    speaker,
    onToggleSpeaker: toggleSpeaker,
    minimized,
    onMinimize: () => setMinimized(true),
    onExpand: () => setMinimized(false),
  };

  return (
    <>
      {groupState !== "idle" ? (
        <CallOverlay
          {...common}
          state={groupState === "outgoing" ? "outgoing" : groupState === "incoming" ? "incoming" : "active"}
          peer={{
            id: groupInvite?.chatId || callChat?.id || "group",
            name: groupInvite?.chatName || (groupPeers.length <= 1 && groupPeers[0] ? personInfo(groupPeers[0]).name : callChat?.name || tr("Групповой звонок")),
          }}
          isGroup
          participants={groupParticipants}
          stage={{
            tiles: groupTiles,
            getLevels: getGroupLevels,
            nativeLayout: groupMedia?.native ? nativeVideoLayout : undefined,
          }}
          video={groupMedia && groupState !== "incoming" ? {
            local: groupMedia.localVideo,
            remote: null,
            localOn: groupMedia.localOn,
            remoteOn: false,
            available: true,
            known: false,
            busy: videoBusy,
            canFlip: groupMedia.canFlip,
            mirrored: groupMedia.front,
            onToggle: () => void toggleVideo(true),
            onFlip: () => void flipCamera(true),
          } : undefined}
          onAccept={async () => {
            await groupCallRef.current?.accept();
            openChat(groupInvite?.chatId, groupInvite?.chatName);
          }}
          onReject={() => groupCallRef.current?.reject()}
          onHangup={() => groupCallRef.current?.leave()}
          onToggleMute={() => setMuted(!!groupCallRef.current?.toggleMute())}
        />
      ) : callPeer ? (
        <CallOverlay
          {...common}
          state={callState}
          peer={callPeer}
          participants={[{ id: callPeer.id, name: callPeer.name, avatarUrl: callPeer.avatarUrl, stream: remoteStream, connected: callState === "active" }]}
          video={videoSvc() && media && callState !== "incoming" ? {
            local: media.localVideo,
            remote: media.remoteVideo ? remoteStream : null,
            localOn: media.localOn,
            remoteOn: media.remoteVideo && (media.native || !!remoteStream),
            nativeLayout: media.native ? nativeVideoLayout : undefined,
            available: media.peerCanVideo,
            known: media.peerKnown,
            busy: videoBusy,
            canFlip: media.canFlip,
            mirrored: media.front,
            onToggle: () => void toggleVideo(),
            onFlip: () => void flipCamera(),
          } : undefined}
          onAccept={acceptCall}
          onReject={rejectCall}
          onHangup={hangup}
          onToggleMute={toggleMute}
        />
      ) : null}
      {addToCallOpen && <AddToCall candidates={callCandidates} onClose={() => setAddToCallOpen(false)} onConfirm={addToCall} />}
    </>
  );
};

export default CallHost;
