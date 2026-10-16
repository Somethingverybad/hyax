import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import { useEscape } from "@/lib/escape";
import { ArrowLeft, ExternalLink, Loader2, MoreHorizontal, RotateCw, Share2, X } from "lucide-react";
import { shareMiniApp } from "@/lib/share";
import { toast } from "sonner";
import { api } from "@/api/client";
import Identicon from "@/components/Identicon";
import { closeMiniApp, useMiniApp } from "@/lib/miniapp";
import { openExternal } from "@/lib/linkify";
import { t as tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type Launch = Awaited<ReturnType<typeof api.webappInit>>;
type MainButton = { text: string; visible: boolean; active: boolean; progress: boolean; color?: string; text_color?: string };
type Popup = { id: number; kind: "alert" | "confirm"; message: string };

/** Цвет из переменной темы (HSL-тройка) — в #rrggbb: странице проще с hex. */
const themeColor = (name: string, fallback: string) => {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!raw) return fallback;
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return fallback;
  ctx.fillStyle = fallback;
  ctx.fillStyle = raw.startsWith("#") || raw.startsWith("rgb") || raw.startsWith("hsl") ? raw : `hsl(${raw})`;
  return String(ctx.fillStyle);
};
const luminance = (hex: string) => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return 1;
  const [r, g, b] = m.slice(1).map((x) => parseInt(x, 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const themeParams = () => {
  const bg = themeColor("--background", "#ffffff");
  return {
    bg_color: bg,
    secondary_bg_color: themeColor("--card", bg),
    text_color: themeColor("--foreground", "#000000"),
    hint_color: themeColor("--muted-foreground", "#888888"),
    link_color: themeColor("--primary", "#2481cc"),
    button_color: themeColor("--primary", "#2481cc"),
    button_text_color: themeColor("--primary-foreground", "#ffffff"),
    color_scheme: luminance(bg) < 0.5 ? "dark" : "light",
  };
};
const platform = () => {
  if ((window as unknown as { electronAPI?: unknown }).electronAPI) return "desktop";
  return Capacitor.getPlatform(); // ios | android | web
};

const haptic = (type: string, style: string) => {
  if (!Capacitor.isNativePlatform()) { try { navigator.vibrate?.(type === "selection" ? 5 : 12); } catch { /* нет вибро */ } return; }
  import("@capacitor/haptics").then(({ Haptics, ImpactStyle, NotificationType }) => {
    if (type === "notification") {
      const t = style === "error" ? NotificationType.Error : style === "warning" ? NotificationType.Warning : NotificationType.Success;
      return Haptics.notification({ type: t });
    }
    if (type === "selection") return Haptics.selectionChanged();
    const s = style === "heavy" || style === "rigid" ? ImpactStyle.Heavy : style === "light" || style === "soft" ? ImpactStyle.Light : ImpactStyle.Medium;
    return Haptics.impact({ style: s });
  }).catch(() => {});
};

/**
 * Окно мини-приложения бота — на весь экран, поверх всего (один на всё
 * приложение, монтируется в App.tsx). Страница — во встроенном фрейме; общается
 * с нами через postMessage (SDK — public/wyx-webapp.js). Сообщения принимаем
 * только от своего фрейма, ответы шлём только на источник страницы.
 *
 * Платформенных возможностей страница не получает (камера, файлы, контакты —
 * нет; требование 4.7.2): только интерфейс окна, вибрация, ссылки наружу и
 * отправка данных своему боту.
 */
const MiniAppHost = () => {
  const req = useMiniApp();
  const frame = useRef<HTMLIFrameElement>(null);
  const [launch, setLaunch] = useState<Launch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [mainButton, setMainButton] = useState<MainButton | null>(null);
  const [backVisible, setBackVisible] = useState(false);
  const [popup, setPopup] = useState<Popup | null>(null);
  const [menu, setMenu] = useState(false);

  // Новый запуск — заново данные запуска и чистое состояние окна.
  useEffect(() => {
    if (!req) { setLaunch(null); return; }
    let alive = true;
    setLaunch(null); setError(null); setLoading(true); setMainButton(null); setBackVisible(false); setPopup(null); setMenu(false);
    api.webappInit(req.botId, { url: req.url, chatId: req.chatId, startParam: req.startParam })
      .then((l) => { if (alive) setLaunch(l); })
      .catch((e) => { if (alive) setError(e?.message || tr("Не удалось открыть приложение")); });
    return () => { alive = false; };
  }, [req?.key]);

  const origin = (() => { try { return launch ? new URL(launch.url).origin : ""; } catch { return ""; } })();
  const send = (event: string, data?: unknown) => {
    const w = frame.current?.contentWindow;
    if (w && origin) w.postMessage({ wyx: "webapp", event, data }, origin);
  };

  // Мост: методы SDK из страницы.
  useEffect(() => {
    if (!launch || !req) return;
    const onMessage = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const d = e.data as { wyx?: string; method?: string; params?: Record<string, unknown> } | null;
      if (!d || d.wyx !== "webapp" || !d.method) return;
      const p = d.params || {};
      switch (d.method) {
        case "ready": setLoading(false); break;
        case "expand": break; // окно и так во весь экран
        case "close": closeMiniApp(); break;
        case "setMainButton":
          setMainButton({ text: String(p.text || "").slice(0, 64), visible: !!p.visible, active: p.active !== false,
            progress: !!p.progress, color: typeof p.color === "string" ? p.color : undefined,
            text_color: typeof p.text_color === "string" ? p.text_color : undefined });
          break;
        case "setBackButton": setBackVisible(!!p.visible); break;
        case "openLink": {
          const url = String(p.url || "");
          if (/^https?:\/\//i.test(url)) openExternal(url);
          break;
        }
        case "haptic": haptic(String(p.type || "impact"), String(p.style || "")); break;
        case "showPopup":
          setPopup({ id: Number(p.id) || 0, kind: p.kind === "confirm" ? "confirm" : "alert", message: String(p.message || "").slice(0, 500) });
          break;
        case "sendData": {
          const data = String(p.data ?? "");
          api.webappSendData(launch.bot.id, launch.init_data, data)
            .then(() => closeMiniApp())
            .catch((err) => toast.error(err?.message || tr("Не удалось отправить данные боту")));
          break;
        }
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [launch, req?.key, origin]);

  // «Назад» (Android) и Esc (десктоп): если страница показала свою стрелку —
  // это её «назад», иначе закрываем окно. Обработчик чата в это время молчит
  // (isMiniAppOpen в Chat.tsx).
  const goBack = () => { if (backVisible) send("backButtonClicked"); else closeMiniApp(); };
  const goBackRef = useRef(goBack);
  goBackRef.current = goBack;
  useEscape(!!req, () => goBackRef.current());
  useEffect(() => {
    if (!req || !Capacitor.isNativePlatform()) return;
    let handle: { remove: () => void } | undefined;
    CapApp.addListener("backButton", () => goBackRef.current()).then((h) => { handle = h; });
    return () => { handle?.remove(); };
  }, [req?.key]);

  // Тема сменилась, пока окно открыто, — сообщаем странице.
  useEffect(() => {
    if (!launch) return;
    const obs = new MutationObserver(() => send("themeChanged", themeParams()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
    return () => obs.disconnect();
  }, [launch, origin]);

  if (!req) return null;

  // Данные запуска — в адресе после «#»: страница читает их сразу, без ожидания.
  const src = launch ? (() => {
    const params = new URLSearchParams({
      wyxWebAppData: launch.init_data,
      wyxWebAppVersion: "1.0",
      wyxWebAppPlatform: platform(),
      wyxWebAppThemeParams: JSON.stringify(themeParams()),
    }).toString();
    return launch.url + (launch.url.includes("#") ? "&" : "#") + params;
  })() : "";

  const title = launch?.title || req.botName;
  const closePopup = (result: boolean) => { if (popup) send("popupClosed", { id: popup.id, result }); setPopup(null); };

  return (
    <div className="fixed inset-0 z-[96] bg-background flex flex-col" role="dialog" aria-modal="true" aria-label={title}>
      <div className="shrink-0 px-2 py-2 pad-safe-top border-b border-border min-h-14 flex items-center gap-2 bg-background">
        {backVisible ? (
          <button type="button" onClick={() => send("backButtonClicked")} className="ui-icon-btn p-2" aria-label={tr("Назад")}>
            <ArrowLeft className="w-5 h-5" />
          </button>
        ) : (
          <button type="button" onClick={closeMiniApp} className="ui-icon-btn p-2" aria-label={tr("Закрыть")}>
            <X className="w-5 h-5" />
          </button>
        )}
        <Identicon id={launch?.bot.id || req.botId} avatarUrl={launch?.bot.avatar_url} className="w-8 h-8 rounded-full shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-body font-semibold truncate">{title}</p>
          <p className="text-caption text-subtle truncate">@{launch?.bot.username || req.botName} · {tr("мини-приложение")}</p>
        </div>
        <div className="relative">
          <button type="button" onClick={() => setMenu((v) => !v)} className="ui-icon-btn p-2" aria-label={tr("Ещё")}>
            <MoreHorizontal className="w-5 h-5" />
          </button>
          {menu && (
            <div className="absolute right-0 top-11 z-10 w-56 rounded-lg border border-border bg-surface-2 shadow-lg py-1">
              <button type="button" onClick={() => { setMenu(false); setLoading(true); setReloadKey((k) => k + 1); }}
                className="w-full h-11 px-3 flex items-center gap-2 text-left text-small active:bg-surface-3">
                <RotateCw className="w-4 h-4" /> {tr("Обновить")}
              </button>
              {launch && (
                <button type="button" onClick={() => {
                  setMenu(false);
                  void shareMiniApp(title, launch.bot.username).then((r) => { if (r === "copied") toast.success(tr("Ссылка скопирована")); });
                }}
                  className="w-full h-11 px-3 flex items-center gap-2 text-left text-small active:bg-surface-3">
                  <Share2 className="w-4 h-4" /> {tr("Поделиться")}
                </button>
              )}
              {launch && (
                <button type="button" onClick={() => { setMenu(false); openExternal(launch.url); }}
                  className="w-full h-11 px-3 flex items-center gap-2 text-left text-small active:bg-surface-3">
                  <ExternalLink className="w-4 h-4" /> {tr("Открыть в браузере")}
                </button>
              )}
              <button type="button" onClick={() => { setMenu(false); closeMiniApp(); }}
                className="w-full h-11 px-3 flex items-center gap-2 text-left text-small text-destructive active:bg-surface-3">
                <X className="w-4 h-4" /> {tr("Закрыть")}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="relative flex-1 min-h-0" onClick={() => menu && setMenu(false)}>
        {error ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-body">{error}</p>
            <button type="button" onClick={closeMiniApp} className="h-10 px-4 rounded-md bg-surface-4 text-small">{tr("Закрыть")}</button>
          </div>
        ) : launch && (
          <iframe
            key={`${req.key}-${reloadKey}`}
            ref={frame}
            src={src}
            title={title}
            className="absolute inset-0 w-full h-full border-0 bg-background"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
            allow="clipboard-write; autoplay; fullscreen"
            referrerPolicy="strict-origin"
            // Страница без SDK не скажет «готово» — убираем заставку сами.
            onLoad={() => setTimeout(() => setLoading(false), 600)}
          />
        )}
        {loading && !error && (
          <div className="absolute inset-0 flex items-center justify-center bg-background pointer-events-none">
            <Loader2 className="w-7 h-7 animate-spin text-subtle" />
          </div>
        )}
        {popup && (
          <div className="absolute inset-0 z-10 bg-black/50 flex items-center justify-center p-6">
            <div className="w-full max-w-sm rounded-lg bg-surface-2 border border-border p-4 space-y-4">
              <p className="text-caption text-subtle">{title}</p>
              <p className="text-body whitespace-pre-line break-words">{popup.message}</p>
              <div className="flex gap-2 justify-end">
                {popup.kind === "confirm" && (
                  <button type="button" onClick={() => closePopup(false)} className="h-10 px-4 rounded-md bg-surface-4 text-small">{tr("Отмена")}</button>
                )}
                <button type="button" onClick={() => closePopup(true)} className="h-10 px-4 rounded-md bg-primary text-primary-foreground text-small font-semibold">OK</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {mainButton?.visible && (
        <div className="shrink-0 px-3 pt-2 pad-safe-bottom border-t border-border bg-background">
          <button
            type="button"
            disabled={!mainButton.active || mainButton.progress}
            onClick={() => send("mainButtonClicked")}
            className={cn("w-full h-12 rounded-lg font-semibold flex items-center justify-center gap-2 disabled:opacity-60",
              !mainButton.color && "bg-primary text-primary-foreground")}
            style={mainButton.color ? { background: mainButton.color, color: mainButton.text_color || "#fff" } : undefined}
          >
            {mainButton.progress && <Loader2 className="w-4 h-4 animate-spin" />}
            {mainButton.text || tr("Продолжить")}
          </button>
        </div>
      )}
    </div>
  );
};

export default MiniAppHost;
