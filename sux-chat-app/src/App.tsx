import { Toaster } from "@/components/ui/toaster";
import ProfilePage from "./pages/Profile";
import { Capacitor } from "@capacitor/core";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Chat from "./pages/Chat";
import NotFound from "./pages/NotFound";
import { Minus, X } from "lucide-react";
import { useRef, useEffect } from "react";

import { StatusBar, Style } from '@capacitor/status-bar';


const queryClient = new QueryClient();

// Функции для управления окном
const minimizeWindow = () => {
  if (window.electronAPI) {
    window.electronAPI.minimizeWindow();
  }
};

const closeWindow = () => {
  if (window.electronAPI) {
    window.electronAPI.closeWindow();
  }
};

// Переход между экранами: лёгкий фейд со сдвигом. Ключ по пути
// перемонтирует обёртку, и CSS-анимация входа (см. index.css) запускается
// заново. Только opacity и transform — их считает композитор, раскладка не
// пересчитывается, поэтому переход не дёргается даже на слабых устройствах.
const AnimatedRoutes = ({ children }: { children: React.ReactNode }) => {
  const location = useLocation();
  return (
    <div key={location.pathname} className="route-transition h-full">
      <Routes location={location}>{children}</Routes>
    </div>
  );
};

const App = () => {
  
  // Внутри компонента App добавьте:
  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      const initializeStatusBar = async () => {
        try {
          // Приложение рисуется под статус-баром, а его высоту отводят шапки
          // (см. --sat в index.css) — фон шапки продолжается до края экрана.
          // hide() здесь был обманом: система его игнорировала (во флагах окна
          // FULLSCREEN так и не появлялся), статус-бар оставался на экране, а
          // отступа под него не было — часы и значки накрывали шапку.
          await StatusBar.setOverlaysWebView({ overlay: true });
          await StatusBar.setStyle({ style: Style.Dark });
        } catch (error) {
          console.log('StatusBar not available:', error);
        }
      };
      
      initializeStatusBar();
    }
  }, []);


  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        
        {/* Основной контейнер с закругленными углами */}
        <div className="w-screen h-screen overflow-hidden bg-background relative">
          
          {/* Кнопки с исключением из перетаскивания */}

          
          <BrowserRouter>
            <AnimatedRoutes>
              {/* Лендинг в приложении не нужен — сразу решаем, куда вести.
                  Токен есть → в чат, нет → на вход. */}
              <Route
                path="/"
                element={
                  <Navigate
                    to={localStorage.getItem("access_token") ? "/chat" : "/auth"}
                    replace
                  />
                }
              />
              <Route path="/auth" element={<Auth />} />
              <Route path="/chat" element={<Chat />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="*" element={<NotFound />} />
            </AnimatedRoutes>
          </BrowserRouter>
        </div>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;