import { ConfirmHost } from "@/lib/confirm";
import MiniAppHost from "@/components/miniapp/MiniAppHost";
import { t as tr, tn } from "@/lib/i18n";
import { toast as sonnerToast } from "sonner";
import { Toaster } from "@/components/ui/toaster";
import ProfilePage from "./pages/Profile";
import ProfileEdit from "./pages/ProfileEdit";
import ProfileNotifications from "./pages/ProfileNotifications";
import ProfilePrivacy from "./pages/ProfilePrivacy";
import ProfileSavedAccess from "@/pages/ProfileSavedAccess";
import Music from "@/pages/Music";
import SharedPlaylist from "@/pages/SharedPlaylist";
import { syncThemeFromProfile } from "@/lib/theme";
import { readCache } from "@/lib/session-cache";
import CallHost from "./components/call/CallHost";
import EscapeKey from "./components/EscapeKey";
import SettingsFrame from "./components/SettingsFrame";
import ProfileAppearance from "./pages/ProfileAppearance";
import ProfileBugReport from "./pages/ProfileBugReport";
import AdminMetrics from "./pages/AdminMetrics";
import ProfileIdeas from "./pages/ProfileIdeas";
import ProfileVibeLevels from "./pages/ProfileVibeLevels";
import ProfileActions from "./pages/ProfileActions";
import MiniApps from "./pages/MiniApps";
import ProfileAura from "./pages/ProfileAura";
import ProfileSoundPacks from "./pages/ProfileSoundPacks";
import ProfileDeleteAccount from "./pages/ProfileDeleteAccount";
import ProfileEmail from "./pages/ProfileEmail";
import ProfileSecretTransfer from "./pages/ProfileSecretTransfer";
import ProfileDevices from "./pages/ProfileDevices";
import Onboarding from "./pages/Onboarding";
import ProfileLanguage from "./pages/ProfileLanguage";
import ProfileMicrophone from "./pages/ProfileMicrophone";
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
import { useRef, useEffect, useState } from "react";
import ShareToChat from "@/components/ShareToChat";
import { takeSharedItems, setPendingShare, type SharedPayload } from "@/lib/shareInbox";

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

/** Тема с сервера — на любом экране, а не только в чатах.
 *  Открытие по ссылке сразу в «Музыку» или в профиль раньше оставляло
 *  тему по умолчанию: выбор подхватывался только тем экраном, который
 *  сам грузит профиль. Берём из кеша, а без него — одним запросом. */
const ThemeFromProfile = () => {
  useEffect(() => {
    const cached = readCache<{ active_theme?: string }>("user");
    if (cached?.active_theme) { void syncThemeFromProfile(cached.active_theme); return; }
    if (!localStorage.getItem("access_token")) return;
    void import("@/api/client")
      .then(({ api }) => api.getCurrentUser())
      .then((p: any) => syncThemeFromProfile(p?.active_theme))
      .catch(() => { /* без сети останется тема с устройства */ });
  }, []);
  return null;
};

const TAB_ROOTS = ["/chat", "/wall", "/saved", "/music", "/profile"];

