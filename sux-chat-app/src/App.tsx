import { ConfirmHost } from "@/lib/confirm";
import MiniAppHost from "@/components/miniapp/MiniAppHost";
import TranslatorHost from "@/components/TranslatorHost";
import { t as tr, tn } from "@/lib/i18n";
import { toast as sonnerToast } from "sonner";
import { Toaster } from "@/components/ui/toaster";
import { syncThemeFromProfile } from "@/lib/theme";
import { readCache } from "@/lib/session-cache";

import EscapeKey from "./components/EscapeKey";
import SettingsFrame from "./components/SettingsFrame";
import { applog } from "@/lib/applog";
import { Capacitor } from "@capacitor/core";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate, useNavigationType } from "react-router-dom";
import { useScreenScroll } from "@/lib/screenScroll";
import { App as CapApp } from "@capacitor/app";
import MiniPlayer from "./components/MiniPlayer";
import VideoNoteHost from "./components/VideoNoteHost";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Chat from "./pages/Chat";
import NotFound from "./pages/NotFound";
import { Minus, X } from "lucide-react";
import { useRef, useEffect, useState, lazy, Suspense } from "react";
import ShareToChat from "@/components/ShareToChat";
import { takeSharedItems, setPendingShare, type SharedPayload } from "@/lib/shareInbox";

import { StatusBar, Style } from '@capacitor/status-bar';
import { getTheme } from "@/lib/theme";

// Звонки — не в стартовом наборе (~100 КБ): хост монтируется сразу после
// первого кадра (DeferredCallHost), до этого lib/calls ждёт его регистрации.
const CallHost = lazy(() => import("./components/call/CallHost"));
const DeferredCallHost = () => {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const w = window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(() => setReady(true), { timeout: 1200 }); else window.setTimeout(() => setReady(true), 800);
  }, []);
  return ready ? <Suspense fallback={null}><CallHost /></Suspense> : null;
};

// Экраны, кроме входа, списка чатов и переписки, грузятся по требованию: основной
// файл был 2,3 МБ, и слабый Android разбирал его при каждом холодном старте
// (PERF_PLAN.md, п. 1). Частые экраны подгружаются в простое — prefetchScreens.
const ProfilePage = lazy(() => import("./pages/Profile"));
const ProfileEdit = lazy(() => import("./pages/ProfileEdit"));
const ProfileNotifications = lazy(() => import("./pages/ProfileNotifications"));
const ProfilePrivacy = lazy(() => import("./pages/ProfilePrivacy"));
const ProfileSavedAccess = lazy(() => import("@/pages/ProfileSavedAccess"));
const Music = lazy(() => import("@/pages/Music"));
const SharedPlaylist = lazy(() => import("@/pages/SharedPlaylist"));
const AirLink = lazy(() => import("@/pages/AirLink"));
const ProfileAppearance = lazy(() => import("./pages/ProfileAppearance"));
const ProfileBugReport = lazy(() => import("./pages/ProfileBugReport"));
const AdminMetrics = lazy(() => import("./pages/AdminMetrics"));
const ProfileIdeas = lazy(() => import("./pages/ProfileIdeas"));
const ProfileVibeLevels = lazy(() => import("./pages/ProfileVibeLevels"));
const ProfileActions = lazy(() => import("./pages/ProfileActions"));
const ProfileQuickReaction = lazy(() => import("./pages/ProfileQuickReaction"));
const MiniApps = lazy(() => import("./pages/MiniApps"));
const ProfileAura = lazy(() => import("./pages/ProfileAura"));
const ProfileSoundPacks = lazy(() => import("./pages/ProfileSoundPacks"));
const ProfileDeleteAccount = lazy(() => import("./pages/ProfileDeleteAccount"));
const ProfileEmail = lazy(() => import("./pages/ProfileEmail"));
const ProfileSecretTransfer = lazy(() => import("./pages/ProfileSecretTransfer"));
const ProfileDevices = lazy(() => import("./pages/ProfileDevices"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const ProfileLanguage = lazy(() => import("./pages/ProfileLanguage"));
const ProfileMicrophone = lazy(() => import("./pages/ProfileMicrophone"));
const ProfileVibeHistory = lazy(() => import("./pages/ProfileVibeHistory"));
const Legal = lazy(() => import("./pages/Legal"));
const ThemeEditor = lazy(() => import("./pages/ThemeEditor"));
const SoundPackNew = lazy(() => import("./pages/SoundPackNew"));
const ProfileStickerPacks = lazy(() => import("./pages/ProfileStickerPacks"));
const ThemePage = lazy(() => import("./pages/ThemePage"));
const SoundPackPage = lazy(() => import("./pages/SoundPackPage"));
const StickerPackPage = lazy(() => import("./pages/StickerPackPage"));
const PublicProfile = lazy(() => import("./pages/PublicProfile"));
const PublicChannel = lazy(() => import("./pages/PublicChannel"));

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

/** Тап по пушу: открыть чат, Стену или профиль — с любого экрана.
 *  Раньше слушатель жил в Chat.tsx и переключал там выбранный чат; на
 *  «Музыке», в профиле или на Стене экран чатов размонтирован, и нажатие
 *  уходило в никуда. Переход через state — Chat.tsx ловит его и когда уже
 *  открыт (по location.key), и при монтировании. Плагин хранит последний
 *  тап до появления слушателя, так что холодный старт из пуша тоже доходит. */
const PushOpen = () => {
  const navigate = useNavigate();
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let handle: { remove: () => Promise<void> } | null = null;
    void import("@capacitor-firebase/messaging").then(({ FirebaseMessaging }) =>
      FirebaseMessaging.addListener("notificationActionPerformed", (e) => {
        const data = ((e as { notification?: { data?: Record<string, unknown> } })?.notification?.data) || {};
        if (data.kind === "vibe") { navigate("/profile"); return; }
        // Напоминание питомца — к нему в профиль.
        if (data.kind === "pet") { navigate("/profile"); return; }
        // Пост собеседника на Стене. Старые сборки тип пуша из шифротекста не
        // передают — узнаём Стену по chat_id.
        const wallId = readCache<{ id?: string }>("wall")?.id;
        if (data.kind === "wall_post" || (wallId && String(data.chat_id) === wallId)) { navigate("/wall"); return; }
        if (data.chat_id) navigate("/chat", { state: { chatId: String(data.chat_id) } });
      }),
    ).then((h) => { handle = h; }).catch(() => { /* нет плагина — нет пушей */ });
    return () => { void handle?.remove(); };
  }, [navigate]);
  return null;
};

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
/** Список, Избранное и Стена — один экран (pages/Chat) с тремя слоями: при
 *  переключении он не пересоздаётся (PERF_PLAN.md, п. 4), меняются только
 *  savedMode/wallMode. Один ключ обёртки — иначе React монтировал бы заново. */
