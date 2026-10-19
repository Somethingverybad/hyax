import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { CapacitorUpdater } from "@capgo/capacitor-updater";
import { APP_BUILD, APP_VERSION } from "@/lib/appVersion";
import { applog } from "@/lib/applog";
import { isBusy } from "@/lib/busy";
import { playerState } from "@/lib/player";

/**
 * Обновление веб-части по воздуху (iPhone и Android).
 *
 * В сборку зашит веб-бандл (dist); новый бандл — тот же dist архивом в бакете
 * (scripts/ota-publish.py). Приложение тихо проверяет манифест, качает архив
 * плагином @capgo/capacitor-updater (он проверяет sha256 и хранит бандлы), а
 * применяет его само — в самом начале следующего холодного запуска, до
 * отрисовки (otaBoot). Не при уходе в фон, как предлагает плагин: перезагрузка
 * страницы в фоне оборвала бы звонок, музыку и загрузку файла.
 *
 * Безопасность:
 * - бандл, которому нужна более новая нативная часть, не ставим (min_native
 *   в манифесте, по платформам — номера сборок у них разные);
 * - «жив» (notifyAppReady) бандл говорит после первой отрисовки React
 *   (событие hyax:ready из App): не дошёл до неё за 20 с — упал при загрузке
 *   или при отрисовке, — плагин возвращает прежний, а мы запоминаем версию
 *   как сломанную и больше её не ставим;
 * - новая сборка из магазина сама возвращает встроенный бандл
 *   (resetWhenUpdate), а старее встроенного бандл не ставим.
 *
 * Кроме запуска, скачанный бандл применяется на лету — тогда, когда это
 * никому не мешает (startOtaAutoApply): приложение ушло в фон или к
 * компьютеру давно не прикасались, и нет звонка, записи, загрузки, не играет
 * музыка или эфир (lib/busy, плеер). И по кнопке «Обновить сейчас» в профиле.
 *
 * Нативный код (плагины, расширение пушей, службы Android, capacitor.config)
 * так не обновляется — только новой сборкой.
 */

const BASE = "https://storage.yandexcloud.net/hyax-public/ota/";
/** Канал: тестовые сборки (VITE_OTA_CHANNEL=test) читают свой манифест. */
const CHANNEL = (import.meta.env.VITE_OTA_CHANNEL as string | undefined) || "";
const MANIFEST_URL = `${BASE}${CHANNEL ? `manifest-${CHANNEL}` : "manifest"}.json`;

/** Версия этого бандла — так он зовётся у плагина и в манифесте. */
export const BUNDLE_VERSION = `${APP_VERSION}-${APP_BUILD}`;

const PENDING_KEY = "hyax:ota-pending";
const FAILED_KEY = "hyax:ota-failed";
const BUILTIN_KEY = "hyax:ota-builtin";
const CHECKED_KEY = "hyax:ota-checked";
/** Проверять не чаще раза в 20 минут (запуск, возврат в приложение). */
const CHECK_EVERY = 20 * 60 * 1000;

interface Manifest {
  /** Версия бандла: «1.1.34-735» (APP_VERSION-APP_BUILD). */
  version: string;
  /** Номер сборки бандла (число коммитов). */
  build: number;
  url: string;
  sha256: string;
  /** Нижняя нативная сборка по платформам: CFBundleVersion / versionCode;
   *  desktop — встроенная сборка установщика (смотрит electron/ota.cjs). */
  min_native?: { ios?: number; android?: number; desktop?: number };
}

/** Скачан и ждёт запуска: build — по нему узнаём, что переключились (у
 *  встроенного бандла id «builtin»), tried — уже пробовали переключиться. */
interface Pending { id: string; version: string; build: number; tried?: boolean }

const read = <T,>(key: string): T | null => {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : null; } catch { return null; }
};
const write = (key: string, value: unknown) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch { /* приватный режим — переживём */ }
};

/** Только приложение на телефоне с плагином; сборка для Google Play обновляется
 *  только через Play (правила магазина), десктоп — своим установщиком. */
export const otaEnabled = () =>
  Capacitor.isNativePlatform()
  && import.meta.env.VITE_DISTRIBUTION !== "play"
  && Capacitor.isPluginAvailable("CapacitorUpdater");

/**
 * Начало запуска: подтвердить плагину, что бандл жив, и, если скачан новый,
 * переключиться на него. true — сейчас будет перезагрузка, рисовать не нужно.
 */