const AnimatedRoutes = ({ children }: { children: React.ReactNode }) => {
  const location = useLocation();
  const navType = useNavigationType();
  const prevPath = useRef(location.pathname);
  const step = routeDepth(location.pathname) - routeDepth(prevPath.current);
  // Переключение вкладок нижней панели — без «подъёма» экрана: выбор
  // показывает сама панель (в «Мяте» подсветка переплывает к вкладке).
  const isTab = (p: string) => TAB_ROOTS.includes(p);
  const tabSwitch = isTab(location.pathname) && isTab(prevPath.current) && location.pathname !== prevPath.current;
  const dir = tabSwitch ? "route-tab" : navType === "POP" ? "screen-pop" : step > 0 ? "screen-push" : step < 0 ? "screen-pop" : "";
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
  // Принудительный выход (lib/forceLogout): кэш уже стёрт — остаётся уйти на вход.
  useEffect(() => {
    const h = (e: Event) => {
      const reason = (e as CustomEvent).detail?.reason;
      sonnerToast(reason === "revoked" ? tr("Сеанс завершён с другого устройства") : tr("Войдите снова"));
      navRef.current("/auth", { replace: true });
    };
    window.addEventListener("hyax:force-logout", h);
    return () => window.removeEventListener("hyax:force-logout", h);
  }, []);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const toPath = (url?: string | null) => {
      if (!url) return;
      try {
        const u = new URL(url);
        // whoyax://share — расширение «Поделиться» положило файлы (lib/shareInbox).
        if (u.protocol === "whoyax:") {
          if (u.host === "share") { window.dispatchEvent(new CustomEvent("hyax:share-inbox")); return; }
          // whoyax://u/<ник>[?app] — кнопка «Открыть в WYX» на странице wyx.su/u/<ник>.
          if (["u", "c", "pl"].includes(u.host)) navRef.current(`/${u.host}${u.pathname}${u.search}`);
          return;
        }
        if (["/u/", "/c/", "/t/", "/sp/", "/stp/", "/kt/", "/pl/"].some((pre) => u.pathname.startsWith(pre))) navRef.current(u.pathname + u.search + u.hash);
      } catch { /* не URL — игнорируем */ }
    };
    CapApp.getLaunchUrl().then((r) => toPath(r?.url)).catch(() => {});
    const sub = CapApp.addListener("appUrlOpen", (e) => toPath(e.url));
    return () => { sub.then((h) => h.remove()).catch(() => {}); };
  }, []);
  return null;
};

/** Вложения из «Поделиться → WYX»: спросить, в какой чат, и открыть его. */
const ShareInboxSheet = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [payload, setPayload] = useState<SharedPayload | null>(null);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const check = () => { takeSharedItems().then((p) => { if (p) setPayload(p); }).catch(() => {}); };
    check(); // холодный старт по whoyax://share — событие могло уйти до подписки
    window.addEventListener("hyax:share-inbox", check);
    return () => window.removeEventListener("hyax:share-inbox", check);
  }, []);
  // Не вошёл (или вышел): держим присланное, шторку покажем после входа —
  // на экране логина ей нечего предложить, список чатов не загрузится.
  if (!payload || location.pathname === "/auth") return null;
  const n = payload.files.length;
  return (
    <ShareToChat
      open
      includeChannels
      includeWall
      title={n ? (n === 1 ? tr("Отправить файл") : tn(n, "Отправить {n} файл", "Отправить {n} файла", "Отправить {n} файлов")) : tr("Отправить в WYX")}
      text={payload.text}
      onClose={() => setPayload(null)}
      onPick={(chatId, chatTitle, kind) => {
        setPendingShare(payload);
        setPayload(null);
        if (kind === "wall") { navigate("/wall"); return; }
        navigate("/chat", { state: { chatId, title: chatTitle, kind: kind === "channel" ? "channel" : undefined } });
      }}
    />
  );
};

/** Тост закрывается по тапу (баг-репорт 37234a7a): sonner сам по клику не
 *  прячет, а на телефоне ждать, пока уедет, неудобно. */
const ToastTapDismiss = () => {
  useEffect(() => {
    const h = (e: Event) => {
      const el = (e.target as Element | null)?.closest?.("[data-sonner-toast]");
      if (!el) return;
      const id = el.getAttribute("data-id") || undefined;
      sonnerToast.dismiss(id as string | undefined);
    };
    document.addEventListener("click", h, true);
    return () => document.removeEventListener("click", h, true);
  }, []);
  return null;
};

