import { Capacitor, registerPlugin } from "@capacitor/core";
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
/** Тяжёлое дело, начатое и не законченное (crashMark): что делали в момент падения. */
const BUSY_KEY = "hyax:busy";
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

/** Сохранить хвост журнала сейчас — перед тем, что может уронить WebView
 *  (распаковка большого фото): иначе последние секунды до падения теряются. */
export function flushCrashLog() { saveLog(true); }

type Busy = { what: string; t: number };
/** Отметить начало тяжёлого дела; упадёт посреди — отметка попадёт в автоотчёт. */
export function crashMark(what: string) {
  saveLog(true);
  try { localStorage.setItem(BUSY_KEY, JSON.stringify({ what, t: Date.now() } satisfies Busy)); } catch { /* без отметки */ }
}
export function crashUnmark() {
  try { localStorage.removeItem(BUSY_KEY); } catch { /* нечего снимать */ }
}

/** Записи нативной части о гибели процесса WebView (WebDiagPlugin.swift / .java). */
type NativeDiag = {
  kind: "terminated" | "renderGone"; t: number; state?: string; availMB?: number;
  memWarnings?: number; lastWarningAgoS?: number; thermal?: string; lowPower?: boolean;
  didCrash?: boolean; priority?: number; lowMemory?: boolean; path?: string; n?: number;
};
const webDiag = registerPlugin<{ take(): Promise<{ items: NativeDiag[] }> }>("WebDiag");

/** null — спросить не у кого (браузер, компьютер, старая сборка без плагина). */
async function takeNativeDiag(): Promise<NativeDiag[] | null> {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const r = await Promise.race([webDiag.take(), new Promise<never>((_, no) => setTimeout(() => no(new Error("timeout")), 1500))]);
    return Array.isArray(r?.items) ? r.items : [];
  } catch { return null; /* старая нативная сборка без плагина */ }
}

const STATE: Record<string, string> = { active: "на экране", inactive: "на экране, неактивно", background: "в фоне" };

function describeDiag(d: NativeDiag): string {
  const at = new Date(d.t).toLocaleTimeString("ru-RU");
  const what = d.kind === "renderGone"
    ? (d.didCrash === false ? "процесс WebView убит системой" : d.didCrash ? "процесс WebView упал" : "процесс WebView пропал")
    : "процесс WebView убит системой";
  const parts = [d.state ? STATE[d.state] ?? d.state : null];
  if (d.availMB != null) parts.push(d.kind === "renderGone" ? `свободно в системе ${d.availMB} МБ` : `приложению свободно ${d.availMB} МБ`);
  if (d.lowMemory) parts.push("система: мало памяти");
  if (d.memWarnings) parts.push(`предупреждений о памяти за минуту: ${d.memWarnings}${d.lastWarningAgoS != null ? `, последнее за ${d.lastWarningAgoS} с` : ""}`);
  if (d.thermal && d.thermal !== "nominal") parts.push(`нагрев ${d.thermal}`);
  if (d.lowPower) parts.push("энергосбережение");
  if (d.path) parts.push(d.path);
  return `${at} ${what} (${parts.filter(Boolean).join("; ")})`;
}

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
  let busy: Busy | null = null;
  try { busy = JSON.parse(localStorage.getItem(BUSY_KEY) || "null"); localStorage.removeItem(BUSY_KEY); } catch { /* нет */ }
  // Записи нативной части — и без автоотчёта в журнал: WebView мог умереть в
  // фоне, тогда это увидит следующий баг-репорт.
  const native = takeNativeDiag().then((list) => {
    for (const d of list ?? []) applog.warn(`webdiag: ${describeDiag(d)}`);
    return list;
  });

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
    if (busy) applog.warn(`crashguard: в момент падения — ${busy.what}`);
    // Пусть сначала встанет интерфейс — окошко поверх готового экрана.
    window.setTimeout(() => void native.then((list) => {
      const lines = ["Автоотчёт о падении: прошлый запуск оборвался, пока приложение было на экране"];
      if (busy) lines.push(`В момент падения: ${busy.what}`);
      if (list?.length) lines.push(...list.map((d) => `Нативная часть: ${describeDiag(d)}`));
      else if (list) lines.push("Нативная часть: WebView не умирал — закрылось всё приложение или его выгрузила система");
      showBugReportDialog({
        title: t("Похоже, в прошлый раз WYX упал"),
        hint: t("Отправить разработчику журнал того запуска? Можно написать, что вы делали перед этим (необязательно)."),
        cancel: t("Не надо"),
        log,
        note: lines.join("\n"),
        meta: { crash: true, crash_version: p.v, crash_at: new Date(p.t).toISOString(), ...(busy ? { crash_busy: busy.what } : {}), ...(list?.length ? { webdiag: list } : {}) },
      });
    }), 2500);
  }
}
