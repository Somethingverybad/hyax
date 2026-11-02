import { NativeSocket, hasNativeSocket } from "@/lib/nativeSocket";

type WebSocketMessage = {
  type: string;
  message?: any;
  data?: any;
};

type WebSocketOptions = {
  onMessage?: (data: any) => void;
  onError?: (error: Event) => void;
  onOpen?: () => void;
  onClose?: () => void;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
};

/** Не копим: это состояние, свежее значение уходит само при открытии. */
const EPHEMERAL = new Set(["ping", "active", "viewing", "activity", "rov"]);
/** Сколько ждёт неотправленное сообщение (сигналы звонка устаревают быстро). */
const QUEUE_TTL = 20000;
const QUEUE_MAX = 200;

export class WebSocketService {
  private ws: WebSocket | NativeSocket | null = null;
  private startedAt = 0;
  private connecting = false;
  private queue: { data: string; at: number }[] = [];
  private openWaiters = new Set<() => void>();
  /** Адреса по порядку: основной и запасные (запасной домен на случай, когда
   *  не разрешается основной — 2026-11-02 лёг DNS Beget). Соединение, которое
   *  закрылось, так и не открывшись, — повод попробовать следующий. */
  private urls: string[];
  private urlIndex = 0;
  private get url() { return this.urls[this.urlIndex]; }
  private options: WebSocketOptions;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingInterval: NodeJS.Timeout | null = null;
  private pongWaiters: Array<(t: number) => void> = [];
  private isManuallyClosed = false;
  private tokenSource?: string | (() => Promise<string | undefined>);

