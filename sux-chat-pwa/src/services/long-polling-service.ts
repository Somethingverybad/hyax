// HTTP Long Polling Service для получения сообщений в реальном времени
// Альтернатива WebSocket, которая работает через обычный HTTP

type LongPollingMessage = {
  type: string;
  data?: any;
  message?: any;
};

type LongPollingOptions = {
  onMessage?: (data: LongPollingMessage) => void;
  onError?: (error: Error) => void;
  onOpen?: () => void;
  onClose?: () => void;
  pollInterval?: number; // Интервал между запросами (мс)
  timeout?: number; // Таймаут запроса (мс)
};

export class LongPollingService {
  private url: string;
  private options: LongPollingOptions;
  private pollingTimer: NodeJS.Timeout | null = null;
  private isActive = false;
  private abortController: AbortController | null = null;

  constructor(url: string, options: LongPollingOptions = {}) {
    this.url = url;
    this.options = {
      pollInterval: 1000, // 1 секунда между запросами
      timeout: 30000, // 30 секунд таймаут
      ...options,
    };
  }

  connect(token?: string): void {
    if (this.isActive) {
      return;
    }

    this.isActive = true;
    this.options.onOpen?.();
    console.log('[LongPollingService] ✅ Long Polling запущен:', this.url);
    
    // Начинаем polling
    this.startPolling(token);
  }

  private async startPolling(token?: string): Promise<void> {
    if (!this.isActive) {
      return;
    }

    try {
      let pollUrl = this.url;
      if (token) {
        const separator = pollUrl.includes('?') ? '&' : '?';
        pollUrl = `${pollUrl}${separator}token=${token}&wait=true&timeout=${this.options.timeout || 30000}`;
      } else {
        const separator = pollUrl.includes('?') ? '&' : '?';
        pollUrl = `${pollUrl}${separator}wait=true&timeout=${this.options.timeout || 30000}`;
      }

      this.abortController = new AbortController();

      const response = await fetch(pollUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data: LongPollingMessage | LongPollingMessage[] = await response.json();
      
      // Обрабатываем массив сообщений или одно сообщение
      const messages = Array.isArray(data) ? data : [data];
      
      for (const message of messages) {
        console.log('[LongPollingService] Получено сообщение:', JSON.stringify(message, null, 2));
        this.options.onMessage?.(message);
      }

      // Продолжаем polling
      if (this.isActive) {
        this.pollingTimer = setTimeout(() => {
          this.startPolling(token);
        }, this.options.pollInterval || 1000);
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        // Запрос был отменен - это нормально при disconnect
        return;
      }
      
      console.error('[LongPollingService] ❌ Ошибка polling:', error);
      this.options.onError?.(error);

      // Продолжаем polling даже при ошибке
      if (this.isActive) {
        this.pollingTimer = setTimeout(() => {
          this.startPolling(token);
        }, this.options.pollInterval || 1000);
      }
    }
  }

  disconnect(): void {
    this.isActive = false;
    
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    
    if (this.pollingTimer) {
      clearTimeout(this.pollingTimer);
      this.pollingTimer = null;
    }
    
    console.log('[LongPollingService] ⚠️ Long Polling остановлен');
    this.options.onClose?.();
  }

  isConnected(): boolean {
    return this.isActive;
  }
}
