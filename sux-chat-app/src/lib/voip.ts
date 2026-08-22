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
  /** Если приложение запустили ответом на звонок с экрана блокировки —
   *  звонок уже принят в CallKit, а JS только загрузился. */
  getPendingAnswer(): Promise<{ call: VoipCallPayload | null }>;
  reportOutgoingCall(o: { callId: string; name: string }): Promise<void>;
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

export const hasCallKit = () => Capacitor.getPlatform() === "ios";

async function quiet<T>(fn: () => Promise<T>): Promise<T | undefined> {
  if (!hasCallKit()) return undefined;
  try {
    return await fn();
  } catch (e) {
    console.warn("[voip]", e);
    return undefined;
  }
}

export const voip = {
  register: () => quiet(() => plugin.register()),
  getPendingAnswer: async () =>
    (await quiet(() => plugin.getPendingAnswer()))?.call ?? null,
  reportOutgoingCall: (callId: string, name: string) =>
    quiet(() => plugin.reportOutgoingCall({ callId, name })),
  reportConnected: (callId: string) => quiet(() => plugin.reportConnected({ callId })),
  endCall: (callId: string) => quiet(() => plugin.endCall({ callId })),
  on: <E extends "voipToken" | "callAnswered" | "callEnded" | "callMuted">(
    event: E,
    cb: Parameters<VoipPlugin["addListener"]>[1]
  ) => (hasCallKit() ? plugin.addListener(event as any, cb as any) : null),
};
