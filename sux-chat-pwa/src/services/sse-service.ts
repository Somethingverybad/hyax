// Server-Sent Events (SSE) Service для получения сообщений в реальном времени
// Альтернатива WebSocket, которая работает через обычный HTTP

type SSEMessage = {
  type: string;
  data?: any;
  message?: any;
};

type SSEOptions = {
  onMessage?: (data: SSEMessage) => void;
  onError?: (error: Event) => void;
  onOpen?: () => void;
  onClose?: () => void;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
};

export class SSEService {
  private eventSource: EventSource | null = null;
  private url: string;
  private options: SSEOptions;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isManuallyClosed = false;

  constructor(url: string, options: SSEOptions = {}) {
    this.url = url;
    this.options = {
      reconnectInterval: 3000,
      maxReconnectAttempts: 5,
      ...options,
    };
  }

  connect(token?: string): void {
    if (this.eventSource?.readyState === EventSource.OPEN) {
      return;
    }

    this.isManuallyClosed = false;
    let sseUrl = this.url;
    
    // Добавляем токен в query параметры
    if (token) {
      const separator = sseUrl.includes('?') ? '&' : '?';
      sseUrl = `${sseUrl}${separator}token=${token}`;
    }

    try {
      this.eventSource = new EventSource(sseUrl);

      this.eventSource.onopen = () => {
        console.log('[SSEService] ✅ SSE подключен:', this.url);
        this.reconnectAttempts = 0;
        this.options.onOpen?.();
      };

      this.eventSource.onmessage = (event) => {
        try {
          console.log('[SSEService] Получены данные:', event.data);
          const data: SSEMessage = JSON.parse(event.data);
          console.log('[SSEService] Распарсенные данные:', JSON.stringify(data, null, 2));
          this.options.onMessage?.(data);
        } catch (error) {
          console.error('[SSEService] ❌ Ошибка парсинга SSE сообщения:', error);
          console.error('[SSEService] Сырые данные:', event.data);
        }
      };

      // Обработка кастомных событий
      this.eventSource.addEventListener('new_message', (event: MessageEvent) => {
        try {
          const data: SSEMessage = JSON.parse(event.data);
          this.options.onMessage?.(data);
        } catch (error) {
          console.error('[SSEService] ❌ Ошибка парсинга кастомного события:', error);
        }
      });

      this.eventSource.addEventListener('notification', (event: MessageEvent) => {
        try {
          const data: SSEMessage = JSON.parse(event.data);
          this.options.onMessage?.(data);
        } catch (error) {
          console.error('[SSEService] ❌ Ошибка парсинга уведомления:', error);
        }
      });

      this.eventSource.onerror = (error) => {
        console.error('[SSEService] ❌ Ошибка SSE:', error);
        this.options.onError?.(error);

        // Автоматическое переподключение
        if (this.eventSource?.readyState === EventSource.CLOSED && !this.isManuallyClosed) {
          if (this.reconnectAttempts < (this.options.maxReconnectAttempts || 5)) {
            this.reconnectAttempts++;
            console.log(`[SSEService] Попытка переподключения ${this.reconnectAttempts}/${this.options.maxReconnectAttempts}...`);
            
            this.reconnectTimer = setTimeout(() => {
              this.disconnect();
              this.connect(token);
            }, this.options.reconnectInterval || 3000);
          } else {
            console.error('[SSEService] ❌ Достигнуто максимальное количество попыток переподключения');
            this.options.onClose?.();
          }
        }
      };
    } catch (error) {
      console.error('[SSEService] ❌ Ошибка создания SSE соединения:', error);
      this.options.onError?.(error as Event);
    }
  }

  disconnect(): void {
    this.isManuallyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
      console.log('[SSEService] ⚠️ SSE отключен');
      this.options.onClose?.();
    }
  }

  getReadyState(): number {
    return this.eventSource?.readyState ?? EventSource.CLOSED;
  }

  isConnected(): boolean {
    return this.eventSource?.readyState === EventSource.OPEN;
  }
}
