import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

/**
 * Мост к нативному плагину Voip (ios/App/App/VoipPlugin.swift):
 * PushKit-токен и CallKit — системный экран входящего вызова, который
 * работает на заблокированном экране и будит убитое приложение.
 *
 * На Android и в вебе плагина нет — все методы безопасно молчат, а входящий
 * звонок показывает наш собственный экран (CallOverlay).
 */

export interface VoipCallPayload {
  callId: string;
  chatId: string;
  fromUserId: string;
  fromUsername: string;
  fromUserAvatar?: string;
  callType: "audio" | "video";
}

interface VoipPlugin {
  /** Запросить PushKit-токен; придёт событием voipToken (и при ротации). */
  register(): Promise<void>;
  /** Приложение запустили из звонка, пока JS грузился: answered — уже
   *  принят (CallKit / кнопка «Ответить»), иначе — показать входящий. */
  getPendingAnswer(): Promise<{ call: VoipCallPayload | null; answered?: boolean }>;
  reportOutgoingCall(o: { callId: string; name: string }): Promise<void>;
  /** Маршрут звука: громкая связь или разговорный динамик. */
  setSpeaker(o: { enabled: boolean }): Promise<void>;
  reportConnected(o: { callId: string }): Promise<void>;
  endCall(o: { callId: string }): Promise<void>;
  addListener(
    event: "voipToken",
    cb: (d: { token: string }) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    event: "callAnswered",
    cb: (d: VoipCallPayload) => void
  ): Promise<PluginListenerHandle>;
  /** Android, приложение на экране: входящий пришёл пушем, экран рисует JS. */
  addListener(
    event: "callIncoming",
    cb: (d: VoipCallPayload) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    event: "callEnded",
    cb: (d: { callId: string }) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    event: "callMuted",
    cb: (d: { callId: string; muted: boolean }) => void
  ): Promise<PluginListenerHandle>;
}

const plugin = registerPlugin<VoipPlugin>("Voip");

/** iOS: входящий показывает система (CallKit), свой экран не нужен. */
export const hasCallKit = () => Capacitor.getPlatform() === "ios";
const hasNative = () => Capacitor.isNativePlatform();

async function quiet<T>(fn: () => Promise<T>): Promise<T | undefined> {
  if (!hasNative()) return undefined;
  try {
    return await fn();
  } catch (e) {
    console.warn("[voip]", e);
    return undefined;
  }
}

export const voip = {
  register: () => quiet(() => plugin.register()),
  getPendingAnswer: async () => {
    const r = await quiet(() => plugin.getPendingAnswer());
    return r?.call ? { call: r.call, answered: r.answered !== false } : null;
  },
  reportOutgoingCall: (callId: string, name: string) =>
    quiet(() => plugin.reportOutgoingCall({ callId, name })),
  reportConnected: (callId: string) => quiet(() => plugin.reportConnected({ callId })),
  setSpeaker: (enabled: boolean) => quiet(() => plugin.setSpeaker({ enabled })),
  endCall: (callId: string) => quiet(() => plugin.endCall({ callId })),
  on: <E extends "voipToken" | "callAnswered" | "callIncoming" | "callEnded" | "callMuted">(
    event: E,
    cb: Parameters<VoipPlugin["addListener"]>[1]
  ) => (hasNative() ? plugin.addListener(event as any, cb as any) : null),
};
