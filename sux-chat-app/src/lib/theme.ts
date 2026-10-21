import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";
import { useSyncExternalStore } from "react";
import { BUILTIN_THEMES, DEFAULT_THEME, builtinById } from "@/themes/builtin";
import { normalizeTheme, paintTheme, themeAttrs, themeVars } from "@/themes/engine";
import type { ThemeDef } from "@/themes/types";

/**
 * Активная тема и список установленных.
 *
 * Тема — данные (src/themes): встроенные лежат в коде, пользовательские
 * приходят с сервера. Выбор хранится на сервере в профиле (active_theme) и
 * переезжает между устройствами; здесь — копия: id и сам объект активной темы
 * в localStorage, чтобы приложение красилось до первого запроса и без сети.
 */
const KEY_ID = "hyax-theme";
const KEY_DEF = "hyax-theme-def";
const KEY_LIST = "hyax-themes";
/** Одна тема на всех устройствах (по умолчанию) или своя на этом: настройка
 *  устройства, не аккаунта — хранится только здесь. */
const KEY_SYNC = "hyax-theme-sync";

const listeners = new Set<() => void>();
let current: ThemeDef = DEFAULT_THEME;
let installed: ThemeDef[] = [];
const emit = () => listeners.forEach((l) => l());

function read<T>(key: string): T | null {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : null; }
  catch { return null; } // приватный режим или битый JSON — не повод падать
}
function write(key: string, value: unknown) {
  try { localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value)); }
  catch { /* не сохранилось — тема всё равно применится до конца сессии */ }
}

/** Статус-бар в нативной обёртке рисует система: цвет его значков задаём сами.
 *  Style.Dark — светлые значки для тёмного фона, Style.Light — наоборот. */
function syncStatusBar(t: ThemeDef) {
  if (!Capacitor.isNativePlatform()) return;
  StatusBar.setStyle({ style: t.base === "light" ? Style.Light : Style.Dark }).catch(() => {});
}

/** Иконка приложения на домашнем экране — по теме.
 *
 *  Набор иконок зашит в сборку: iOS умеет переключаться только между теми,
 *  что лежат внутри приложения (CFBundleAlternateIcons), подгрузить картинку
 *  на лету нельзя. Своя тема получает иконку по светлому или тёмному тону.
 *
 *  Меняем, только если иконка и правда другая: на каждую смену iOS показывает
 *  своё окно «Вы изменили иконку», и дёргать его на ровном месте незачем. */
// Основная иконка теперь мятная — и тема одна. Если на телефоне стоит
// альтернативная (от прежних тем), возвращаем основную, один раз.
function syncAppIcon(_t: ThemeDef) {
  if (Capacitor.getPlatform() !== "ios") return;
  void import("@capacitor-community/app-icon")
    .then(async ({ AppIcon }) => {
      const { value: now } = await AppIcon.getName();
      if (!now) return;
      await AppIcon.reset({ suppressNotification: false });
    })
    .catch(() => { /* иконка не сменилась — тема всё равно применилась */ });
}

function paint(t: ThemeDef) {
  const root = document.documentElement;
  if (t.id === "dark") {
    // Встроенная тёмная живёт токенами index.css (там же её десктопные
    // поправки) — снимаем всё, что выставила предыдущая тема.
    for (const k of Object.keys(themeVars(t))) root.style.removeProperty(k);
    for (const [k, v] of Object.entries(themeAttrs(t))) root.setAttribute(k, v);
  } else {
    paintTheme(root, t);
  }
  // Нативные элементы (подложка при оверскролле, экранная клавиатура) берут
  // цвет отсюда. Именно light/dark: у color-scheme других значений нет.
  root.style.colorScheme = t.base;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t.colors.background);
  syncStatusBar(t);
  syncAppIcon(t);
}

