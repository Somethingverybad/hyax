import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Регистрируем обработчик кликов по уведомлениям через Service Worker
// VitePWA автоматически регистрирует Service Worker, поэтому мы только добавляем обработчики
if ('serviceWorker' in navigator) {
  // Ждем готовности Service Worker перед добавлением обработчиков
  navigator.serviceWorker.ready.then(() => {
    navigator.serviceWorker.addEventListener('message', (event) => {
      console.log('[Main] Получено сообщение от Service Worker:', event.data);
      
      if (event.data && event.data.type === 'NOTIFICATION_CLICK') {
        // Сообщение будет обработано в компоненте Chat
        window.dispatchEvent(new CustomEvent('notificationclick', {
          detail: event.data.data
        }));
      }
      
      if (event.data && event.data.type === 'CHECK_MESSAGES') {
        // Отправляем событие для проверки сообщений
        window.dispatchEvent(new CustomEvent('checkmessages', {
          detail: event.data
        }));
      }
    });
  }).catch(err => {
    console.warn('[Main] Service Worker не готов:', err);
  });
}

createRoot(document.getElementById("root")!).render(<App />);
