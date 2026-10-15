import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/api/client";
import { readCache } from "@/lib/session-cache";
import { t as tr } from "@/lib/i18n";
import { onUserMessage, onUserSocketChange } from "@/lib/userSocket";
import { setCallStarter, type StartCallOptions } from "@/lib/calls";
import type { WebSocketService } from "@/services/websocket";
import { OneToOneCallService, type CallMedia, type CallState, type IncomingCall } from "@/services/call-service";
import { GroupCallService, type GroupCallInvite, type GroupCallState, type PeerStream } from "@/services/group-call-service";
import { NativeCallService, NativeGroupCallService } from "@/services/native-call-service";
import { hasNativeCalls } from "@/lib/nativeCall";
import { voip, hasCallKit, type VoipCallPayload } from "@/lib/voip";
import CallOverlay, { type CallParticipant } from "@/components/call/CallOverlay";
import AddToCall, { type CallCandidate } from "@/components/call/AddToCall";

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
  const [videoBusy, setVideoBusy] = useState(false);

  /** Открыть чат звонка на экране чатов (после ответа — как раньше). */
  const openChat = (chatId?: string | null, title?: string | null) => {
    if (chatId) navigate("/chat", { state: { chatId, title: title || undefined } });
  };
  const openChatRef = useRef(openChat);
  openChatRef.current = openChat;

  // Звонок кончился — следующий начнётся развёрнутым.
  useEffect(() => {
    if (callState === "idle" && groupState === "idle") { setMinimized(false); setCallChat(null); }
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
      if (svc instanceof OneToOneCallService) setMedia(svc.getMedia());

      const GroupImpl = hasNativeCalls() ? NativeGroupCallService : GroupCallService;
      groupCallRef.current = new GroupImpl({
        wsService: ws,
        userId,
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
        onIncoming: (invite) => { setGroupInvite(invite); setCallChat({ id: invite.chatId, name: invite.chatName }); },
        onStreams: setGroupStreams,
        onPeers: setGroupPeers,
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
      listeners.forEach((l) => l?.then((h) => h?.remove()));
      callRef.current?.dispose(); callRef.current = null;
      groupCallRef.current?.dispose(); groupCallRef.current = null;
    };
  }

  // Сигналы звонков из общего сокета.
  useEffect(() => onUserMessage((msg: any) => {
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
  /** Камера: нет разрешения — подсказка, где его дать; следующее нажатие
   *  запрашивает снова (браузер спросит, если не запрещено навсегда). */
  const toggleVideo = async () => {
    const svc = webSvc();
    if (!svc || videoBusy) return;
    setVideoBusy(true);
    try {
      await svc.setVideo(!svc.getMedia().localVideo);
    } catch (e) {
      const name = (e as { name?: string })?.name || "";
      toast.error(name === "NotAllowedError" || name === "SecurityError"
        ? tr("Нет доступа к камере. Разрешите его в настройках браузера или системы и нажмите ещё раз")
        : name === "NotFoundError" ? tr("Камера не найдена") : tr("Не удалось включить камеру"));
    } finally { setVideoBusy(false); }
  };
  const flipCamera = async () => {
    try { await webSvc()?.flipCamera(); } catch { toast.error(tr("Не удалось переключить камеру")); }
  };
  const toggleNoise = async () => {
    const svc = webSvc();
    if (!svc) return;
    try { await svc.setNoiseSuppression(!svc.getMedia().noiseSuppression); }
    catch { toast.error(tr("Не удалось переключить шумоподавление")); }
  };
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

  const common = {
    muted,
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
          video={webSvc() && media && callState !== "incoming" ? {
            local: media.localVideo,
            remote: media.remoteVideo ? remoteStream : null,
            available: media.peerCanVideo,
            busy: videoBusy,
            canFlip: media.canFlip,
            mirrored: media.front,
            onToggle: () => void toggleVideo(),
            onFlip: () => void flipCamera(),
          } : undefined}
          noise={webSvc() && media ? { on: media.noiseSuppression, onToggle: () => void toggleNoise() } : undefined}
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
