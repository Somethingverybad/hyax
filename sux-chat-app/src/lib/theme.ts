import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";
import { useSyncExternalStore } from "react";

/**
 * Тема оформления: тёмная (исходная, по умолчанию), светлая и «Необрутализм»
 * (кремовый фон, обводки тушью, жёсткие тени — по стайлгайду ChatApp).
 *
 * Вся палитра живёт токенами в index.css, поэтому переключение — это один
 * атрибут data-theme на <html>: `:root[data-theme="light"]` переопределяет
 * те же переменные, и перекрашивается всё приложение разом.
 */
export type Theme = "dark" | "light" | "neo";

export const THEME_LABELS: Record<Theme, string> = { dark: "Тёмная", light: "Светлая", neo: "Необрутализм" };

/** Фон у темы светлый: тёмные значки статус-бара, светлая системная подложка. */
export function isLightTheme(theme: Theme): boolean {
  return theme !== "dark";
}

/** Цвет фона темы — для <meta name="theme-color"> (панель браузера, PWA). */
const THEME_COLOR: Record<Theme, string> = { dark: "#0f0f10", light: "#f8fafc", neo: "#f5f5eb" };

const STORAGE_KEY = "hyax-theme";
const DEFAULT: Theme = "dark";

const listeners = new Set<() => void>();
let current: Theme = DEFAULT;

function readStored(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "light" || v === "dark" || v === "neo" ? v : DEFAULT;
  } catch {
    // Приватный режим или заблокированное хранилище — не повод падать.
    return DEFAULT;
  }
}

/** Статус-бар в нативной обёртке рисует система: цвет его значков задаём сами.
 *  Style.Dark — светлые значки для тёмного фона, Style.Light — наоборот. */
function syncStatusBar(theme: Theme) {
  if (!Capacitor.isNativePlatform()) return;
  StatusBar.setStyle({ style: isLightTheme(theme) ? Style.Light : Style.Dark }).catch(() => {});
}

function paint(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  // Нативные элементы (подложка при оверскролле, экранная клавиатура) берут
  // цвет отсюда — иначе в светлой теме они остаются чёрными.
  // Именно light/dark, а не имя темы: у color-scheme других значений нет.
  document.documentElement.style.colorScheme = isLightTheme(theme) ? "light" : "dark";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[theme]);
  syncStatusBar(theme);
}

/** Вызывается из main.tsx до первой отрисовки: иначе экран моргнёт тёмным. */
export function initTheme() {
  current = readStored();
  paint(current);
}

export function getTheme(): Theme {
  return current;
}

export function setTheme(theme: Theme) {
  if (theme === current) return;
  current = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Не сохранилось — тема всё равно применится до конца сессии.
  }
  paint(theme);
  listeners.forEach((l) => l());
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    getTheme,
    () => DEFAULT,
  );
}
