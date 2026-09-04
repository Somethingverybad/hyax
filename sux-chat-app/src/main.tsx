import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);

// Высота приложения. CSS-переменную читают .h-screen/.min-h-screen (см.
// index.css). Берём её из visualViewport, а не из dvh: при открытии клавиатуры
// dvh обновляется с задержкой, и поле ввода заметно отставало от клавиатуры.
function syncAppHeight() {
  const vv = window.visualViewport;
  const visible = vv ? vv.height : window.innerHeight;
  // Вырезы теперь отводят сами экраны (см. .pad-safe-* в index.css), поэтому
  // приложению достаётся вся видимая область без вычитаний.
  const h = Math.max(visible, 200);
  document.documentElement.style.setProperty("--app-height", `${Math.round(h)}px`);
}

syncAppHeight();
window.visualViewport?.addEventListener("resize", syncAppHeight);
window.visualViewport?.addEventListener("scroll", syncAppHeight);
window.addEventListener("resize", syncAppHeight);

// При фокусе на поле браузер сам не всегда доводит его до видимой зоны —
// особенно когда высота меняется вместе с клавиатурой. Досматриваем вручную.
document.addEventListener(
  "focusin",
  (e) => {
    const el = e.target as HTMLElement;
    if (!el || !el.matches?.("input, textarea")) return;
    setTimeout(() => el.scrollIntoView({ block: "center", behavior: "smooth" }), 250);
  },
  true,
);

// Клавиатура: двигаем интерфейс синхронно с ней. События приходят до начала
// анимации и несут её высоту и длительность, поэтому панель ввода едет вместе
// с клавиатурой, а не догоняет её рывком после ресайза WebView.
import { Keyboard, KeyboardResize } from "@capacitor/keyboard";
import { Capacitor as Cap } from "@capacitor/core";
import { screenBelowWebView, watchSafeArea } from "./lib/safeArea";

watchSafeArea();

if (Cap.isNativePlatform()) {
  const root = document.documentElement;

  if (Cap.getPlatform() === "android") {
    // Плагинный KeyboardResize.Native выключен: он ужимал WebView поверх
    // системного ресайза, и получался двойной сдвиг — интерфейс улетал вверх, а
    // между панелью ввода и клавиатурой зияла пустота.
    //
    // Системного ресайза здесь тоже нет, хотя в манифесте и стоит
    // windowSoftInputMode=adjustResize: окно разложено во весь экран
    // (StatusBar overlay ставит SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN), а под этим
    // флагом Android под клавиатуру окно не ужимает. Замеряно на месте:
    // клавиатура открыта, а visualViewport остаётся 762px и панель ввода
    // оказывается за ней. Поэтому высоту клавиатуры отрабатываем сами — тем же
    // кодом, что и iOS, ниже.
    Keyboard.setResizeMode({ mode: KeyboardResize.None }).catch(() => {});
  }

  // WebView не ресайзим, а синхронно двигаем панель ввода сами — плагин
  // присылает высоту клавиатуры до начала её анимации. Если прошивка всё же
  // ужала viewport сама, alreadyShrunk вычтет уже отработанную часть, и
  // двойного сдвига не будет.
  let keyboardHeight = 0;
  const applyKeyboardOffset = () => {
    const visible = window.visualViewport?.height ?? window.innerHeight;
    const alreadyShrunk = Math.max(0, window.innerHeight - visible);
    // Клавиатуру плагин меряет от низа экрана, а панель ввода живёт в
    // координатах WebView: на Android под ним остаётся полоса панели
    // навигации, и без её вычета панель ввода вставала выше клавиатуры,
    // открывая под собой ленту сообщений.
    const offset = Math.max(0, keyboardHeight - screenBelowWebView() - alreadyShrunk);
    root.style.setProperty("--kb-height", `${Math.round(offset)}px`);
  };

  window.visualViewport?.addEventListener("resize", applyKeyboardOffset);

  Keyboard.addListener("keyboardWillShow", (info) => {
    root.style.setProperty("--kb-duration", "250ms");
    keyboardHeight = info.keyboardHeight;
    applyKeyboardOffset();
    // Лента сообщений подъезжает вверх синхронно с клавиатурой (см. ChatWindow).
    const shift = Math.max(0, keyboardHeight - screenBelowWebView() - Math.max(0, window.innerHeight - (window.visualViewport?.height ?? window.innerHeight)));
    window.dispatchEvent(new CustomEvent("hyax:keyboard", { detail: { height: shift, duration: 250 } }));
    setTimeout(applyKeyboardOffset, 120);
    setTimeout(applyKeyboardOffset, 320);
  });

  Keyboard.addListener("keyboardWillHide", () => {
    root.style.setProperty("--kb-duration", "250ms");
    window.dispatchEvent(new CustomEvent("hyax:keyboard", { detail: { height: 0, duration: 250 } }));
    keyboardHeight = 0;
    root.style.setProperty("--kb-height", "0px");
    window.scrollTo(0, 0);
  });
}
