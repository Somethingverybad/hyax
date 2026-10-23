import { App } from "@capacitor/app";
import { WebSocketService } from "@/services/websocket";
import { WS_URL, getFreshAccessToken } from "@/api/client";
import { applog } from "@/lib/applog";

/**
 * Один пользовательский WebSocket на всё приложение (/ws/user/<id>/).
 *
 * Раньше его создавал экран чатов и закрывал при уходе с него: звонок, который
 * идёт по этому сокету, обрывался на «Настройках», «Музыке», любой вкладке.
 * Теперь сокет живёт сам по себе — экран чатов только подписывается на
 * события (onUserMessage), звонки (components/call/CallHost) — тоже.
 * Закрывается при выходе из аккаунта (событие hyax:session-cleared).
 *
 * «В сети» у собеседников — пока приложение на экране: это сокет сообщает
 * сам, на любом экране (раньше — только экран чатов).
 */
type Handler = (msg: any) => void;

let ws: WebSocketService | null = null;
let uid: string | null = null;
let appState: Promise<{ remove: () => Promise<void> }> | null = null;
const handlers = new Set<Handler>();
const watchers = new Set<(s: WebSocketService | null, userId: string | null) => void>();

const visible = () => typeof document === "undefined" || document.visibilityState === "visible";
const notify = () => watchers.forEach((w) => { try { w(ws, uid); } catch { /* подписчик упал — остальным всё равно сообщаем */ } });

export const userSocket = () => ws;
export const userSocketId = () => uid;

/** Подключиться за этого пользователя (повторный вызов с тем же id — ничего не делает). */
export function startUserSocket(userId: string): WebSocketService {
  if (ws && uid === userId) return ws;
  stopUserSocket();
  uid = userId;
  const sock = new WebSocketService(`${WS_URL}/user/${userId}/`, {
    maxReconnectAttempts: 20,
    // Сервер считает новое соединение «на экране»; если переподключились
    // в фоне — сразу поправляем, чтобы у собеседников не горело «в сети».
    onOpen: () => {
      sock.send({ type: "active", active: visible(), device: deviceIdNow() });
      // Пока сокета не было, события могли пропасть — экраны перечитывают
      // список чатов и открытую переписку (Chat.tsx, ChatWindow).
      window.dispatchEvent(new CustomEvent("hyax:socket-open"));
    },
    onMessage: (msg: any) => {
      // Сеанс завершили из «Устройств» на другом устройстве — выходим на
      // любом экране, а не только когда открыт список чатов.
      if (msg?.data?.type === "session_revoked") {
        void import("@/lib/secret").then(({ deviceId }) => {
          const me = deviceId();
          const d = msg.data as { device_id?: string; all_except?: string };
          if (d.device_id === me || ("all_except" in d && d.all_except !== me)) {
            void import("@/lib/forceLogout").then((m) => m.forceLogout("revoked"));
          }
        });
      }
      handlers.forEach((h) => {
        try { h(msg); } catch (e) { applog.warn(`socket handler: ${String((e as Error)?.message || e)}`); }
      });
    },
  });
  ws = sock;
  void sock.connect(getFreshAccessToken);
  // iOS рвёт сокет в фоне — при возврате переподключаемся сразу.
  appState = App.addListener("appStateChange", ({ isActive }) => {
    if (isActive && ws === sock && !sock.isConnected()) void sock.connect();
  });
  notify();
  return sock;
}

export function stopUserSocket() {
  if (!ws) return;
  ws.disconnect();
  ws = null;
  uid = null;
  appState?.then((h) => h.remove()).catch(() => {});
  appState = null;
  notify();
}

/** Подписка на все события сокета; вернёт отписку. */
export function onUserMessage(h: Handler): () => void {
  handlers.add(h);
  return () => { handlers.delete(h); };
}

/** Сокет появился или закрылся (вход, выход, смена пользователя). */
export function onUserSocketChange(w: (s: WebSocketService | null, userId: string | null) => void): () => void {
  watchers.add(w);
  w(ws, uid);
  return () => { watchers.delete(w); };
}

if (typeof window !== "undefined") {
  window.addEventListener("hyax:session-cleared", stopUserSocket);
  window.addEventListener("hyax:force-logout", stopUserSocket);
  // Свернули приложение или вкладку — «не в сети» на любом экране.
  document.addEventListener("visibilitychange", () => ws?.send({ type: "active", active: visible(), device: deviceIdNow() }));
}

// Устройство, с которого открыт чат: сервер не шлёт пуш только ему, а не
// всем устройствам человека (chat/presence.py). deviceId из lib/secret — тот
// же, что в регистрации пуш-токена; модуль подгружаем лениво, один раз.
let _deviceId: string | undefined;
void import("@/lib/secret").then(({ deviceId }) => { _deviceId = deviceId(); }).catch(() => {});
export const deviceIdNow = () => _deviceId;

/** Какой чат открыт на этом устройстве (null — ни один); ttl 15 с, см. pages/Chat. */
export function sendViewing(chat: string | null) {
  const send = () => userSocket()?.send({ type: "viewing", chat, ttl: 15, device: _deviceId });
  if (_deviceId) send();
  else void import("@/lib/secret").then(({ deviceId }) => { _deviceId = deviceId(); send(); }).catch(send);
}
