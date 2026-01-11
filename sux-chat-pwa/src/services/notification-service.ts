/**
 * Сервис для работы с уведомлениями через Service Worker
 */

export class NotificationService {
  private static instance: NotificationService;
  private registration: ServiceWorkerRegistration | null = null;

  private constructor() {}

  static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  /**
   * Инициализирует сервис и регистрирует Service Worker
   */
  async initialize(): Promise<boolean> {
    if (!('serviceWorker' in navigator)) {
      console.warn('Service Worker не поддерживается');
      return false;
    }

    try {
      // Ждем готовности Service Worker
      this.registration = await navigator.serviceWorker.ready;
      return true;
    } catch (error) {
      console.error('Ошибка при инициализации Service Worker:', error);
      return false;
    }
  }

  /**
   * Показывает уведомление через Service Worker
   */
  async showNotification(
    title: string,
    options: NotificationOptions = {}
  ): Promise<void> {
    if (!this.registration) {
      await this.initialize();
    }

    if (!this.registration) {
      console.warn('Service Worker не зарегистрирован');
      return;
    }

    try {
      await this.registration.showNotification(title, {
        icon: '/favicon.ico',
        badge: '/favicon.ico',
        vibrate: [200, 100, 200],
        ...options,
      });
    } catch (error) {
      console.error('Ошибка при показе уведомления:', error);
    }
  }

  /**
   * Обрабатывает клик по уведомлению
   */
  setupNotificationClickHandler(handler: (data: any) => void): void {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'NOTIFICATION_CLICK') {
          handler(event.data.data);
        }
      });
    }

    // Также обрабатываем события в главном потоке
    self.addEventListener('notificationclick', (event: any) => {
      event.notification.close();
      if (event.notification.data) {
        handler(event.notification.data);
      }
    });
  }
}
