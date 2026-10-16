/*
 * WYX Mini Apps SDK — подключается страницей мини-приложения:
 *   <script src="https://huyax.e-tree.su/wyx-webapp.js"></script>
 * и даёт window.WYX.WebApp. Документация: https://huyax.e-tree.su/media/apk/bots.html#webapp
 *
 * Страница открыта во встроенном окне WYX; с приложением общается через
 * postMessage. Данные запуска (кто открыл) приходят в адресе страницы после
 * «#» — их можно прочитать сразу, без ожидания: WYX.WebApp.initData.
 */
(function () {
  "use strict";
  if (window.WYX && window.WYX.WebApp) return;

  var VERSION = "1.0";
  var hash = new URLSearchParams((location.hash || "").replace(/^#/, ""));
  var initData = hash.get("wyxWebAppData") || "";
  var platform = hash.get("wyxWebAppPlatform") || "unknown";
  var themeParams = {};
  try { themeParams = JSON.parse(hash.get("wyxWebAppThemeParams") || "{}") || {}; } catch (e) { themeParams = {}; }

  // Разбор данных запуска «для показа» (без проверки подписи — её делает сервер бота).
  var initDataUnsafe = {};
  try {
    new URLSearchParams(initData).forEach(function (v, k) {
      if (k === "user") { try { initDataUnsafe.user = JSON.parse(v); } catch (e) { initDataUnsafe.user = null; } }
      else if (k === "auth_date") initDataUnsafe.auth_date = Number(v);
      else initDataUnsafe[k] = v;
    });
  } catch (e) { /* пусто — открыто вне WYX */ }

  var inWyx = window.parent && window.parent !== window && !!initData;
  function post(method, params) {
    if (!inWyx) return;
    window.parent.postMessage({ wyx: "webapp", method: method, params: params || {} }, "*");
  }

  var handlers = {};
  function on(event, cb) { (handlers[event] = handlers[event] || []).push(cb); }
  function off(event, cb) { handlers[event] = (handlers[event] || []).filter(function (f) { return f !== cb; }); }
  function emit(event, data) { (handlers[event] || []).slice().forEach(function (f) { try { f(data); } catch (e) { setTimeout(function () { throw e; }); } }); }

  // Цвета темы WYX — переменными CSS: --wyx-bg-color, --wyx-text-color, …
  function applyTheme() {
    var root = document.documentElement;
    Object.keys(themeParams).forEach(function (k) { root.style.setProperty("--wyx-" + k.replace(/_/g, "-"), themeParams[k]); });
  }
  applyTheme();

  var popupId = 0, popups = {};

  var mainButton = {
    text: "Продолжить", color: themeParams.button_color || "", textColor: themeParams.button_text_color || "",
    isVisible: false, isActive: true, isProgressVisible: false,
    setText: function (t) { mainButton.text = String(t || ""); sync(); return mainButton; },
    setParams: function (p) {
      p = p || {};
      if (p.text != null) mainButton.text = String(p.text);
      if (p.color != null) mainButton.color = p.color;
      if (p.text_color != null) mainButton.textColor = p.text_color;
      if (p.is_visible != null) mainButton.isVisible = !!p.is_visible;
      if (p.is_active != null) mainButton.isActive = !!p.is_active;
      sync(); return mainButton;
    },
    show: function () { mainButton.isVisible = true; sync(); return mainButton; },
    hide: function () { mainButton.isVisible = false; sync(); return mainButton; },
    enable: function () { mainButton.isActive = true; sync(); return mainButton; },
    disable: function () { mainButton.isActive = false; sync(); return mainButton; },
    showProgress: function () { mainButton.isProgressVisible = true; sync(); return mainButton; },
    hideProgress: function () { mainButton.isProgressVisible = false; sync(); return mainButton; },
    onClick: function (cb) { on("mainButtonClicked", cb); return mainButton; },
    offClick: function (cb) { off("mainButtonClicked", cb); return mainButton; }
  };
  function sync() {
    post("setMainButton", { text: mainButton.text, visible: mainButton.isVisible, active: mainButton.isActive,
      progress: mainButton.isProgressVisible, color: mainButton.color, text_color: mainButton.textColor });
  }

  var backButton = {
    isVisible: false,
    show: function () { backButton.isVisible = true; post("setBackButton", { visible: true }); return backButton; },
    hide: function () { backButton.isVisible = false; post("setBackButton", { visible: false }); return backButton; },
    onClick: function (cb) { on("backButtonClicked", cb); return backButton; },
    offClick: function (cb) { off("backButtonClicked", cb); return backButton; }
  };

  function popup(kind, message, cb) {
    var id = ++popupId;
    if (cb) popups[id] = cb;
    post("showPopup", { id: id, kind: kind, message: String(message || "").slice(0, 500) });
  }

  var WebApp = {
    version: VERSION,
    platform: platform,
    initData: initData,
    initDataUnsafe: initDataUnsafe,
    themeParams: themeParams,
    colorScheme: themeParams.color_scheme || "light",
    isExpanded: true,
    MainButton: mainButton,
    BackButton: backButton,
    HapticFeedback: {
      impactOccurred: function (style) { post("haptic", { type: "impact", style: style || "medium" }); return WebApp.HapticFeedback; },
      notificationOccurred: function (type) { post("haptic", { type: "notification", style: type || "success" }); return WebApp.HapticFeedback; },
      selectionChanged: function () { post("haptic", { type: "selection" }); return WebApp.HapticFeedback; }
    },
    /** Страница готова — WYX убирает заставку загрузки. */
    ready: function () { post("ready"); },
    expand: function () { post("expand"); },
    close: function () { post("close"); },
    /** Отправить боту строку до 4096 символов (событие web_app_data); окно закроется. */
    sendData: function (data) { post("sendData", { data: String(data == null ? "" : data) }); },
    /** Открыть ссылку в браузере (не внутри мини-приложения). */
    openLink: function (url) { post("openLink", { url: String(url || "") }); },
    showAlert: function (message, cb) { popup("alert", message, cb ? function () { cb(); } : null); },
    showConfirm: function (message, cb) { popup("confirm", message, cb); },
    onEvent: on,
    offEvent: off
  };

  window.addEventListener("message", function (e) {
    if (e.source !== window.parent) return;
    var d = e.data;
    if (!d || d.wyx !== "webapp" || !d.event) return;
    if (d.event === "themeChanged" && d.data) {
      themeParams = d.data; WebApp.themeParams = themeParams; WebApp.colorScheme = themeParams.color_scheme || WebApp.colorScheme;
      applyTheme();
    }
    if (d.event === "popupClosed" && d.data) {
      var cb = popups[d.data.id]; delete popups[d.data.id];
      if (cb) cb(d.data.result);
    }
    emit(d.event, d.data);
  });

  window.WYX = window.WYX || {};
  window.WYX.WebApp = WebApp;
})();
