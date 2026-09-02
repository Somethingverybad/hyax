import { Capacitor, registerPlugin } from "@capacitor/core";

interface InsetsPlugin {
  get(): Promise<{ top: number; bottom: number; left: number; right: number; below: number }>;
}

const plugin = registerPlugin<InsetsPlugin>("Insets");

let below = 0;

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
    } catch {
      // Плагина нет (браузер, старая сборка) — остаются значения из env().
    }
  };

  const refresh = () => {
    apply();
    setTimeout(apply, 250);
  };

  refresh();
  window.visualViewport?.addEventListener("resize", refresh);
  window.addEventListener("orientationchange", refresh);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refresh();
  });
}
