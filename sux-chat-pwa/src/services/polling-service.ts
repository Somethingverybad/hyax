// HTTP Polling Service для получения сообщений через периодические запросы к API
// Альтернатива SSE и WebSocket

type PollingOptions = {
  onUpdate?: (data: any) => void;
  onError?: (error: Error) => void;
  interval?: number; // Интервал опроса в миллисекундах (по умолчанию 2 секунды)
  enabled?: boolean; // Включен ли polling
};

export class PollingService {
  private intervalId: NodeJS.Timeout | null = null;
  private options: PollingOptions;
  private isRunning = false;
  private lastCheckTime: number = Date.now();

  constructor(options: PollingOptions = {}) {
    this.options = {
      interval: 2000, // 2 секунды по умолчанию
      enabled: true,
      ...options,
    };
  }

  start(pollFunction: () => Promise<any>): void {
    if (this.isRunning || !this.options.enabled) {
      return;
    }

    this.isRunning = true;
    this.lastCheckTime = Date.now();

    const poll = async () => {
      try {
        const data = await pollFunction();
        this.options.onUpdate?.(data);
        this.lastCheckTime = Date.now();
      } catch (error) {
        console.error('[PollingService] Ошибка при опросе:', error);
        this.options.onError?.(error as Error);
      }
    };

    // Выполняем первый запрос сразу
    poll();

    // Затем опрашиваем с заданным интервалом
    this.intervalId = setInterval(poll, this.options.interval);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
  }

  isActive(): boolean {
    return this.isRunning;
  }

  getLastCheckTime(): number {
    return this.lastCheckTime;
  }

  updateOptions(options: Partial<PollingOptions>): void {
    this.options = { ...this.options, ...options };
  }
}
