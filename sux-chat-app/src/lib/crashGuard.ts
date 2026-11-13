import { Capacitor, registerPlugin } from "@capacitor/core";
import { App } from "@capacitor/app";
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
 * На Android приложение в «недавних» бывает живой плиткой и смахивается, не
 * уйдя в фон, — там спрашиваем у системы, как закончился прошлый процесс
 * (WebDiag.take → exit, Android 11+): закрыл человек или система выгрузила
 * уже фоновый процесс (exitInBackground) — не падение.
 * Тогда при следующем запуске предлагаем отправить журнал прошлого запуска
 * тем же окошком, что и Ctrl/⌘+Shift+B (lib/bugHotkey) — только с согласия.
 */
const LOG_KEY = "hyax:crashlog";
const BEAT_KEY = "hyax:beat";
/** Тяжёлое дело, начатое и не законченное (crashMark): что делали в момент падения. */
const BUSY_KEY = "hyax:busy";
/** sessionStorage: страница уже жила в этом окне (перезагрузка), а не новый запуск приложения. */
const SESSION_KEY = "hyax:session";
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

/** Приложение активно. В переключателе приложений iPhone страница остаётся
 *  «видимой», пока приложение не ушло в фон, — смахнули его оттуда, и
 *  следующий запуск считал это падением (баг-репорты f0a243bf, 34390d1f:
 *  «он не упал, это я его закрыл»). Неактивное — уже не «на экране». */
let appActive = true;