export async function otaBoot(): Promise<boolean> {
  // Компьютер: бандл выбирает main-процесс (electron/ota.cjs) — ему только
  // сказать «жив», когда интерфейс отрисовался.
  const desktop = (window as { electronAPI?: { otaReady?: () => void } }).electronAPI;
  if (desktop?.otaReady) window.addEventListener("hyax:ready", () => desktop.otaReady!(), { once: true });
  if (!otaEnabled()) return false;
  // Бандл жив — когда интерфейс отрисовался; без этого плагин откатит его.
  window.addEventListener("hyax:ready", () => { void CapacitorUpdater.notifyAppReady().catch(() => {}); }, { once: true });
  const pending = read<Pending>(PENDING_KEY);
  if (!pending) return false;
  if (pending.build === (parseInt(APP_BUILD, 10) || 0)) {
    write(PENDING_KEY, null);
    applog.info(`ota: работает ${BUNDLE_VERSION}`);
    return false;
  }
  if (pending.tried) {
    // Переключались, а запустился снова прежний — плагин откатил бандл.
    const failed = read<string[]>(FAILED_KEY) || [];
    write(FAILED_KEY, [...failed.filter((v) => v !== pending.version), pending.version].slice(-10));
    write(PENDING_KEY, null);
    applog.warn(`ota: ${pending.version} не запустился, остаёмся на ${BUNDLE_VERSION}`);
    return false;
  }
  return switchTo(pending);
}

/** Переключиться на скачанный бандл: страница перезагрузится в нём. */
async function switchTo(pending: Pending): Promise<boolean> {
  write(PENDING_KEY, { ...pending, tried: true });
  try {
    // После set/reset страница перезагружается и промис не вернётся; если за
    // 5 с перезагрузки не было — остаёмся на этом бандле, а не на белом экране.
    const switching = pending.id === "builtin" ? CapacitorUpdater.reset() : CapacitorUpdater.set({ id: pending.id });
    await Promise.race([switching, new Promise((_, fail) => window.setTimeout(() => fail(new Error("нет перезагрузки за 5 с")), 5000))]);
    return true;
  } catch (e) {
    write(PENDING_KEY, null);
    applog.warn(`ota: не переключился на ${pending.version}: ${(e as Error)?.message || e}`);
    return false;
  }
}

async function nativeBuild(): Promise<number> {
  try { return parseInt((await App.getInfo()).build, 10) || 0; } catch { return 0; }
}

/** Номер сборки встроенного бандла этой нативной сборки: запоминаем, пока
 *  работаем на нём, — чтобы не поставить бандл старее того, что внутри. */
async function builtinBuild(native: number): Promise<number> {
  const cur = await CapacitorUpdater.current().catch(() => null);
  const saved = read<{ native: number; build: number }>(BUILTIN_KEY);
  if (cur?.bundle?.id === "builtin") {
    const build = parseInt(APP_BUILD, 10) || 0;
    if (saved?.native !== native || saved?.build !== build) write(BUILTIN_KEY, { native, build });
    return build;
  }
  return saved?.native === native ? saved.build : 0;
}

