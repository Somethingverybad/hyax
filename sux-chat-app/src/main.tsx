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
// Поворот экрана: WKWebView шлёт resize раньше, чем обновит размеры viewport,
// и высота приложения оставалась от прежней ориентации — раскладка не
// возвращалась после поворота обратно. Перемеряем ещё несколько раз, пока
// система доводит размеры.
window.addEventListener("orientationchange", () => {
  for (const ms of [0, 120, 350, 700]) window.setTimeout(syncAppHeight, ms);
});

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
import { Capacitor as Cap, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
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
  // iOS: кадр клавиатуры приходит из своего плагина KeyboardSync — тогда
  // штатный путь ниже только пишет лог.
  let iosSync = false;
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

  // Панорама визуального viewport — компенсируем сдвигом корня (см. index.css)
  // СИНХРОННО, в обработчике события, а не через стабилизатор: это чистое
  // измерение, ждать тут нечего, а каждые 60 мс ожидания — кадры, в которых
  // Chrome уже увёз содержимое вверх, а корень ещё не сдвинут. На Redmi
  // панорама 0→173 занимала ~100 мс, и панель проваливалась на эти 173 px,
  // пока стабилизатор не догонял.
  let lastPan = -1;
  const syncPan = () => {
    const top = Math.round(window.visualViewport?.offsetTop ?? 0);
    if (top === lastPan) return;
    lastPan = top;
    root.style.setProperty("--vv-top", `${top}px`);
  };


  const applyKeyboardOffset = () => {
    const offset = Math.round(keyboardOffset());
    // Отступ под полосу навигации, пока клавиатура открыта, не нужен: полоса за
    // ней. Иначе внутри панели ввода оставалась пустая полка в её высоту.
    const keyboardUp = keyboardHeight > 0 || offset > 0 || (window.visualViewport?.height ?? window.innerHeight) < window.innerHeight - 40;
    if (iosSync) return; // на iOS кадр клавиатуры ведёт KeyboardSync (ниже)
    root.style.setProperty("--kb-sab", keyboardUp ? "0px" : "var(--sab)");
    syncPan();
    if (offset === lastOffset) return;
    lastOffset = offset;
    // Событие — ДО изменения --kb-height: лента должна успеть замерить, где
    // она стоит сейчас, пока отступ под клавиатуру ещё прежний. Раньше замер
    // брался из последнего события прокрутки, и если с тех пор пришли новые
    // сообщения, лента прыгала на разницу (в баг-репорте — на 393 px).
    window.dispatchEvent(new CustomEvent("hyax:keyboard", { detail: { height: offset, duration: 250 } }));
    root.style.setProperty("--kb-height", `${offset}px`);
  };

  // После show/hide значения приходят вразнобой: сначала может прийти
  // перекрытие, и только потом ужаться viewport — мгновенный расчёт в этот
  // момент даёт полный сдвиг, который через кадр надо откатывать (панель
  // «отлетает» и возвращается). Поэтому не верим одиночному замеру: опрашиваем
  // каждые 60 мс и применяем значение, только когда два замера подряд совпали.
  // По истечении окна применяем последнее — на прошивках, где ничего не
  // меняется после первого кадра, это ровно тот же результат.
  // Viewport на момент keyboardWillShow: пока он не изменился, состояние
  // «клавиатура открывается» ещё не отражено в раскладке, и формула даёт
  // ложный полный сдвиг. На vivo нативное перекрытие приходит раньше, чем
  // Chrome ужимает viewport, — и панель подпрыгивала на высоту клавиатуры,
  // а через кадр опускалась. Положительный сдвиг применяем, только когда
  // viewport (высота или панорама) сдвинулся с исходного — либо когда окно
  // ожидания истекло: есть прошивки, где он не меняется вовсе.
  let vvAtShow = -1;
  let vvTopAtShow = -1;
  const viewportMoved = () => {
    const vv = Math.round(window.visualViewport?.height ?? window.innerHeight);
    const top = Math.round(window.visualViewport?.offsetTop ?? 0);
    return vvAtShow < 0 || vv !== vvAtShow || top !== vvTopAtShow;
  };
  const MAX_TICKS = 14; // 14 × 60 мс ≈ 840 мс — дольше любой анимации клавиатуры

  // iOS: вся осторожность выше там не нужна и вредна. Режим ресайза выключен,
  // viewport под клавиатуру не меняется НИКОГДА, сдвиг всегда равен высоте
  // клавиатуры из keyboardWillShow. Правило «ждём, пока viewport сдвинется»
  // (сделано под vivo) на iOS не выполнялось вовсе, и поле ввода уезжало по
  // таймауту — через ~840 мс после клавиатуры. Поэтому на iOS применяем сдвиг
  // сразу, в самом обработчике: переход 250 мс стартует вместе с системной
  // анимацией клавиатуры.
  const isIOS = Cap.getPlatform() === "ios";

  let settleTimer: ReturnType<typeof setInterval> | null = null;
  const settle = () => {
    if (settleTimer) clearInterval(settleTimer);
    let prev = -1, ticks = 0;
    settleTimer = setInterval(() => {
      const cur = Math.round(keyboardOffset());
      ticks += 1;
      const timedOut = ticks >= MAX_TICKS;
      // Нулевой сдвиг безопасен всегда; ненулевой — только по подтверждённому
      // viewport или по таймауту.
      const trustworthy = isIOS || cur === 0 || viewportMoved() || timedOut;
      if (trustworthy && (cur === prev || timedOut)) {
        applyKeyboardOffset();
        clearInterval(settleTimer!); settleTimer = null;
      }
      prev = cur;
    }, 60);
  };

  window.visualViewport?.addEventListener("resize", () => { syncPan(); settle(); });
  // Панорама приходит событием scroll визуального viewport, не resize.
  window.visualViewport?.addEventListener("scroll", () => { syncPan(); settle(); });
  // Инсеты приходят из нативного плагина асинхронно — пересчитываем по ответу.
  onInsetsChange(settle);

  // ── iOS: панель ввода едет вместе с клавиатурой ─────────────────────────
  // Кривые и длительности измерены по видео симулятора (кадры клавиатуры
  // iOS 26): системная анимация — пружина, и cubic-bezier её повторяет с
  // точностью до пикселя. Штатные 250 мс и «средняя» кривая давали панель,
  // которая стартовала поздно и приезжала раньше клавиатуры.
  //
  // Опоздание моста (событие доходит до JS через 2–4 кадра после старта
  // клавиатуры) снимаем отрицательной задержкой перехода: анимация стартует
  // «с середины», там, где клавиатура уже находится.
  //
  // Нижний отступ панели под home-индикатор здесь не обнуляется, как в
  // штатном пути: это меняло раскладку в нулевом кадре, и панель дёргалась.
  // Вместо этого подъём — на высоту клавиатуры минус этот отступ (--kb-lift):
  // итог тот же, но двигается только transform.
  const IOS_OPEN = { ms: 375, ease: "cubic-bezier(0.38, 0.8, 0.125, 1)" };
  const IOS_CLOSE = { ms: 425, ease: "cubic-bezier(0.3, 1, 0.3, 1)" };
  const iosKeyboard = (d: { height: number; ts: number }) => {
    const h = Math.max(0, Math.round(d.height));
    if (h === lastOffset) return;
    const a = h > Math.max(0, lastOffset) ? IOS_OPEN : IOS_CLOSE;
    const late = Math.min(Math.max(0, Date.now() - d.ts), a.ms - 16);
    lastOffset = h;
    keyboardHeight = h;
    applog.info(`kbsync h=${h} late=${Math.round(late)}ms`);
    // Стиль — прямо на панели ввода и ленте, а не переменными на :root.
    // Переменная на корне наследуется всем деревом: браузер пересчитывал
    // стили всего документа со всеми сообщениями ленты, и первый кадр после
    // события рисовался 75–170 мс — панель стояла, пока клавиатура уезжала.
    const lift = `max(0px, calc(${h}px - var(--sab)))`;
    const tr = `transform ${a.ms}ms ${a.ease} ${-Math.round(late)}ms`;
    // Событие — до смены отступа: лента замеряет, где стоит сейчас (ChatWindow).
    window.dispatchEvent(new CustomEvent("hyax:keyboard", { detail: { height: h, duration: a.ms, ease: a.ease, ts: d.ts } }));
    document.querySelectorAll<HTMLElement>(".pad-safe-bottom").forEach((el) => {
      el.style.transition = tr;
      el.style.transform = h ? `translateY(calc(-1 * ${lift}))` : "translateY(0)";
    });
    document.querySelectorAll<HTMLElement>(".chat-scroll").forEach((el) => {
      el.style.paddingBottom = h ? lift : "";
    });
  };
  if (isIOS) {
    const KeyboardSync = registerPlugin<{
      addListener(e: "change", cb: (d: { height: number; duration: number; curve: number; ts: number }) => void): Promise<PluginListenerHandle>;
    }>("KeyboardSync");
    KeyboardSync.addListener("change", iosKeyboard)
      .then(() => { iosSync = true; root.style.setProperty("--kb-sab", "var(--sab)"); })
      .catch(() => { /* старая нативная сборка без плагина — остаётся штатный путь */ });
  }

  Keyboard.addListener("keyboardWillShow", (info) => {
    if (iosSync) { applog.info(`kb show h=${Math.round(info.keyboardHeight)}`); return; }
    root.style.setProperty("--kb-duration", "250ms");
    keyboardHeight = info.keyboardHeight;
    vvAtShow = Math.round(window.visualViewport?.height ?? window.innerHeight);
    vvTopAtShow = Math.round(window.visualViewport?.offsetTop ?? 0);
    applog.info(`kb show h=${Math.round(info.keyboardHeight)} vv0=${vvAtShow}`);
    // Перекрытие меряем заново: без этого на Android оно осталось бы прежним —
    // visualViewport при открытии клавиатуры срабатывает не на всех прошивках.
    refreshSafeArea();
    if (isIOS) applyKeyboardOffset();
    settle();
  });

  Keyboard.addListener("keyboardWillHide", () => {
    if (iosSync) { applog.info("kb hide"); return; }
    root.style.setProperty("--kb-duration", "250ms");
    keyboardHeight = 0;
    vvAtShow = -1; vvTopAtShow = -1;
    applog.info("kb hide");
    refreshSafeArea();
    if (isIOS) applyKeyboardOffset();
    settle();
    window.scrollTo(0, 0);
  });
}
