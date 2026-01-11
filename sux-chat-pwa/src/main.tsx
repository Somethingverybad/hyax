import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Регистрируем обработчик кликов по уведомлениям через Service Worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'NOTIFICATION_CLICK') {
      // Сообщение будет обработано в компоненте Chat
      window.dispatchEvent(new CustomEvent('notificationclick', {
        detail: event.data.data
      }));
    }
  });
}

createRoot(document.getElementById("root")!).render(<App />);