async function fetchManifest(): Promise<Manifest | null> {
  const ctl = new AbortController();
  const timer = window.setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(`${MANIFEST_URL}?t=${Date.now()}`, { cache: "no-store", signal: ctl.signal });
    if (!res.ok) return null;
    const m = (await res.json()) as Manifest;
    const ok = m && typeof m.version === "string" && typeof m.build === "number"
      && typeof m.url === "string" && m.url.startsWith(BASE) && /^[0-9a-f]{64}$/.test(m.sha256 || "");
    return ok ? m : null;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

let checking = false;

/** Есть ли новый бандл — скачать; применится при следующем запуске. */
export async function otaCheck(force = false): Promise<void> {
  if (!otaEnabled() || checking) return;
  const last = read<number>(CHECKED_KEY) || 0;
  if (!force && Date.now() - last < CHECK_EVERY) return;
  checking = true;
  try {
    write(CHECKED_KEY, Date.now());
    const m = await fetchManifest();
    if (!m || m.version === BUNDLE_VERSION) return;
    if ((read<string[]>(FAILED_KEY) || []).includes(m.version)) return;
    const platform = Capacitor.getPlatform() as "ios" | "android";
    const native = await nativeBuild();
    const need = m.min_native?.[platform] || 0;
    if (!native || native < need) {
      applog.info(`ota: ${m.version} ждёт сборку ${need}, у нас ${native}`);
      return;
    }
    // Встроенный бандл не старее манифеста — значит, сборку обновили из
    // магазина, а манифест ещё старый, или манифест откатили на встроенный.
    // Откат на прошлый бандл (манифест указал на него) — можно, если он новее
    // встроенного.
    const builtin = await builtinBuild(native);
    if (m.build <= builtin) {
      const running = parseInt(APP_BUILD, 10) || 0;
      if (running > builtin && running > m.build && read<Pending>(PENDING_KEY)?.id !== "builtin") {
        write(PENDING_KEY, { id: "builtin", version: m.version, build: builtin });
        applog.info(`ota: манифест откатили — при следующем запуске встроенный бандл ${builtin}`);
      }
      return;
    }
    if (read<Pending>(PENDING_KEY)?.version === m.version) return;
    // Уже скачан раньше (например, проверка оборвалась после загрузки).
    const have = (await CapacitorUpdater.list().catch(() => ({ bundles: [] }))).bundles
      .find((b) => b.version === m.version && b.status !== "error" && b.status !== "deleted");
    const bundle = have || await CapacitorUpdater.download({ url: m.url, version: m.version, checksum: m.sha256 });
    write(PENDING_KEY, { id: bundle.id, version: m.version, build: m.build });
    applog.info(`ota: скачан ${m.version}`);
    window.dispatchEvent(new Event("hyax:ota-pending"));
  } catch (e) {
    applog.warn(`ota: проверка не удалась: ${(e as Error)?.message || e}`);
  } finally {
    checking = false;
  }
}

/** Проверять после каждого запуска и при возврате в приложение (не чаще
 *  раза в 20 минут). */
export function startOtaChecks() {
  if (!otaEnabled()) return;
  window.setTimeout(() => void otaCheck(true), 8000);
  void App.addListener("appStateChange", ({ isActive }) => { if (isActive) void otaCheck(); });
}

/** Для строки версии в профиле: работаем ли на бандле, пришедшем по воздуху. */
export async function otaInfo(): Promise<{ ota: boolean; native: string } | null> {
  const desktop = (window as { electronAPI?: { otaInfo?: () => Promise<{ ota: boolean; builtinBuild: number } | null> } }).electronAPI;
  if (desktop?.otaInfo) {
    const i = await desktop.otaInfo().catch(() => null);
    return i ? { ota: i.ota, native: String(i.builtinBuild) } : null;
  }
  if (!otaEnabled()) return null;
  try {
    const [cur, info] = await Promise.all([CapacitorUpdater.current(), App.getInfo()]);
    return { ota: cur.bundle.id !== "builtin", native: info.build };
  } catch {
    return null;
  }
}

// ---- Применить на лету ----

type DesktopOta = {
  otaInfo?: () => Promise<{ ota: boolean; pending?: boolean; builtinBuild: number } | null>;
  otaApply?: () => Promise<boolean>;
};
const desktopOta = () => (window as { electronAPI?: DesktopOta }).electronAPI;

/** Скачан ли новый бандл, который ещё не применён. */
export async function otaPending(): Promise<boolean> {
  const d = desktopOta();
  if (d?.otaApply && d.otaInfo) return !!(await d.otaInfo().catch(() => null))?.pending;
  if (!otaEnabled()) return false;
  const p = read<Pending>(PENDING_KEY);
  return !!p && !p.tried && p.build !== (parseInt(APP_BUILD, 10) || 0);
}

/** Сейчас перезагрузка интерфейса никому не помешает. */
export function otaSafeNow(): boolean {
  if (isBusy()) return false;
  const p = playerState();
  return !p.playing && !p.live;
}

/** Применить скачанный бандл сейчас (кнопка в профиле или безопасный момент). */
export async function otaApplyNow(why: string): Promise<boolean> {
  if (!(await otaPending())) return false;
  applog.info(`ota: применяю на лету (${why})`);
  const d = desktopOta();
  if (d?.otaApply) return d.otaApply().catch(() => false);
  const p = read<Pending>(PENDING_KEY);
  return p ? switchTo(p) : false;
}

/** Через сколько в фоне применять при возвращении (если в фоне не успели). */
const AWAY_MS = 3 * 60 * 1000;
/** Компьютер: сколько окно должно простоять без касаний. */
const IDLE_MS = 10 * 60 * 1000;

/**
 * Применять на лету в безопасный момент: приложение ушло в фон (через пару
 * секунд, пока страница ещё жива) или вернулось после долгого фона — тогда
 * перезагрузка выглядит как обычный запуск; на компьютере — окно 10 минут
 * без касаний. Всегда — только если ничего не идёт (otaSafeNow).
 */
export function startOtaAutoApply() {
  const d = desktopOta();
  if (!otaEnabled() && !d?.otaApply) return;
  let lastTouch = Date.now();
  let hiddenAt = 0;
  const touch = () => { lastTouch = Date.now(); };
  for (const ev of ["pointerdown", "keydown", "wheel", "touchstart"]) window.addEventListener(ev, touch, { passive: true, capture: true });
  const tryApply = async (why: string) => { if (otaSafeNow() && await otaPending()) await otaApplyNow(why); };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      hiddenAt = Date.now();
      window.setTimeout(() => { if (document.visibilityState === "hidden") void tryApply("в фоне"); }, 1500);
    } else {
      const away = hiddenAt ? Date.now() - hiddenAt : 0;
      hiddenAt = 0;
      if (away >= AWAY_MS) void tryApply("после фона");
    }
  });
  if (d?.otaApply) {
    window.setInterval(() => {
      if (Date.now() - lastTouch >= IDLE_MS) void tryApply("простой");
    }, 60 * 1000);
  }
}
