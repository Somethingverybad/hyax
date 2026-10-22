import { Capacitor } from "@capacitor/core";
import { api } from "@/api/client";
import { dumpLog, applog } from "@/lib/applog";
import { APP_VERSION, APP_BUILD } from "@/lib/appVersion";
import { PLAY_BUILD } from "@/lib/updateCheck";
import { t } from "@/lib/i18n";

/**
 * Ctrl/⌘+Shift+B — отправить лог разработчику откуда угодно, даже когда
 * интерфейс сломался (белый экран после ошибки в React). Поэтому здесь
 * ничего от React: слушатель на window из main.tsx, окошко — голый DOM.
 * Лог и мета — те же, что у экрана «Сообщить об ошибке» (ProfileBugReport).
 */
const HOTKEY_NOTE = "Отправлено хоткеем (Ctrl/⌘+Shift+B)";

let open = false;

function meta() {
  return JSON.stringify({
    platform: Capacitor.getPlatform(),
    app_version: APP_VERSION,
    app_build: APP_BUILD,
    distribution: PLAY_BUILD ? "play" : undefined,
    device: navigator.userAgent,
    screen: `${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}`,
    lang: navigator.language,
    online: navigator.onLine,
    route: location.pathname,
    hotkey: true,
  });
}

async function send(text: string) {
  const fd = new FormData();
  fd.append("description", text.trim() ? `${text.trim()}\n\n${HOTKEY_NOTE}` : HOTKEY_NOTE);
  fd.append("log", dumpLog());
  fd.append("meta", meta());
  await api.sendBugReport(fd);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, style: string, text?: string) {
  const e = document.createElement(tag);
  e.style.cssText = style;
  if (text) e.textContent = text;
  return e;
}

function show() {
  if (open) return;
  open = true;
  const dark = document.documentElement.classList.contains("dark") || matchMedia("(prefers-color-scheme: dark)").matches;
  const bg = dark ? "#1c1f1e" : "#ffffff", fg = dark ? "#e8ece9" : "#111", sub = dark ? "#9aa39e" : "#666";
  const root = el("div", "position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;font:14px/1.4 -apple-system,system-ui,sans-serif;");
  const box = el("div", `background:${bg};color:${fg};border-radius:14px;padding:18px 18px 14px;width:min(460px,calc(100vw - 32px));box-shadow:0 12px 40px rgba(0,0,0,.35);`);
  const title = el("div", "font-size:16px;font-weight:600;margin-bottom:6px;", t("Отправить лог разработчику"));
  const hint = el("div", `color:${sub};margin-bottom:10px;`, t("Уйдёт журнал приложения за эту сессию. Опишите, что случилось (можно пропустить)."));
  const ta = document.createElement("textarea");
  ta.placeholder = t("Что случилось?");
  ta.style.cssText = `width:100%;box-sizing:border-box;min-height:84px;resize:vertical;border:1px solid ${dark ? "#3a3f3d" : "#d8dcd9"};border-radius:10px;padding:8px 10px;background:transparent;color:${fg};font:inherit;outline:none;`;
  const row = el("div", "display:flex;gap:8px;justify-content:flex-end;margin-top:12px;");
  const cancel = el("button", `height:36px;padding:0 14px;border-radius:9px;border:1px solid ${dark ? "#3a3f3d" : "#d8dcd9"};background:transparent;color:${fg};font:inherit;cursor:pointer;`, t("Отмена"));
  const ok = el("button", "height:36px;padding:0 16px;border-radius:9px;border:0;background:#2f5b53;color:#fff;font:inherit;font-weight:600;cursor:pointer;", t("Отправить"));
  const status = el("div", `color:${sub};margin-top:8px;min-height:18px;`);
  row.append(cancel, ok);
  box.append(title, hint, ta, row, status);
  root.append(box);
  document.body.append(root);
  ta.focus();

  const close = () => { open = false; root.remove(); window.removeEventListener("keydown", onKey, true); };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); void go(); }
  };
  window.addEventListener("keydown", onKey, true);
  root.addEventListener("click", (e) => { if (e.target === root) close(); });
  cancel.onclick = close;
  let busy = false;
  const go = async () => {
    if (busy) return;
    busy = true;
    ok.disabled = true;
    status.textContent = t("Отправляю…");
    try {
      await send(ta.value);
      status.textContent = t("Спасибо, репорт ушёл");
      applog.info("bugreport: отправлен хоткеем");
      setTimeout(close, 1200);
    } catch (e) {
      busy = false;
      ok.disabled = false;
      status.textContent = (e as Error)?.message || t("Не удалось отправить");
    }
  };
  ok.onclick = () => void go();
}

/** Повесить хоткей. Вызвать один раз из main.tsx — до React. */
export function installBugHotkey() {
  // На телефонах клавиатуры с Ctrl нет — слушатель не мешает, но и не нужен.
  if (Capacitor.getPlatform() !== "web" && !window.electronAPI) return;
  window.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.code !== "KeyB" || e.repeat) return;
    e.preventDefault();
    e.stopPropagation();
    show();
  }, true);
}