  constructor(url: string | string[], options: WebSocketOptions = {}) {
    this.urls = Array.isArray(url) ? url : [url];
    this.options = {
      reconnectInterval: 3000,
      maxReconnectAttempts: 5,
      ...options,
    };
    // Сеть вернулась или приложение снова на экране — не ждём таймер.
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.wake);
      document.addEventListener("visibilitychange", this.wake);
    }
  }

  private wake = () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    this.reconnectNow();
  };

  /** Переподключиться сразу, без паузы и даже в фоне: входящий звонок,
   *  ответ с экрана CallKit — сигналы должны уйти сейчас, а не через 30 с. */
  reconnectNow = () => {
    if (this.isManuallyClosed || this.isConnected()) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    void this.connect();
  };

  /** Дождаться открытия (не дольше ms). Без таймерного опроса: в фоне таймеры
   *  страницы стоят, а событие открытия будит её. */
  waitOpen(ms = 5000): Promise<void> {
    if (this.isConnected()) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => { this.openWaiters.delete(done); clearTimeout(timer); resolve(); };
      const timer = setTimeout(done, ms);
      this.openWaiters.add(done);
    });
  }

  /** Пауза перед следующей попыткой: 3 с, 6, 12, 24, дальше по 30 с (± разброс,
   *  чтобы после перезапуска сервера все не ломились одновременно). */
  private reconnectDelay(): number {
    const base = this.options.reconnectInterval || 3000;
    const delay = Math.min(30000, base * 2 ** Math.min(this.reconnectAttempts - 1, 4));
    return Math.round(delay * (0.8 + Math.random() * 0.4));
  }

  /**
   * token — строка или функция, отдающая свежий токен. Второй вариант нужен
   * для переподключений: сохранённый токен к тому времени может протухнуть,
   * и сервер молча закроет соединение.
   */
  async connect(token?: string | (() => Promise<string | undefined>)): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    this.isManuallyClosed = false;
    this.tokenSource = token ?? this.tokenSource;
    // Подключение уже идёт — второе не начинаем. Раньше сеть, экран, таймер и
    // appStateChange открывали по сокету каждый, и сервер слал каждое событие
    // по нескольку раз (в звонке — тройной ответ на предложение). Зависшее
    // дольше 15 с подключение не ждём.
    if (this.connecting) return;
    if (this.ws?.readyState === WebSocket.CONNECTING && Date.now() - this.startedAt < 15000) return;
    this.connecting = true;
    let wsUrl = this.url;

    let current: string | undefined;
    try {
      current = typeof this.tokenSource === "function"
        ? await this.tokenSource()
        : this.tokenSource;
    } finally {
      this.connecting = false;
    }
    if (this.isManuallyClosed || this.isConnected()) return;

    if (current) {
      const separator = wsUrl.includes('?') ? '&' : '?';
      wsUrl = `${wsUrl}${separator}token=${current}`;
    }

    try {
      this.detach();
      this.startedAt = Date.now();
      // iPhone: сокет в процессе приложения — он не засыпает в фоне со звонком.
      const ws = hasNativeSocket() ? new NativeSocket(wsUrl) : new WebSocket(wsUrl);
      this.ws = ws;
      let opened = false;

      ws.onopen = () => {
        opened = true;
        console.log('WebSocket connected:', this.url);
        this.reconnectAttempts = 0;
        this.flush();
        this.options.onOpen?.();
        this.openWaiters.forEach((w) => w());
        
        // Начинаем отправку ping сообщений для поддержания соединения
        this.startPing();
      };

      ws.onmessage = (event: { data: string }) => {
        try {
          const data: WebSocketMessage = JSON.parse(event.data);
          
          // pong — только замерам задержки (measureRtt)
          if (data.type === 'pong') {
            const now = performance.now();
            this.pongWaiters.splice(0).forEach((w) => w(now));
            return;
          }

          this.options.onMessage?.(data);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      ws.onerror = (error: Event) => {
        console.error('WebSocket error:', error);
        this.options.onError?.(error);
      };

      ws.onclose = () => {
        console.log('WebSocket closed');
        if (!opened) this.nextUrl();
        this.stopPing();
        this.options.onClose?.();

        // Пытаемся переподключиться, если не было ручного закрытия.
        // maxReconnectAttempts: Infinity — без предела (сокет пользователя):
        // иначе за минуту недоступности сервера попытки кончались, и до
        // перезапуска приложения оставался только опрос.
        if (!this.isManuallyClosed && this.reconnectAttempts < (this.options.maxReconnectAttempts || 5)) {
          this.reconnectAttempts++;
          const delay = this.reconnectDelay();
          console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.options.maxReconnectAttempts}) in ${delay}ms...`);

          this.reconnectTimer = setTimeout(() => {
            void this.connect();
          }, delay);
        }
      };
    } catch (error) {
      console.error('Error creating WebSocket:', error);
      this.nextUrl();
    }
  }

  /** Следующий адрес по кругу (после последнего — снова основной). */
  private nextUrl() {
    if (this.urls.length < 2) return;
    this.urlIndex = (this.urlIndex + 1) % this.urls.length;
    console.warn('WebSocket: пробую адрес', this.url);
  }

  disconnect(): void {
    this.isManuallyClosed = true;
    this.stopPing();
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.wake);
      document.removeEventListener("visibilitychange", this.wake);
    }
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.queue = [];
    this.openWaiters.forEach((w) => w());
    this.detach();
  }

  /** Старый сокет больше не наш: без обработчиков он не переподключится сам
   *  и не продублирует события нового. */
  private detach(): void {
    const old = this.ws;
    this.ws = null;
    this.stopPing();
    if (!old) return;
    old.onopen = old.onmessage = old.onerror = old.onclose = null;
    try { old.close(); } catch { /* уже закрыт */ }
  }

  /** Не открыт — сигналы ждут в очереди (до 20 с) и уходят при открытии:
   *  иначе ответ на звонок, пока сокет переподключался, терялся молча. */
  send(data: any): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
      return;
    }
    if (EPHEMERAL.has(data?.type)) return;
    this.queue.push({ data: JSON.stringify(data), at: Date.now() });
    if (this.queue.length > QUEUE_MAX) this.queue.shift();
    console.warn(`WebSocket is not open — queued ${data?.type ?? "message"}`);
    // Нужен сейчас — не ждём паузу между попытками (но не чаще раза в 3 с).
    if (Date.now() - this.startedAt > 3000) this.reconnectNow();
  }

  private flush(): void {
    const now = Date.now();
    const pending = this.queue.filter((m) => now - m.at < QUEUE_TTL);
    this.queue = [];
    for (const m of pending) this.ws?.send(m.data);
  }

  /** Задержка до сервера туда и обратно, мс (ping → pong); null — не ответил за timeout. */
  measureRtt(timeout = 4000): Promise<number | null> {
    if (this.ws?.readyState !== WebSocket.OPEN) return Promise.resolve(null);
    const t0 = performance.now();
    return new Promise((resolve) => {
      const w = (t: number) => { clearTimeout(timer); resolve(t - t0); };
      const timer = setTimeout(() => { this.pongWaiters = this.pongWaiters.filter((x) => x !== w); resolve(null); }, timeout);
      this.pongWaiters.push(w);
      this.send({ type: 'ping' });
    });
  }

  private startPing(): void {
    // Отправляем ping каждые 30 секунд для поддержания соединения
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.send({ type: 'ping' });
      }
    }, 30000);
  }

  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