/** Вызывается из main.tsx до первой отрисовки: иначе экран моргнёт тёмным. */
export function initTheme() {
  let id: string | null = null;
  try { id = localStorage.getItem(KEY_ID); } catch { /* недоступно */ }
  installed = (read<unknown[]>(KEY_LIST) || []).map((t) => normalizeTheme(t));
  const cached = read<unknown>(KEY_DEF);
  current = (id && builtinById(id))
    || (id && cached && (cached as any).id === id ? normalizeTheme(cached) : null)
    || DEFAULT_THEME;
  // Прежняя встроенная тема — запоминаем «Мяту», на которую её заменили.
  if (id && current.builtin && current.id !== id) { write(KEY_ID, current.id); write(KEY_DEF, current); legacyMigrated = true; }
  paint(current);
}

let legacyMigrated = false;
export function getTheme(): ThemeDef { return current; }
export function getInstalledThemes(): ThemeDef[] { return installed; }

/** Синхронизация темы между устройствами включена? (по умолчанию — да) */
export function isThemeSync(): boolean {
  try { return localStorage.getItem(KEY_SYNC) !== "0"; } catch { return true; }
}
/** Включили — тема этого устройства становится общей; выключили — устройство
 *  живёт своей темой, чужие смены его не трогают. */
export function setThemeSync(on: boolean) {
  write(KEY_SYNC, on ? "1" : "0");
  emit();
  if (on) void import("@/api/client").then(({ api }) => api.setActiveTheme(current.id)).catch(() => {});
}
export function useThemeSync(): boolean {
  return useSyncExternalStore(subscribe, isThemeSync, () => true);
}

/** Смена темы — с переходом: новая раскрывается кругом из центра поверх
 *  старой (View Transitions), а где этого нет — цвета перетекают (класс
 *  theme-switch в index.css). Кто выключил анимации — без эффектов. */
function repaint(t: ThemeDef) {
  const root = document.documentElement;
  const still = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const vt = (document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } }).startViewTransition;
  if (still) { paint(t); return; }
  if (typeof vt === "function") {
    root.classList.add("theme-vt");
    try {
      vt.call(document, () => paint(t)).finished.finally(() => root.classList.remove("theme-vt"));
      return;
    } catch { root.classList.remove("theme-vt"); }
  }
  root.classList.add("theme-switch");
  paint(t);
  window.setTimeout(() => root.classList.remove("theme-switch"), 520);
}

/** Применить тему. remote=false — не сообщать серверу (значение пришло с него). */
export function setTheme(t: ThemeDef, remote = true) {
  const changed = t.id !== current.id;
  const prev = current;
  current = t;
  write(KEY_ID, t.id);
  write(KEY_DEF, t);
  if (changed && prev !== t) repaint(t); else paint(t);
  emit();
  if (remote && isThemeSync()) void import("@/api/client").then(({ api }) => api.setActiveTheme(t.id)).catch(() => {});
}

/** Заменить список установленных (ответ сервера). Активная пользовательская
 *  тема обновляется, если автор её поправил; пропала из списка — откат. */
export function setInstalledThemes(list: ThemeDef[]) {
  installed = list;
  write(KEY_LIST, list);
  if (!current.builtin) {
    const fresh = list.find((t) => t.id === current.id);
    if (fresh) { current = fresh; write(KEY_DEF, fresh); paint(fresh); }
  }
  emit();
}

/** Профиль пришёл с сервера: на этом устройстве ставим ту же тему. */
export async function syncThemeFromProfile(activeId: string | null | undefined) {
  if (!activeId || !isThemeSync()) return;
  const known = builtinById(activeId) || installed.find((t) => t.id === activeId);
  // На сервере записана прежняя встроенная тема — переводим на «Мяту» и там.
  if (known && known.id !== activeId) { if (known.id !== current.id || legacyMigrated) setTheme(known, true); legacyMigrated = false; return; }
  if (activeId === current.id) return;
  if (known) { setTheme(known, false); return; }
  try {
    const { api } = await import("@/api/client");
    setTheme(normalizeTheme(await api.getTheme(activeId)), false);
  } catch { /* тема удалена или нет сети — остаёмся на текущей */ }
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => { listeners.delete(onChange); };
}
export function useTheme(): ThemeDef {
  return useSyncExternalStore(subscribe, getTheme, () => DEFAULT_THEME);
}
export function useInstalledThemes(): ThemeDef[] {
  return useSyncExternalStore(subscribe, getInstalledThemes, () => []);
}

export { BUILTIN_THEMES };
