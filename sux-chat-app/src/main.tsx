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

if (Cap.isNativePlatform()) {
  const root = document.documentElement;

  if (Cap.getPlatform() === "android") {
    // Android: пусть WebView нативно сжимается вместе с клавиатурой
    // (windowSoftInputMode=adjustResize + KeyboardResize.Native). Ручной сдвиг,
    // как на iOS, здесь только вредил — окно и так поднималось, и интерфейс
    // «улетал» вверх. --app-height следит за visualViewport (syncAppHeight),
    // а --kb-height держим нулевым: панель ввода и так оказывается над
    // клавиатурой на дне сжавшегося WebView.
    root.style.setProperty("--kb-height", "0px");
    Keyboard.setResizeMode({ mode: KeyboardResize.Native }).catch(() => {});
  } else {
    // iOS: WebView не ресайзим (resize:'none'), а синхронно двигаем панель
    // ввода сами — плагин присылает высоту и длительность до анимации.
    let keyboardHeight = 0;
    const applyKeyboardOffset = () => {
      const visible = window.visualViewport?.height ?? window.innerHeight;
      const alreadyShrunk = Math.max(0, window.innerHeight - visible);
      const offset = Math.max(0, keyboardHeight - alreadyShrunk);
      root.style.setProperty("--kb-height", `${Math.round(offset)}px`);
    };

    window.visualViewport?.addEventListener("resize", applyKeyboardOffset);

    Keyboard.addListener("keyboardWillShow", (info) => {
      root.style.setProperty("--kb-duration", "250ms");
      keyboardHeight = info.keyboardHeight;
      applyKeyboardOffset();
      setTimeout(applyKeyboardOffset, 120);
      setTimeout(applyKeyboardOffset, 320);
    });

    Keyboard.addListener("keyboardWillHide", () => {
      root.style.setProperty("--kb-duration", "250ms");
      keyboardHeight = 0;
      root.style.setProperty("--kb-height", "0px");
      window.scrollTo(0, 0);
    });
  }
}