function beat(ok = false) {
  const b: Beat = { t: Date.now(), on: document.visibilityState === "visible" && appActive, v: version, ...(ok ? { ok: true } : {}) };
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
/** Как система закрыла прошлый процесс (Android 11+, ApplicationExitInfo). */
type NativeExit = { reason: number; t: number; importance?: number; status?: number; desc?: string };
const webDiag = registerPlugin<{ take(): Promise<{ items: NativeDiag[]; exit?: NativeExit }> }>("WebDiag");

/** items null — спросить не у кого (браузер, компьютер, старая сборка без плагина). */
async function takeNativeDiag(): Promise<{ items: NativeDiag[] | null; exit?: NativeExit }> {
  if (!Capacitor.isNativePlatform()) return { items: null };
  try {
    const r = await Promise.race([webDiag.take(), new Promise<never>((_, no) => setTimeout(() => no(new Error("timeout")), 1500))]);
    return { items: Array.isArray(r?.items) ? r.items : [], exit: r?.exit };
  } catch { return { items: null }; /* старая нативная сборка без плагина */ }
}

const EXIT_NAME: Record<number, string> = {
  1: "вышло само", 2: "убито сигналом", 3: "мало памяти", 4: "падение", 5: "падение нативного кода", 6: "не отвечало (ANR)",
  7: "не запустилось", 8: "сменили разрешения", 9: "слишком много ресурсов", 10: "закрыто пользователем", 11: "остановлено пользователем",
  12: "упала зависимость", 13: "другое", 14: "заморожено", 15: "пакет изменён", 16: "обновление",
};
/** Не падение: смахнули из недавних, остановили в настройках, обновили, сменили разрешения. */
const exitByUser = (e: NativeExit) => [8, 10, 11, 15, 16].includes(e.reason) || /remove task|swipe/i.test(e.desc || "");
/** Не падение: система выгрузила процесс, когда приложения на экране уже не
 *  было (важность ≥ 300 — служба или кэш фоновых, на экране — 100…230), и не
 *  из-за сбоя (падение, падение нативного кода, ANR — 4, 5, 6 — отчёт нужен
 *  и в фоне). Отметка «на экране» тогда — устаревшая: страницу заморозили
 *  сразу после ухода в фон, и отметка об уходе не успела лечь в localStorage
 *  (баг-репорт fff19955, Honor: журнал кончается на «visibility visible»,
 *  а система — «другое; empty for too long; важность 400»: окна уже нет,
 *  пустой процесс выгружен по сроку). */
const exitInBackground = (e: NativeExit) => e.importance != null && e.importance >= 300 && ![4, 5, 6].includes(e.reason);
function describeExit(e: NativeExit): string {
  const parts = [EXIT_NAME[e.reason] ?? `причина ${e.reason}`];
  if (e.desc) parts.push(e.desc);
  if (e.importance != null) parts.push(e.importance <= 100 ? "было на экране" : `важность ${e.importance}`);
  if (e.status) parts.push(`код ${e.status}`);
  return `${new Date(e.t).toLocaleTimeString("ru-RU")} ${parts.join("; ")}`;
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
  // Компьютер: при выходе из приложения отметка «закрыто нормально» (pagehide)
  // часто не успевает лечь на диск — Electron завершает процесс раньше, чем
  // сбрасывается localStorage, и после обычного закрытия следующий запуск
  // видел «оборвался на экране» (баг-репорт 80c64ce8: «каждый раз после
  // обычного закрытия»). Поэтому на компьютере отметке верим только внутри
  // одного сеанса окна: sessionStorage переживает перезагрузку и падение
  // страницы (тогда запись надёжна — процесс приложения жив), но не выход
  // из приложения. Падение всей оболочки ловит она сама (electron/report.cjs).
  const desktop = !!(window as { electronAPI?: unknown }).electronAPI;
  let sameSession = false;
  try { sameSession = sessionStorage.getItem(SESSION_KEY) === "1"; sessionStorage.setItem(SESSION_KEY, "1"); } catch { /* без него — как новый сеанс */ }
  const looksCrashed = !!prev && !prev.ok && prev.on && Date.now() - prev.t < FRESH_MS && !!prevLog;
  const crashed = looksCrashed && (!desktop || sameSession);
  if (looksCrashed && !crashed) applog.info("crashguard: на компьютере прошлый запуск без отметки о закрытии — это выход из приложения, не падение");
  let busy: Busy | null = null;
  try { busy = JSON.parse(localStorage.getItem(BUSY_KEY) || "null"); localStorage.removeItem(BUSY_KEY); } catch { /* нет */ }
  // Записи нативной части — и без автоотчёта в журнал: WebView мог умереть в
  // фоне, тогда это увидит следующий баг-репорт.
  const native = takeNativeDiag().then((r) => {
    for (const d of r.items ?? []) applog.warn(`webdiag: ${describeDiag(d)}`);
    if (r.exit) applog.info(`прошлый процесс: ${describeExit(r.exit)}`);
    return r;
  });

  beat();
  saveLog(true);
  window.setInterval(() => { if (document.visibilityState === "visible") { beat(); saveLog(); } }, 5000);
  document.addEventListener("visibilitychange", () => { beat(); saveLog(true); });
  if (Capacitor.isNativePlatform()) {
    void App.addListener("appStateChange", ({ isActive }) => { appActive = isActive; beat(); saveLog(true); }).catch(() => {});
  }
  window.addEventListener("pagehide", cleanExit);
  window.addEventListener("beforeunload", cleanExit);
  window.addEventListener("error", () => saveLog(true));
  window.addEventListener("unhandledrejection", () => saveLog(true));

  if (crashed && prev && prevLog) {
    const p = prev, log = prevLog;
    applog.warn(`crashguard: прошлый запуск (${p.v}) оборвался на экране`);
    if (busy) applog.warn(`crashguard: в момент падения — ${busy.what}`);
    // Пусть сначала встанет интерфейс — окошко поверх готового экрана.
    window.setTimeout(() => void native.then(({ items: list, exit }) => {
      // Запись о выходе — того самого запуска: не раньше его последнего «жив» (раз в 5 с).
      const ownExit = exit && exit.t >= p.t - 10_000 ? exit : undefined;
      if (ownExit && exitByUser(ownExit)) {
        applog.info(`crashguard: не падение — ${describeExit(ownExit)}`);
        return;
      }
      // WebView при этом не умирал (иначе это его гибель — сообщаем как раньше).
      if (ownExit && !list?.length && exitInBackground(ownExit)) {
        applog.info(`crashguard: не падение — система выгрузила приложение в фоне: ${describeExit(ownExit)}`);
        return;
      }
      const lines = ["Автоотчёт о падении: прошлый запуск оборвался, пока приложение было на экране"];
      if (busy) lines.push(`В момент падения: ${busy.what}`);
      if (list?.length) lines.push(...list.map((d) => `Нативная часть: ${describeDiag(d)}`));
      else if (list) lines.push("Нативная часть: WebView не умирал — закрылось всё приложение или его выгрузила система");
      if (ownExit) lines.push(`Android: ${describeExit(ownExit)}`);
      showBugReportDialog({
        title: t("Похоже, в прошлый раз WYX упал"),
        hint: t("Отправить разработчику журнал того запуска? Можно написать, что вы делали перед этим (необязательно)."),
        cancel: t("Не надо"),
        log,
        note: lines.join("\n"),
        meta: { crash: true, crash_version: p.v, crash_at: new Date(p.t).toISOString(), ...(busy ? { crash_busy: busy.what } : {}), ...(list?.length ? { webdiag: list } : {}), ...(ownExit ? { exit: ownExit } : {}) },
      });
    }), 2500);
  }
}
