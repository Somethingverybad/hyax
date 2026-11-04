import { applog, dumpLog, logVersion } from "@/lib/applog";
import { APP_BUILD, APP_VERSION } from "@/lib/appVersion";
import { showBugReportDialog } from "@/lib/bugHotkey";
import { t } from "@/lib/i18n";

/**
 * «Чёрный ящик»: если приложение упало целиком (окно компьютера, WebView
 * телефона, зависание и убийство системой), журнал того запуска в памяти
 * пропадает вместе с ним. Поэтому хвост журнала (TAIL записей, уже без
 * секретов — applog.redact) сохраняем на устройстве каждые несколько секунд
 * и сразу при ошибке, а рядом — отметку «жив и на экране».
 *
 * Падение — когда прошлый запуск оборвался, пока приложение было на экране:
 * без ухода в фон и без нормального закрытия (pagehide). Смахнуть из списка
 * приложений — это сначала уход в фон, а закрыть окно, перезагрузиться ради
 * обновления (lib/ota) — pagehide; ни то ни другое падением не считается.
 * Тогда при следующем запуске предлагаем отправить журнал прошлого запуска
 * тем же окошком, что и Ctrl/⌘+Shift+B (lib/bugHotkey) — только с согласия.
 */
const LOG_KEY = "hyax:crashlog";
const BEAT_KEY = "hyax:beat";
const TAIL = 300;
/** Старше — уже не вспомнить, что было; не спрашиваем. */
const FRESH_MS = 3 * 86400_000;

type Beat = { t: number; on: boolean; ok?: boolean; v: string };

const version = `${APP_VERSION}-${APP_BUILD}`;
let savedAt = -1;

function saveLog(force = false) {
  const v = logVersion();
  if (!force && v === savedAt) return;
  savedAt = v;
  try { localStorage.setItem(LOG_KEY, dumpLog(TAIL)); } catch { /* места нет или приватный режим */ }
}

function beat(ok = false) {
  const b: Beat = { t: Date.now(), on: document.visibilityState === "visible", v: version, ...(ok ? { ok: true } : {}) };
  try { localStorage.setItem(BEAT_KEY, JSON.stringify(b)); } catch { /* без памяти — без чёрного ящика */ }
}

/** Нормальное завершение: закрыли окно, перезагрузка ради обновления. */
function cleanExit() { saveLog(true); beat(true); }

let installed = false;

/** Вызвать один раз из main.tsx — после installAppLog. */
export function installCrashGuard() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  // Сначала — что осталось от прошлого запуска: дальше его перезапишет этот.
  let prev: Beat | null = null, prevLog: string | null = null;
  try {
    prev = JSON.parse(localStorage.getItem(BEAT_KEY) || "null");
    prevLog = localStorage.getItem(LOG_KEY);
  } catch { /* битая запись — как будто не было */ }
  const crashed = !!prev && !prev.ok && prev.on && Date.now() - prev.t < FRESH_MS && !!prevLog;

  beat();
  saveLog(true);
  window.setInterval(() => { if (document.visibilityState === "visible") { beat(); saveLog(); } }, 5000);
  document.addEventListener("visibilitychange", () => { beat(); saveLog(true); });
  window.addEventListener("pagehide", cleanExit);
  window.addEventListener("beforeunload", cleanExit);
  window.addEventListener("error", () => saveLog(true));
  window.addEventListener("unhandledrejection", () => saveLog(true));

  if (crashed && prev && prevLog) {
    const p = prev, log = prevLog;
    applog.warn(`crashguard: прошлый запуск (${p.v}) оборвался на экране`);
    // Пусть сначала встанет интерфейс — окошко поверх готового экрана.
    window.setTimeout(() => showBugReportDialog({
      title: t("Похоже, в прошлый раз WYX упал"),
      hint: t("Отправить разработчику журнал того запуска? Можно написать, что вы делали перед этим (необязательно)."),
      cancel: t("Не надо"),
      log,
      note: "Автоотчёт о падении: прошлый запуск оборвался, пока приложение было на экране",
      meta: { crash: true, crash_version: p.v, crash_at: new Date(p.t).toISOString() },
    }), 2500);
  }
}
