import { Toaster } from "@/components/ui/toaster";
import ProfilePage from "./pages/Profile";
import { Capacitor } from "@capacitor/core";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { App as CapApp } from "@capacitor/app";
import PublicProfile from "./pages/PublicProfile";
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

/** Ссылка https://huyax.e-tree.su/u/<ник>, открытая в установленном
 *  приложении (universal link / app link): система отдаёт нам URL — ведём на
 *  тот же путь внутри SPA. Отдельно — «холодный» старт по ссылке, когда
 *  слушатель ещё не висел. Веб этого не касается: там браузер сам открыл путь. */
const DeepLinks = () => {
  const navigate = useNavigate();
  // navigate из useNavigate меняется при каждой смене пути, а getLaunchUrl()
  // отдаёт URL запуска всю сессию — эффект с зависимостью от navigate
  // перечитывал его после каждого перехода и возвращал на /u/… (кнопка
  // «Написать» «не работала»). Поэтому: navigate через ref, эффект — один раз.
  const navRef = useRef(navigate);
  navRef.current = navigate;
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const toPath = (url?: string | null) => {
      if (!url) return;
      try {
        const u = new URL(url);
        if (u.pathname.startsWith("/u/")) navRef.current(u.pathname + u.search);
      } catch { /* не URL — игнорируем */ }
    };
    CapApp.getLaunchUrl().then((r) => toPath(r?.url)).catch(() => {});
    const sub = CapApp.addListener("appUrlOpen", (e) => toPath(e.url));
    return () => { sub.then((h) => h.remove()).catch(() => {}); };
  }, []);
  return null;
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
            <DeepLinks />
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
              {/* «Избранное» — та же страница чатов, сразу открытая на личном чате. */}
              <Route path="/saved" element={<Chat savedMode />} />
              <Route path="/profile" element={<ProfilePage />} />
              {/* Карточка по ссылке «Поделиться профилем». */}
              <Route path="/u/:username" element={<PublicProfile />} />
              <Route path="*" element={<NotFound />} />
            </AnimatedRoutes>
          </BrowserRouter>
        </div>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;