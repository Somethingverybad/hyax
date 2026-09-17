import { Capacitor, registerPlugin } from "@capacitor/core";

interface InsetsPlugin {
  get(): Promise<{ top: number; bottom: number; left: number; right: number; below: number; ime: number; webHeight?: number }>;
}

const plugin = registerPlugin<InsetsPlugin>("Insets");

let below = 0;
let ime = -1;
let webH = -1;
const watchers = new Set<() => void>();

/**
 * Полоса экрана ниже WebView (панель навигации) в CSS-пикселях.
 *
 * Плагин Keyboard считает высоту клавиатуры от низа экрана, а панель ввода
 * живёт в координатах WebView — на эту разницу смещение и нужно уменьшать
 * (см. main.tsx). На iOS и в браузере полосы нет, поэтому ноль.
 */
export function screenBelowWebView() {
  return below;
}

/**
 * Насколько клавиатура перекрывает WebView, в CSS-пикселях. -1 — измерить
 * нечем (iOS, браузер, Android до 11), тогда смещение считается по высоте
 * клавиатуры от плагина (см. main.tsx).
 *
 * Именно перекрытие, а не высота: прошивки, которые сами ужимают окно под
 * клавиатуру, дают здесь ноль — интерфейс уже на месте, двигать нечего.
 */
export function imeOverlap() {
  return ime;
}

/** Высота WebView в CSS-пикселях, -1 если неизвестна. При
 *  interactive-widget=resizes-content innerHeight ужимается под клавиатуру, а
 *  перекрытие (imeOverlap) измерено от полной высоты WebView — считать кромку
 *  клавиатуры нужно от неё. */
export function webViewHeight() {
  return webH;
}

/** Подписка на обновление инсетов: плагин отвечает асинхронно. */
export function onInsetsChange(cb: () => void) {
  watchers.add(cb);
  return () => watchers.delete(cb);
}

let refreshImpl: () => void = () => {};

/** Перемерить прямо сейчас — например, когда клавиатура поехала. */
export function refreshSafeArea() {
  refreshImpl();
}

/**
 * Вырезы экрана → --sat/--sab/--sal/--sar (их читает вся вёрстка, см. index.css).
 *
 * На iOS переменные заполняет env(safe-area-inset-*), а в Android WebView эти
 * значения всегда нули — там реальные инсеты приходят из нативного плагина
 * (см. InsetsPlugin.java) в пикселях устройства, поэтому делим на
 * devicePixelRatio.
 *
 * Перечитываем на каждое изменение видимой области: клавиатура, поворот,
 * возврат из фона, смена режима навигации — всё это меняет перекрытие
 * WebView с системными панелями. Второй проход с задержкой нужен потому, что
 * событие в JS приходит раньше, чем система заканчивает раскладку окна.
 */
export function watchSafeArea() {
  if (Capacitor.getPlatform() !== "android") return;

  const root = document.documentElement;
  const apply = async () => {
    try {
      const i = await plugin.get();
      const r = window.devicePixelRatio || 1;
      const set = (name: string, px: number) =>
        root.style.setProperty(name, `${(px / r).toFixed(2)}px`);
      set("--sat", i.top);
      set("--sab", i.bottom);
      set("--sal", i.left);
      set("--sar", i.right);
      below = i.below / r;
      ime = typeof i.ime === "number" && i.ime >= 0 ? i.ime / r : -1;
      webH = typeof i.webHeight === "number" && i.webHeight > 0 ? i.webHeight / r : -1;
      watchers.forEach((cb) => cb());
    } catch {
      // Плагина нет (браузер, старая сборка) — остаются значения из env().
    }
  };

  const refresh = () => {
    apply();
    setTimeout(apply, 250);
  };
  refreshImpl = refresh;

  refresh();
  window.visualViewport?.addEventListener("resize", refresh);
  window.addEventListener("orientationchange", refresh);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refresh();
  });
}
