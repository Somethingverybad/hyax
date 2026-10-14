/**
 * Язык интерфейса: ru (исходные строки в коде) | en | ko. Ключ словаря — сама
 * русская строка, так непереведённое остаётся по-русски, а не пустым. Язык
 * хранится в профиле (Profile.language) и зеркалится в localStorage, чтобы
 * экран входа и первый кадр были на нужном языке до загрузки профиля.
 */
import en from "./i18n.en";
import ko from "./i18n.ko";

export type Lang = "ru" | "en" | "ko";
export const LANGS: Lang[] = ["ru", "en", "ko"];
export const LANG_NAMES: Record<Lang, string> = { ru: "Русский", en: "English", ko: "한국어" };

const KEY = "hyax:lang";
const DICT: Record<Lang, Record<string, string>> = { ru: {}, en, ko };

function detect(): Lang {
  try {
    const saved = localStorage.getItem(KEY) as Lang | null;
    if (saved && LANGS.includes(saved)) return saved;
  } catch { /* приватный режим */ }
  const nav = (typeof navigator !== "undefined" ? navigator.language : "ru").slice(0, 2).toLowerCase();
  return nav === "ko" ? "ko" : nav === "en" ? "en" : "ru";
}

let current: Lang = detect();

export function getLang(): Lang { return current; }

/** Поменять язык: локально сразу (событие hyax:lang перерисовывает экраны), на сервер — вызывающий. */
export function setLang(l: Lang) {
  if (!LANGS.includes(l) || l === current) return;
  current = l;
  try { localStorage.setItem(KEY, l); } catch { /* ок */ }
  try { document.documentElement.lang = l; } catch { /* ок */ }
  window.dispatchEvent(new CustomEvent("hyax:lang", { detail: l }));
}

/** Язык из профиля (после входа / обновления профиля) — в зеркало. */
export function applyProfileLang(p: { language?: string | null } | null | undefined) {
  const l = (p?.language || "").slice(0, 2) as Lang;
  if (LANGS.includes(l) && l !== current) setLang(l);
}

/** Перевод строки. Плейсхолдеры {name} подставляются из vars. */
export function t(s: string, vars?: Record<string, string | number>): string {
  let out = (DICT[current] && DICT[current][s]) || s;
  if (vars) for (const k of Object.keys(vars)) out = out.replace(new RegExp(`\\{${k}\\}`, "g"), String(vars[k]));
  return out;
}

/** Хук: перерисовать компонент при смене языка. Возвращает t. */
import { useEffect, useState } from "react";
export function useT() {
  const [, bump] = useState(0);
  useEffect(() => {
    const h = () => bump((x) => x + 1);
    window.addEventListener("hyax:lang", h);
    return () => window.removeEventListener("hyax:lang", h);
  }, []);
  return t;
}
