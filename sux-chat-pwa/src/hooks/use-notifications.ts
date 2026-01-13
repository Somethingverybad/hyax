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
    console.log('[useNotifications] showNotification вызван:', { title: options.title, body: options.body });
    
    if (!('Notification' in window)) {
      console.warn('[useNotifications] Браузер не поддерживает уведомления');
      return;
    }

    // Если разрешения нет, пытаемся запросить
    if (Notification.permission !== 'granted') {
      console.log('[useNotifications] Разрешение не получено, запрашиваем...');
      const granted = await requestPermission();
      if (!granted) {
        console.warn('[useNotifications] Не удалось получить разрешение на уведомления');
        return;
      }
    }

    console.log('[useNotifications] Разрешение получено, показываем уведомление');

    try {
      // Используем Service Worker для уведомлений, если доступен
      if ('serviceWorker' in navigator) {
        try {
          const registration = await navigator.serviceWorker.ready;
          console.log('[useNotifications] Service Worker готов:', registration);
          if (registration && 'showNotification' in registration) {
            console.log('[useNotifications] Показываем через Service Worker');
            await registration.showNotification(options.title, {
              body: options.body,
              icon: options.icon || '/favicon.ico',
              badge: options.badge || '/favicon.ico',
              tag: options.tag,
              data: options.data,
              requireInteraction: options.requireInteraction || false,
              vibrate: [200, 100, 200], // Вибрация на мобильных устройствах
            });
            console.log('[useNotifications] ✅ Уведомление показано через Service Worker');
            return;
          }
        } catch (swError) {
          console.warn('[useNotifications] Service Worker notification failed, using fallback:', swError);
        }
      }
      
      // Fallback: используем обычные уведомления
      if ('Notification' in window && Notification.permission === 'granted') {
        console.log('[useNotifications] Показываем через обычный Notification API');
        const notification = new Notification(options.title, {
          body: options.body,
          icon: options.icon || '/favicon.ico',
          tag: options.tag,
          data: options.data,
        });
        
        console.log('[useNotifications] ✅ Уведомление создано через Notification API');
        
        // Обработка клика по уведомлению
        notification.onclick = (event) => {
          event.preventDefault();
          if (options.data?.chatId) {
            window.focus();
            // Можно добавить навигацию к чату
          }
          notification.close();
        };
      } else {
        console.warn('[useNotifications] Не удалось показать уведомление: разрешение не получено');
      }
    } catch (error) {
      console.error('[useNotifications] ❌ Ошибка при показе уведомления:', error);
      throw error; // Пробрасываем ошибку для обработки в вызывающем коде
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