const App = () => {
  // Смена языка перемонтирует дерево: все t() пересчитываются разом.
  const [langKey, setLangKey] = useState(0);
  useEffect(() => { const h = () => setLangKey((k) => k + 1); window.addEventListener("hyax:lang", h); return () => window.removeEventListener("hyax:lang", h); }, []);
  // Приложение отрисовалось — заставку из index.html можно убирать (она
  // сама дождётся конца ролика).
  useEffect(() => { window.dispatchEvent(new Event("hyax:ready")); }, []);
  // Первый запуск после установки: заранее спрашиваем доступ к геопозиции
  // (один раз; дальше — при каждой попытке отправить, см. lib/geo.ts).
  useEffect(() => {
    const t = setTimeout(() => { void import("@/lib/geo").then((g) => g.askGeoOnFirstLaunch()); }, 2500);
    return () => clearTimeout(t);
  }, []);

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
        <ToastTapDismiss />
        
        {/* Основной контейнер с закругленными углами */}
        <div className="w-screen h-screen overflow-hidden bg-background relative">
          
          {/* Кнопки с исключением из перетаскивания */}

          
          <BrowserRouter key={langKey}>
            <DeepLinks />
            {/* Esc: снять фокус с поля, закрыть панель, выйти из чата, назад. */}
            <EscapeKey />
            <ShareInboxSheet />
            <ConfirmHost />
            {/* Плеер живёт выше экранов: музыка не обрывается при переходе. */}
            <MiniPlayer />
            {/* Звонки — тоже выше экранов: разговор идёт, куда бы ни перешли;
                свёрнутый — виджетом, как плеер (components/call/CallHost). */}
            <CallHost />
            {/* Мини-приложения ботов — окно поверх всего (lib/miniapp.ts). */}
            <MiniAppHost />
            <ThemeFromProfile />
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
              <Route path="/onboarding" element={<Onboarding />} />
              <Route path="/chat" element={<Chat />} />
              {/* «Избранное» — та же страница чатов, сразу открытая на личном чате. */}
              <Route path="/saved" element={<Chat savedMode />} />
              <Route path="/wall" element={<Chat wallMode />} />
              {/* Музыка: плейлисты из того, что присылали в переписке. */}
              <Route path="/music" element={<Music />} />
              {/* Плейлист по ссылке «Поделиться». */}
              <Route path="/pl/:token" element={<SharedPlaylist />} />
              {/* Настройки и их подэкраны: на широком окне — колонкой по центру. */}
              <Route element={<SettingsFrame />}>
                <Route path="/profile" element={<ProfilePage />} />
                {/* Подэкраны профиля: правка текста и разделы настроек. */}
                <Route path="/profile/edit" element={<ProfileEdit />} />
                <Route path="/profile/notifications" element={<ProfileNotifications />} />
                <Route path="/profile/privacy" element={<ProfilePrivacy />} />
                <Route path="/profile/saved-access" element={<ProfileSavedAccess />} />
                <Route path="/profile/appearance" element={<ProfileAppearance />} />
                <Route path="/profile/bugreport" element={<ProfileBugReport />} />
                <Route path="/profile/aura" element={<ProfileAura />} />
                {/* «Долгий ящик»: идеи, голоса, реализованное (chat/ideabox.py). */}
                <Route path="/profile/ideas" element={<ProfileIdeas />} />
                <Route path="/profile/vibe-levels" element={<ProfileVibeLevels />} />
                <Route path="/profile/actions" element={<ProfileActions />} />
                <Route path="/profile/apps" element={<MiniApps />} />
                <Route path="/profile/soundpacks" element={<ProfileSoundPacks />} />
                {/* Свой пак звуков — прямо в приложении, без студии на сайте. */}
                <Route path="/profile/soundpacks/new" element={<SoundPackNew />} />
                {/* Стикерпаки: свои, сохранённые и импорт набора из Telegram. */}
                <Route path="/profile/stickerpacks" element={<ProfileStickerPacks />} />
                <Route path="/profile/delete" element={<ProfileDeleteAccount />} />
                <Route path="/profile/email" element={<ProfileEmail />} />
                <Route path="/profile/secret-transfer" element={<ProfileSecretTransfer />} />
                <Route path="/profile/devices" element={<ProfileDevices />} />
                <Route path="/profile/language" element={<ProfileLanguage />} />
                <Route path="/profile/microphone" element={<ProfileMicrophone />} />
                <Route path="/kt/:id" element={<ProfileSecretTransfer />} />
                {/* Редактор темы: новая или своя по id. */}
                <Route path="/profile/themes/:id" element={<ThemeEditor />} />
              </Route>
              <Route path="/monitoring" element={<AdminMetrics />} />
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