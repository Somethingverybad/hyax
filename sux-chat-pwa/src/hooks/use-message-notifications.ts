import { useEffect, useRef } from 'react';
import { useNotifications } from './use-notifications';
import { api } from '@/api/client';

interface Message {
  id: string;
  chat: string;
  sender?: {
    id: string;
    username: string;
  };
  content: string | null;
  file_url: string | null;
  file_name: string | null;
  created_at: string;
}

/**
 * Хук для отслеживания новых сообщений и показа уведомлений
 */
export const useMessageNotifications = (
  chatId: string | null,
  userId: string,
  enabled: boolean = true
) => {
  const { showNotification, hasPermission } = useNotifications();
  const previousMessagesRef = useRef<Set<string>>(new Set());
  const lastNotificationTimeRef = useRef<number>(0);

  useEffect(() => {
    if (!enabled || !chatId || !hasPermission()) return;

    const checkNewMessages = async () => {
      try {
        const messages: Message[] = await api.getMessages(chatId);
        const currentMessageIds = new Set(messages.map(m => m.id));
        
        // Находим новые сообщения (не в предыдущем наборе)
        const newMessages = messages.filter(
          msg => !previousMessagesRef.current.has(msg.id) && msg.sender?.id !== userId
        );

        // Показываем уведомления для новых входящих сообщений
        if (newMessages.length > 0) {
          const now = Date.now();
          // Ограничиваем частоту уведомлений (минимум 2 секунды между уведомлениями)
          if (now - lastNotificationTimeRef.current > 2000) {
            const latestMessage = newMessages[newMessages.length - 1];
            const senderName = latestMessage.sender?.username || 'Неизвестный';
            const messageText = latestMessage.content 
              ? (latestMessage.content.length > 50 
                  ? latestMessage.content.substring(0, 50) + '...' 
                  : latestMessage.content)
              : latestMessage.file_name || 'Файл';

            await showNotification({
              title: senderName,
              body: messageText,
              tag: `message-${latestMessage.id}`,
              data: { 
                chatId: chatId,
                messageId: latestMessage.id 
              },
              requireInteraction: false,
            });

            lastNotificationTimeRef.current = now;
          }
        }

        // Обновляем набор предыдущих сообщений
        previousMessagesRef.current = currentMessageIds;
      } catch (error) {
        console.error('Error checking new messages for notifications:', error);
      }
    };

    // Проверяем новые сообщения каждые 3 секунды
    const intervalId = setInterval(checkNewMessages, 3000);
    
    // Первоначальная проверка
    checkNewMessages();

    return () => {
      clearInterval(intervalId);
    };
  }, [chatId, userId, enabled, hasPermission, showNotification]);
};
