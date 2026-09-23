import { Toaster } from "@/components/ui/toaster";
import ProfilePage from "./pages/Profile";
import ProfileEdit from "./pages/ProfileEdit";
import ProfileNotifications from "./pages/ProfileNotifications";
import ProfilePrivacy from "./pages/ProfilePrivacy";
import ProfileSavedAccess from "@/pages/ProfileSavedAccess";
import ProfileAppearance from "./pages/ProfileAppearance";
import ProfileBugReport from "./pages/ProfileBugReport";
import ProfileSoundPacks from "./pages/ProfileSoundPacks";
import ProfileDeleteAccount from "./pages/ProfileDeleteAccount";
import Legal from "./pages/Legal";
import ThemeEditor from "./pages/ThemeEditor";
import SoundPackNew from "./pages/SoundPackNew";
import ProfileStickerPacks from "./pages/ProfileStickerPacks";
import ThemePage from "./pages/ThemePage";
import SoundPackPage from "./pages/SoundPackPage";
import StickerPackPage from "./pages/StickerPackPage";
import { applog } from "@/lib/applog";
import { Capacitor } from "@capacitor/core";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate, useNavigationType } from "react-router-dom";
import { App as CapApp } from "@capacitor/app";
import PublicProfile from "./pages/PublicProfile";
import PublicChannel from "./pages/PublicChannel";
import MiniPlayer from "./components/MiniPlayer";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Chat from "./pages/Chat";
import NotFound from "./pages/NotFound";
import { Minus, X } from "lucide-react";
import { useRef, useEffect } from "react";

import { StatusBar, Style } from '@capacitor/status-bar';
import { getTheme } from "@/lib/theme";


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

// Переход между экранами. Ключ по пути перемонтирует обёртку, и CSS-анимация
// входа (см. index.css) запускается заново. Только opacity и transform — их
// считает композитор, раскладка не пересчитывается, поэтому переход не
// дёргается даже на слабых устройствах.
//
// Направление: назад — когда браузер (или системная кнопка «назад») отматывает
// историю, а также когда путь стал короче; вглубь — когда длиннее. Переход
// между вкладками одного уровня направления не имеет, там прежнее проявление.
const routeDepth = (path: string) => path.split("/").filter(Boolean).length;

const AnimatedRoutes = ({ children }: { children: React.ReactNode }) => {
  const location = useLocation();
  const navType = useNavigationType();
  const prevPath = useRef(location.pathname);
  const step = routeDepth(location.pathname) - routeDepth(prevPath.current);
  const dir = navType === "POP" ? "screen-pop" : step > 0 ? "screen-push" : step < 0 ? "screen-pop" : "";
  // Переходы — в лог баг-репорта: по ним видно, на каком экране что случилось.
  useEffect(() => { applog.info(`route ${location.pathname}`); }, [location.pathname]);
  useEffect(() => { prevPath.current = location.pathname; }, [location.pathname]);
  return (
    <div key={location.pathname} className={`route-transition h-full ${dir}`}>
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
        if (u.pathname.startsWith("/u/") || u.pathname.startsWith("/c/") || u.pathname.startsWith("/t/") || u.pathname.startsWith("/sp/") || u.pathname.startsWith("/stp/")) navRef.current(u.pathname + u.search);
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
          // Стиль значков зависит от темы — его ставит lib/theme.
          await StatusBar.setStyle({ style: getTheme().base === "light" ? Style.Light : Style.Dark });
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
            {/* Плеер живёт выше экранов: музыка не обрывается при переходе. */}
            <MiniPlayer />
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
              {/* Подэкраны профиля: правка текста и разделы настроек. */}
              <Route path="/profile/edit" element={<ProfileEdit />} />
              <Route path="/profile/notifications" element={<ProfileNotifications />} />
              <Route path="/profile/privacy" element={<ProfilePrivacy />} />
              <Route path="/profile/saved-access" element={<ProfileSavedAccess />} />
              <Route path="/profile/appearance" element={<ProfileAppearance />} />
              <Route path="/profile/bugreport" element={<ProfileBugReport />} />
              <Route path="/profile/soundpacks" element={<ProfileSoundPacks />} />
              {/* Свой пак звуков — прямо в приложении, без студии на сайте. */}
              <Route path="/profile/soundpacks/new" element={<SoundPackNew />} />
              {/* Стикерпаки: свои, сохранённые и импорт набора из Telegram. */}
              <Route path="/profile/stickerpacks" element={<ProfileStickerPacks />} />
              <Route path="/profile/delete" element={<ProfileDeleteAccount />} />
              {/* Редактор темы: новая или своя по id. */}
              <Route path="/profile/themes/:id" element={<ThemeEditor />} />
              {/* Тема по ссылке «Поделиться темой». */}
              <Route path="/t/:id" element={<ThemePage />} />
              {/* Правила и политика — публичные, без входа: на них ссылаются
                  экран регистрации и карточка приложения в сторах. */}
              <Route path="/terms" element={<Legal kind="terms" />} />
              <Route path="/privacy" element={<Legal kind="privacy" />} />
              {/* Пак звуков по ссылке «Поделиться паком». */}
              <Route path="/sp/:id" element={<SoundPackPage />} />
              {/* Стикерпак по ссылке из студии. */}
              <Route path="/stp/:id" element={<StickerPackPage />} />
              {/* Карточка по ссылке «Поделиться профилем». */}
              <Route path="/u/:username" element={<PublicProfile />} />
              {/* Канал по ссылке «Поделиться каналом». */}
              <Route path="/c/:handle" element={<PublicChannel />} />
              <Route path="*" element={<NotFound />} />
            </AnimatedRoutes>
          </BrowserRouter>
        </div>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;