const CHAT_TABS = new Set(["/chat", "/saved", "/wall"]);

/** Частые экраны — подгрузить заранее, когда главный экран уже нарисован и
 *  приложение простаивает: переход в «Музыку» или профиль тогда мгновенный. */
const prefetchScreens = () => {
  const run = () => { void import("@/pages/Music"); void import("./pages/Profile"); void import("./pages/ProfileAppearance"); void import("./pages/ProfileNotifications"); };
  const w = window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => void };
  if (w.requestIdleCallback) w.requestIdleCallback(run, { timeout: 15000 }); else window.setTimeout(run, 6000);
};
const PrefetchScreens = () => { useEffect(() => { prefetchScreens(); }, []); return null; };

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
  // Вернулись назад — прокрутка экрана там же, где ушли (lib/screenScroll).
  // Список чатов и ленты — нет: у них своя прокрутка и прижатие к низу.
  const boxRef = useRef<HTMLDivElement>(null);
  useScreenScroll(boxRef, location.key, location.pathname, !tabSwitch && (navType === "POP" || step < 0), CHAT_TABS.has(location.pathname));
  // Переходы — в лог баг-репорта: по ним видно, на каком экране что случилось.
  useEffect(() => { applog.info(`route ${location.pathname}`); }, [location.pathname]);
  useEffect(() => { prevPath.current = location.pathname; }, [location.pathname]);
  return (
    <div ref={boxRef} key={CHAT_TABS.has(location.pathname) ? "chat-tabs" : location.pathname} className={`route-transition h-full ${dir}`}>
      {/* Экран ещё грузится (первый раз) — фон без мигания, не спиннер. */}
      <Suspense fallback={null}>
        <Routes location={location}>{children}</Routes>
      </Suspense>
    </div>
  );
};

/** Ссылка https://wyx.su/u/<ник> (или старая на основной домен), открытая в установленном
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
  // Переход из мест без роутера под рукой (свой эмодзи в тексте → его набор).
  useEffect(() => {
    const h = (e: Event) => { const to = (e as CustomEvent<string>).detail; if (typeof to === "string" && to.startsWith("/")) navRef.current(to); };
    window.addEventListener("hyax:navigate", h);
    return () => window.removeEventListener("hyax:navigate", h);
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
          // whoyax://u/<ник>[?app], whoyax://stp/<id>… — кнопка «Открыть в WYX» на карточке wyx.su.
          if (["u", "c", "pl", "t", "sp", "stp"].includes(u.host)) navRef.current(`/${u.host}${u.pathname}${u.search}`);
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
            {/* Видео-сообщение во весь экран и виджетом — тоже выше экранов (lib/videoNote). */}
            <VideoNoteHost />
            {/* Звонки — тоже выше экранов: разговор идёт, куда бы ни перешли;
                свёрнутый — виджетом, как плеер (components/call/CallHost). */}
            <DeferredCallHost />
            {/* Мини-приложения ботов — окно поверх всего (lib/miniapp.ts). */}
            <MiniAppHost />
            {/* Переводчик вставленного текста — кнопкой в шапке чатов и ⌘/Ctrl+Shift+Y. */}
            <TranslatorHost />
            <ThemeFromProfile />
            <PushOpen />
            <PrefetchScreens />
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
              {/* Эфир по ссылке «Поделиться эфиром». */}
              <Route path="/air/:id" element={<AirLink />} />
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
                <Route path="/profile/reactions" element={<ProfileQuickReaction />} />
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
                <Route path="/profile/vibe" element={<ProfileVibeHistory />} />
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