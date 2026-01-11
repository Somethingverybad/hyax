import { useEffect, useRef, useState } from 'react';

interface NotificationOptions {
  title: string;
  body?: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: any;
  requireInteraction?: boolean;
}

/**
 * Хук для работы с системными уведомлениями
 */
export const useNotifications = () => {
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof window !== 'undefined' && 'Notification' in window 
      ? Notification.permission 
      : 'default'
  );

  // Проверяем разрешение при монтировании и следим за изменениями
  useEffect(() => {
    if ('Notification' in window) {
      setPermission(Notification.permission);
    }
  }, []);

  /**
   * Запрашивает разрешение на уведомления
   */
  const requestPermission = async (): Promise<boolean> => {
    if (!('Notification' in window)) {
      console.warn('Браузер не поддерживает уведомления');
      return false;
    }

    if (Notification.permission === 'granted') {
      setPermission('granted');
      return true;
    }

    if (Notification.permission === 'denied') {
      console.warn('Разрешение на уведомления отклонено');
      setPermission('denied');
      return false;
    }

    try {
      const newPermission = await Notification.requestPermission();
      setPermission(newPermission);
      return newPermission === 'granted';
    } catch (error) {
      console.error('Ошибка при запросе разрешения на уведомления:', error);
      return false;
    }
  };

  /**
   * Показывает уведомление
   */
  const showNotification = async (options: NotificationOptions): Promise<void> => {
    if (!('Notification' in window)) {
      console.warn('Браузер не поддерживает уведомления');
      return;
    }

    // Если разрешения нет, пытаемся запросить
    if (Notification.permission !== 'granted') {
      const granted = await requestPermission();
      if (!granted) {
        console.warn('Не удалось получить разрешение на уведомления');
        return;
      }
    }

    try {
      // Используем Service Worker для уведомлений, если доступен
      if ('serviceWorker' in navigator) {
        try {
          const registration = await navigator.serviceWorker.ready;
          if (registration && 'showNotification' in registration) {
            await registration.showNotification(options.title, {
              body: options.body,
              icon: options.icon || '/favicon.ico',
              badge: options.badge || '/favicon.ico',
              tag: options.tag,
              data: options.data,
              requireInteraction: options.requireInteraction || false,
              vibrate: [200, 100, 200], // Вибрация на мобильных устройствах
            });
            return;
          }
        } catch (swError) {
          console.log('Service Worker notification failed, using fallback:', swError);
        }
      }
      
      // Fallback: используем обычные уведомления
      if ('Notification' in window && Notification.permission === 'granted') {
        const notification = new Notification(options.title, {
          body: options.body,
          icon: options.icon || '/favicon.ico',
          tag: options.tag,
          data: options.data,
        });
        
        // Обработка клика по уведомлению
        notification.onclick = (event) => {
          event.preventDefault();
          if (options.data?.chatId) {
            window.focus();
            // Можно добавить навигацию к чату
          }
          notification.close();
        };
      }
    } catch (error) {
      console.error('Ошибка при показе уведомления:', error);
    }
  };

  /**
   * Проверяет, поддерживаются ли уведомления
   */
  const isSupported = (): boolean => {
    return 'Notification' in window;
  };

  /**
   * Проверяет, есть ли разрешение на уведомления
   */
  const hasPermission = (): boolean => {
    return 'Notification' in window && Notification.permission === 'granted';
  };

  return {
    requestPermission,
    showNotification,
    isSupported,
    hasPermission,
    permission,
  };
};
