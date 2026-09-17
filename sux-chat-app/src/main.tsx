import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initTheme } from "./lib/theme";
import { installAppLog, applog } from "./lib/applog";

// Лог баг-репортов — с самого старта, чтобы поймать и ошибки инициализации.
installAppLog();
// Тему ставим до первой отрисовки: иначе светлая тема моргнёт тёмным кадром.
initTheme();

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
import { screenBelowWebView, watchSafeArea, imeOverlap, onInsetsChange, refreshSafeArea, webViewHeight } from "./lib/safeArea";

watchSafeArea();

if (Cap.isNativePlatform()) {
  const root = document.documentElement;

  if (Cap.getPlatform() === "android") {
    // Плагинный KeyboardResize.Native выключен: он ужимал WebView поверх
    // системного ресайза, и получался двойной сдвиг — интерфейс улетал вверх, а
    // между панелью ввода и клавиатурой зияла пустота.
    //
    // А вот сам системный ресайз (windowSoftInputMode=adjustResize) от прошивки
    // к прошивке разный, и предсказать его нельзя. На одном телефоне окно во
    // весь экран под клавиатуру не ужимается вовсе — измеряли: клавиатура
    // открыта, а visualViewport остаётся 762px. На другом ужимается, и тогда
    // сдвигать панель ввода второй раз нельзя. Поэтому здесь ничего не
    // предполагаем: сколько поднимать, решает измеренное перекрытие (ниже).
    Keyboard.setResizeMode({ mode: KeyboardResize.None }).catch(() => {});
  }

  // Насколько поднять панель ввода над клавиатурой.
  //
  // Считаем в координатах РАСКЛАДКИ, а не экрана, и только то, что раскладка не
  // отработала сама. Ключ к универсальности: под клавиатуру страницу ужимают
  // три разные силы, и на каждом телефоне работает своя комбинация — система
  // ужимает окно, браузер ужимает visualViewport (а за ним --app-height, см.
  // syncAppHeight выше), либо не происходит ни того ни другого. Считать «на
  // сколько поднять» по высоте клавиатуры значит молча предположить, что не
  // сработала ни одна из них, — и на Xiaomi это давало двойной сдвиг: панель
  // ввода зависала на высоту клавиатуры выше неё.
  //
  // Поэтому находим верхнюю кромку клавиатуры в координатах раскладки и
  // сдвигаем ровно на то, насколько низ видимой области её перекрывает. Когда
  // страница ужалась сама — разность нулевая и двигать нечего; когда не
  // ужалась — разность равна высоте клавиатуры. Одна формула на все случаи.
  let keyboardHeight = 0;
  let lastOffset = -1;
  let lastTrace = "";

  const keyboardOffset = () => {
    const visible = window.visualViewport?.height ?? window.innerHeight;
    // Перекрытие клавиатуры с WebView. На Android 11+ это измерение
    // (см. InsetsPlugin.java), иначе — расчёт: высота от плагина считается от
    // низа экрана, а под WebView остаётся полоса навигации.
    const measured = imeOverlap();
    const overlap = measured >= 0
      ? measured
      : Math.max(0, keyboardHeight - screenBelowWebView());
    // Кромку считаем от высоты WebView, а не от innerHeight: с
    // interactive-widget=resizes-content раскладка ужимается под клавиатуру,
    // а перекрытие измерено нативно от полной высоты WebView.
    const webH = webViewHeight();
    const keyboardTop = (webH > 0 ? webH : window.innerHeight) - overlap;
    const offset = Math.max(0, visible - keyboardTop);
    // Телеметрия для баг-репорта: по этим числам видно, какая из трёх сил
    // ужала страницу и почему панель встала туда, куда встала. vvTop —
    // панорама визуального viewport (на vivo уносила интерфейс). Пишем только
    // при изменении, чтобы не засорять лог.
    const vvTop = Math.round(window.visualViewport?.offsetTop ?? 0);
    const trace = `kb vv=${Math.round(visible)} vvTop=${vvTop} inner=${window.innerHeight} webH=${webH > 0 ? Math.round(webH) : "n/a"} ime=${measured >= 0 ? Math.round(measured) : "n/a"} kbH=${Math.round(keyboardHeight)} below=${Math.round(screenBelowWebView())} → ${Math.round(offset)}`;
    if (trace !== lastTrace) { lastTrace = trace; applog.info(trace); }
    return offset;
  };

  const applyKeyboardOffset = () => {
    const offset = Math.round(keyboardOffset());
    // Отступ под полосу навигации, пока клавиатура открыта, не нужен: полоса за
    // ней. Иначе внутри панели ввода оставалась пустая полка в её высоту.
    const keyboardUp = keyboardHeight > 0 || offset > 0 || (window.visualViewport?.height ?? window.innerHeight) < window.innerHeight - 40;
    root.style.setProperty("--kb-sab", keyboardUp ? "0px" : "var(--sab)");
    // Панорама визуального viewport — компенсируем сдвигом корня (см. index.css).
    root.style.setProperty("--vv-top", `${Math.round(window.visualViewport?.offsetTop ?? 0)}px`);
    if (offset === lastOffset) return;
    lastOffset = offset;
    root.style.setProperty("--kb-height", `${offset}px`);
    // Лента сообщений подъезжает вверх синхронно с клавиатурой (см. ChatWindow).
    window.dispatchEvent(new CustomEvent("hyax:keyboard", { detail: { height: offset, duration: 250 } }));
  };

  // После show/hide значения приходят вразнобой: сначала может прийти
  // перекрытие, и только потом ужаться viewport — мгновенный расчёт в этот
  // момент даёт полный сдвиг, который через кадр надо откатывать (панель
  // «отлетает» и возвращается). Поэтому не верим одиночному замеру: опрашиваем
  // каждые 60 мс и применяем значение, только когда два замера подряд совпали.
  // По истечении окна применяем последнее — на прошивках, где ничего не
  // меняется после первого кадра, это ровно тот же результат.
  let settleTimer: ReturnType<typeof setInterval> | null = null;
  const settle = () => {
    if (settleTimer) clearInterval(settleTimer);
    let prev = -1, ticks = 0;
    settleTimer = setInterval(() => {
      const cur = Math.round(keyboardOffset());
      ticks += 1;
      if (cur === prev || ticks >= 12) {
        applyKeyboardOffset();
        if (ticks >= 12 || cur === prev) { clearInterval(settleTimer!); settleTimer = null; }
      }
      prev = cur;
    }, 60);
  };

  window.visualViewport?.addEventListener("resize", settle);
  // Панорама приходит событием scroll визуального viewport, не resize.
  window.visualViewport?.addEventListener("scroll", settle);
  // Инсеты приходят из нативного плагина асинхронно — пересчитываем по ответу.
  onInsetsChange(settle);

  Keyboard.addListener("keyboardWillShow", (info) => {
    root.style.setProperty("--kb-duration", "250ms");
    keyboardHeight = info.keyboardHeight;
    applog.info(`kb show h=${Math.round(info.keyboardHeight)}`);
    // Перекрытие меряем заново: без этого на Android оно осталось бы прежним —
    // visualViewport при открытии клавиатуры срабатывает не на всех прошивках.
    refreshSafeArea();
    settle();
  });

  Keyboard.addListener("keyboardWillHide", () => {
    root.style.setProperty("--kb-duration", "250ms");
    keyboardHeight = 0;
    applog.info("kb hide");
    refreshSafeArea();
    settle();
    window.scrollTo(0, 0);
  });
}
