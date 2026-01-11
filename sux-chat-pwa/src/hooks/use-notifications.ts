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
    const checkPermission = () => {
      if ('Notification' in window) {
        const currentPermission = Notification.permission;
        console.log('[Notifications] Checking permission:', currentPermission);
        setPermission(currentPermission);
      }
    };

    checkPermission();

    // Проверяем разрешение каждые 5 секунд (на случай если оно изменилось в другом табе)
    const interval = setInterval(checkPermission, 5000);

    return () => clearInterval(interval);
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

    // Проверяем разрешение перед попыткой показа
    const currentPermission = Notification.permission;
    if (currentPermission !== 'granted') {
      console.log('[Notifications] Permission not granted, current:', currentPermission);
      const granted = await requestPermission();
      if (!granted) {
        console.warn('[Notifications] Не удалось получить разрешение на уведомления');
        return;
      }
    }

    console.log('[Notifications] ========== ПОПЫТКА ПОКАЗАТЬ УВЕДОМЛЕНИЕ ==========');
    console.log('[Notifications] Title:', options.title);
    console.log('[Notifications] Body:', options.body);
    console.log('[Notifications] Current permission:', Notification.permission);
    console.log('[Notifications] Options:', options);

    try {
      // Определяем браузер для выбора стратегии
      const userAgent = navigator.userAgent.toLowerCase();
      const isOpera = userAgent.includes('opr/') || userAgent.includes('opera');
      const isSafari = userAgent.includes('safari') && !userAgent.includes('chrome');
      
      console.log('[Notifications] Браузер:', {
        userAgent: navigator.userAgent,
        isOpera,
        isSafari,
        isChrome: userAgent.includes('chrome') && !isOpera
      });
      
      // Для Opera и Safari лучше использовать прямой Notification API
      const preferDirectAPI = isOpera || isSafari;
      
      // Сначала пробуем через Service Worker (для фоновых уведомлений), если не Opera/Safari
      let useServiceWorker = false;
      if (!preferDirectAPI && 'serviceWorker' in navigator) {
        console.log('[Notifications] Service Worker доступен, проверяем...');
        try {
          const registration = await navigator.serviceWorker.ready;
          console.log('[Notifications] Service Worker ready:', registration);
          console.log('[Notifications] Service Worker active:', registration?.active?.state);
          console.log('[Notifications] Has showNotification:', registration && 'showNotification' in registration);
          
          if (registration && 'showNotification' in registration) {
            useServiceWorker = true;
            console.log('[Notifications] ✅ Показываем через Service Worker');
            
            const notificationOptions = {
              body: options.body,
              icon: options.icon || '/favicon.ico',
              badge: options.badge || '/favicon.ico',
              tag: options.tag,
              data: options.data,
              requireInteraction: options.requireInteraction || false,
              vibrate: [200, 100, 200],
              silent: false,
            };
            
            console.log('[Notifications] Service Worker notification options:', notificationOptions);
            
            await registration.showNotification(options.title, notificationOptions);
            
            console.log('[Notifications] ✅ Уведомление показано через Service Worker');
            console.log('[Notifications] ==========================================');
            return;
          } else {
            console.warn('[Notifications] Service Worker registration не поддерживает showNotification');
          }
        } catch (swError) {
          console.error('[Notifications] ❌ Ошибка Service Worker:', swError);
          console.error('[Notifications] Stack:', swError instanceof Error ? swError.stack : 'N/A');
          useServiceWorker = false;
          // Продолжаем с fallback
        }
      } else {
        if (preferDirectAPI) {
          console.log('[Notifications] Используем прямой API для', isOpera ? 'Opera' : 'Safari');
        } else {
          console.log('[Notifications] Service Worker недоступен');
        }
      }
      
      // Используем обычный Notification API напрямую (fallback или для Opera/Safari)
      if (Notification.permission === 'granted') {
        console.log('[Notifications] ✅ Используем прямой Notification API');
        console.log('[Notifications] Notification API доступен:', typeof Notification !== 'undefined');
        
        try {
          // Для Opera и некоторых браузеров badge может не поддерживаться
          const notificationOptions: NotificationOptions = {
            body: options.body,
            icon: options.icon || '/favicon.ico',
            tag: options.tag,
            data: options.data,
            requireInteraction: options.requireInteraction || false,
            silent: false,
          };
          
          // Добавляем badge только если поддерживается
          if ('badge' in Notification.prototype || 'Badge' in window) {
            notificationOptions.badge = options.badge || '/favicon.ico';
          }
          
          console.log('[Notifications] Notification API options:', notificationOptions);
          console.log('[Notifications] Создаем уведомление...');
          
          const notification = new Notification(options.title, notificationOptions);
          
          console.log('[Notifications] ✅ Уведомление создано успешно');
          console.log('[Notifications] Notification object:', notification);
          console.log('[Notifications] Notification.title:', notification.title);
          console.log('[Notifications] Notification.body:', notification.body);
          
          // Проверяем, действительно ли уведомление показалось
          notification.onshow = () => {
            console.log('[Notifications] ✅✅✅ УВЕДОМЛЕНИЕ ПОКАЗАНО НА ЭКРАНЕ!');
          };
          
          notification.onerror = (error) => {
            console.error('[Notifications] ❌ Ошибка показа уведомления:', error);
          };
          
          // Обработка клика по уведомлению
          notification.onclick = (event) => {
            event.preventDefault();
            console.log('[Notifications] Notification clicked, data:', options.data);
            window.focus();
            
            // Навигация к чату, если указан chatId
            if (options.data?.chatId) {
              const url = `/chat`;
              if (window.location.pathname !== url) {
                window.location.href = url;
              }
            }
            
            notification.close();
          };

          // Обработка ошибок уведомления
          notification.onerror = (error) => {
            console.error('[Notifications] Notification error:', error);
          };
          
          // Обработка закрытия уведомления
          notification.onclose = () => {
            console.log('[Notifications] Notification closed');
          };
          
        } catch (error) {
          console.error('[Notifications] ❌ ОШИБКА создания уведомления:', error);
          console.error('[Notifications] Error name:', error instanceof Error ? error.name : 'N/A');
          console.error('[Notifications] Error message:', error instanceof Error ? error.message : String(error));
          console.error('[Notifications] Error stack:', error instanceof Error ? error.stack : 'N/A');
          throw error;
        }
      } else {
        console.warn('[Notifications] ❌ Разрешение не получено для fallback');
        console.warn('[Notifications] Current permission:', Notification.permission);
      }
      console.log('[Notifications] ==========================================');
    } catch (error) {
      console.error('[Notifications] ❌❌❌ КРИТИЧЕСКАЯ ОШИБКА при показе уведомления ❌❌❌');
      console.error('[Notifications] Error:', error);
      console.error('[Notifications] Error type:', typeof error);
      console.error('[Notifications] ==========================================');
      throw error;
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
