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
const ICON_BY_THEME: Record<string, string> = {
  light: "Light", dark: "Dark", neo: "Neo", "glass-light": "Glass", "glass-dark": "Glass",
};

function syncAppIcon(t: ThemeDef) {
  if (Capacitor.getPlatform() !== "ios") return;
  const want = ICON_BY_THEME[t.id] || (t.base === "light" ? "Light" : "Dark");
  void import("@capacitor-community/app-icon")
    .then(async ({ AppIcon }) => {
      const { value: now } = await AppIcon.getName();
      if (now === want) return;
      // suppressNotification: false — системное окно показывается, но и
      // приватных вызовов, за которые Apple снимает с проверки, тут нет.
      await AppIcon.change({ name: want, suppressNotification: false });
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
  paint(current);
}

export function getTheme(): ThemeDef { return current; }
export function getInstalledThemes(): ThemeDef[] { return installed; }

/** Применить тему. remote=false — не сообщать серверу (значение пришло с него). */
export function setTheme(t: ThemeDef, remote = true) {
  current = t;
  write(KEY_ID, t.id);
  write(KEY_DEF, t);
  paint(t);
  emit();
  if (remote) void import("@/api/client").then(({ api }) => api.setActiveTheme(t.id)).catch(() => {});
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
  if (!activeId || activeId === current.id) return;
  const known = builtinById(activeId) || installed.find((t) => t.id === activeId);
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
