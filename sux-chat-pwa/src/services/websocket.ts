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

  constructor(url: string, options: WebSocketOptions = {}) {
    this.url = url;
    this.options = {
      reconnectInterval: 3000,
      maxReconnectAttempts: 5,
      ...options,
    };
  }

  connect(token?: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    this.isManuallyClosed = false;
    let wsUrl = this.url;
    
    // Добавляем токен в query параметры, если он есть
    if (token) {
      const separator = wsUrl.includes('?') ? '&' : '?';
      wsUrl = `${wsUrl}${separator}token=${token}`;
    }

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('[WebSocketService] ✅ WebSocket подключен:', this.url);
        console.log('[WebSocketService] ReadyState:', this.ws?.readyState);
        this.reconnectAttempts = 0;
        this.options.onOpen?.();
        
        // Начинаем отправку ping сообщений для поддержания соединения
        this.startPing();
      };

      this.ws.onmessage = (event) => {
        try {
          console.log('[WebSocketService] Получены сырые данные:', event.data);
          const data: WebSocketMessage = JSON.parse(event.data);
          console.log('[WebSocketService] Распарсенные данные:', JSON.stringify(data, null, 2));
          
          // Игнорируем pong сообщения
          if (data.type === 'pong') {
            console.log('[WebSocketService] Получен pong, игнорируем');
            return;
          }

          console.log('[WebSocketService] Вызываем onMessage callback с данными:', data);
          this.options.onMessage?.(data);
        } catch (error) {
          console.error('[WebSocketService] ❌ Ошибка парсинга WebSocket сообщения:', error);
          console.error('[WebSocketService] Сырые данные:', event.data);
        }
      };

      this.ws.onerror = (error) => {
        console.error('[WebSocketService] ❌ WebSocket error:', error);
        console.error('[WebSocketService] ReadyState:', this.ws?.readyState);
        this.options.onError?.(error);
      };

      this.ws.onclose = (event) => {
        console.log('[WebSocketService] ⚠️ WebSocket закрыт');
        console.log('[WebSocketService] Close code:', event.code);
        console.log('[WebSocketService] Close reason:', event.reason);
        console.log('[WebSocketService] Was clean:', event.wasClean);
        this.stopPing();
        this.options.onClose?.();

        // Пытаемся переподключиться, если не было ручного закрытия
        if (!this.isManuallyClosed && this.reconnectAttempts < (this.options.maxReconnectAttempts || 5)) {
          this.reconnectAttempts++;
          console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.options.maxReconnectAttempts})...`);
          
          this.reconnectTimer = setTimeout(() => {
            this.connect(token);
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
