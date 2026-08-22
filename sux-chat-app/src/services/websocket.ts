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

export class WebSocketService {
  private ws: WebSocket | null = null;
  private url: string;
  private options: WebSocketOptions;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingInterval: NodeJS.Timeout | null = null;
  private isManuallyClosed = false;
  private tokenSource?: string | (() => Promise<string | undefined>);

  constructor(url: string, options: WebSocketOptions = {}) {
    this.url = url;
    this.options = {
      reconnectInterval: 3000,
      maxReconnectAttempts: 5,
      ...options,
    };
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
    let wsUrl = this.url;

    const current = typeof this.tokenSource === "function"
      ? await this.tokenSource()
      : this.tokenSource;
    if (this.isManuallyClosed) return;

    if (current) {
      const separator = wsUrl.includes('?') ? '&' : '?';
      wsUrl = `${wsUrl}${separator}token=${current}`;
    }

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('WebSocket connected:', this.url);
        this.reconnectAttempts = 0;
        this.options.onOpen?.();
        
        // Начинаем отправку ping сообщений для поддержания соединения
        this.startPing();
      };

      this.ws.onmessage = (event) => {
        try {
          const data: WebSocketMessage = JSON.parse(event.data);
          
          // Игнорируем pong сообщения
          if (data.type === 'pong') {
            return;
          }

          this.options.onMessage?.(data);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.options.onError?.(error);
      };

      this.ws.onclose = () => {
        console.log('WebSocket closed');
        this.stopPing();
        this.options.onClose?.();

        // Пытаемся переподключиться, если не было ручного закрытия
        if (!this.isManuallyClosed && this.reconnectAttempts < (this.options.maxReconnectAttempts || 5)) {
          this.reconnectAttempts++;
          console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.options.maxReconnectAttempts})...`);
          
          this.reconnectTimer = setTimeout(() => {
            void this.connect();
          }, this.options.reconnectInterval || 3000);
        }
      };
    } catch (error) {
      console.error('Error creating WebSocket:', error);
    }
  }

  disconnect(): void {
    this.isManuallyClosed = true;
    this.stopPing();
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  send(data: any): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else {
      console.warn('WebSocket is not open. Cannot send message.');
    }
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
