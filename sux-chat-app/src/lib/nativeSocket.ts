import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

/**
 * Сокет в процессе приложения на iPhone (ios/App/App/NativeSocketPlugin.swift).
 *
 * WebSocket страницы в фоне засыпает вместе с WebKit: звонок, принятый с
 * экрана CallKit, не доходил до собеседника, пока человек не откроет
 * приложение. Процесс приложения во время звонка не усыпляется — сокет живёт
 * там, а каждое его событие будит страницу. Снаружи — те же поля, что у
 * WebSocket, чтобы services/websocket.ts работал с обоими одинаково.
 *
 * Сборки без плагина (старые iOS, получившие код по воздуху) — обычный WebSocket.
 */
type Ev = { id: string };

interface NativeSocketPlugin {
  connect(o: { id: string; url: string; origin: string; userAgent: string }): Promise<void>;
  send(o: { id: string; data: string }): Promise<void>;
  close(o: { id: string }): Promise<void>;
  addListener(e: "open", cb: (e: Ev) => void): Promise<PluginListenerHandle>;
  addListener(e: "message", cb: (e: Ev & { data: string }) => void): Promise<PluginListenerHandle>;
  addListener(e: "error", cb: (e: Ev & { message?: string }) => void): Promise<PluginListenerHandle>;
  addListener(e: "close", cb: (e: Ev & { code?: number }) => void): Promise<PluginListenerHandle>;
}

const Native = registerPlugin<NativeSocketPlugin>("NativeSocket");

export const hasNativeSocket = () =>
  Capacitor.getPlatform() === "ios" && Capacitor.isPluginAvailable("NativeSocket");

const live = new Map<string, NativeSocket>();
let wired: Promise<unknown> | null = null;
const wire = () => wired ??= Promise.all([
  Native.addListener("open", (e) => live.get(e.id)?.handleOpen()),
  Native.addListener("message", (e) => live.get(e.id)?.handleMessage(e.data)),
  Native.addListener("error", (e) => live.get(e.id)?.handleError(e.message)),
  Native.addListener("close", (e) => live.get(e.id)?.handleClose()),
]);

let seq = 0;

export class NativeSocket {
  readyState: number = WebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onclose: (() => void) | null = null;
  private readonly id = `${Date.now().toString(36)}-${++seq}`;

  constructor(url: string) {
    live.set(this.id, this);
    void wire()
      .then(() => {
        // Закрыли, пока подписывались на события, — не подключаемся.
        if (this.readyState !== WebSocket.CONNECTING) return this.handleClose();
        return Native.connect({ id: this.id, url, origin: location.origin, userAgent: navigator.userAgent });
      })
      .catch((e) => { this.handleError(String(e?.message || e)); this.handleClose(); });
  }

  send(data: string): void {
    if (this.readyState !== WebSocket.OPEN) return;
    // Отказ — сокет уже закрывается, событие close придёт следом.
    void Native.send({ id: this.id, data }).catch(() => {});
  }

  close(): void {
    if (this.readyState >= WebSocket.CLOSING) return;
    this.readyState = WebSocket.CLOSING;
    void Native.close({ id: this.id }).catch(() => this.handleClose());
  }

  handleOpen() {
    if (this.readyState !== WebSocket.CONNECTING) return;
    this.readyState = WebSocket.OPEN;
    this.onopen?.();
  }

  handleMessage(data: string) {
    if (this.readyState === WebSocket.OPEN) this.onmessage?.({ data });
  }

  handleError(message?: string) {
    if (this.readyState === WebSocket.CLOSED) return;
    const e = new Event("error");
    Object.defineProperty(e, "message", { value: message || "" });
    this.onerror?.(e);
  }

  handleClose() {
    if (this.readyState === WebSocket.CLOSED) return;
    this.readyState = WebSocket.CLOSED;
    live.delete(this.id);
    this.onclose?.();
  }
}
