import { Toaster } from "@/components/ui/toaster";
import { Capacitor } from "@capacitor/core";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Chat from "./pages/Chat";
import NotFound from "./pages/NotFound";
import { Minus, X } from "lucide-react";
import { useRef, useEffect } from "react";

import { StatusBar, Style } from '@capacitor/status-bar';
import { Capacitor } from '@capacitor/core';


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

const App = () => {
  const dragRegionRef = useRef<HTMLDivElement>(null);
  
  // Внутри компонента App добавьте:
  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      const initializeStatusBar = async () => {
        try {
          // Скрываем статус-бар и настраиваем его
          await StatusBar.setOverlaysWebView({ overlay: true });
          await StatusBar.setStyle({ style: Style.Dark });
          await StatusBar.hide();
        } catch (error) {
          console.log('StatusBar not available:', error);
        }
      };
      
      initializeStatusBar();
    }
  }, []);

  useEffect(() => {
    const dragRegion = dragRegionRef.current;
    if (!dragRegion || !window.electronAPI) return;

    let isDragging = false;
    let startX = 0;
    let startY = 0;

    const handleMouseDown = (e: MouseEvent) => {
      // Проверяем, что нажата левая кнопка мыши
      if (e.button === 0) {
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        
        // Уведомляем Electron о начале перетаскивания
        window.electronAPI.startDrag();
        
        // Добавляем класс для визуальной обратной связи
        dragRegion.classList.add('bg-primary/10');
        
        e.preventDefault();
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        // Можно добавить дополнительную логику при перемещении
        // Например, изменение курсора
        document.body.style.cursor = 'grabbing';
      }
    };

    const handleMouseUp = () => {
      if (isDragging) {
        isDragging = false;
        document.body.style.cursor = '';
        dragRegion.classList.remove('bg-primary/10');
      }
    };

    // Добавляем обработчики
    dragRegion.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      // Убираем обработчики при размонтировании
      dragRegion.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        
        {/* Основной контейнер с закругленными углами */}
        <div className="w-screen h-screen overflow-hidden bg-background relative">
          
          {/* Полоса перетаскивания окна нужна только Electron-версии. На
              телефоне она невидимо перекрывала верхние 32px и съедала нажатия
              по шапке, поэтому в нативной обёртке её не рендерим. */}
          {!Capacitor.isNativePlatform() && (
            <div
              ref={dragRegionRef}
              className="fixed top-0 left-0 right-0 h-8 drag-region z-40"
              title="Перетащите для перемещения окна"
            ></div>
          )}
          
          {/* Кнопки с исключением из перетаскивания */}

          
          <BrowserRouter>
            <Routes>
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
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </div>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;