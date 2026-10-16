/**
 * Язык интерфейса: ru (исходные строки в коде) | en | ko. Ключ словаря — сама
 * русская строка, так непереведённое остаётся по-русски, а не пустым. Язык
 * хранится в профиле (Profile.language) и зеркалится в localStorage, чтобы
 * экран входа и первый кадр были на нужном языке до загрузки профиля.
 */
import { syncNativeLang } from "./nativeLang";
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
  notifyShell(l);
  window.dispatchEvent(new CustomEvent("hyax:lang", { detail: l }));
}

/** Оболочке десктопа (трей, тосты, диалоги main-процесса) и нативу — тот же язык. */
function notifyShell(l: Lang) {
  try { (window as any).electronAPI?.setLang?.(l); } catch { /* не десктоп */ }
  // Нативу (звонки, каналы уведомлений, расширения iOS) — тоже.
  try { syncNativeLang(l); } catch { /* браузер */ }
}
try { notifyShell(current); document.documentElement.lang = current; } catch { /* SSR/тест */ }

/** Язык из профиля (после входа / обновления профиля) — в зеркало. */
export function applyProfileLang(p: { language?: string | null } | null | undefined) {
  const l = (p?.language || "").slice(0, 2) as Lang;
  if (LANGS.includes(l) && l !== current) setLang(l);
}

/** Перевод строки. Плейсхолдеры {name} подставляются из vars. */
export function t(s: string, vars?: Record<string, string | number>): string {
  let out = (DICT[current] && DICT[current][s]) || s;
  if (vars) for (const k of Object.keys(vars)) { const v = String(vars[k]); out = out.replace(new RegExp(`\\{${k}\\}`, "g"), () => v); }
  return out;
}

/**
 * Перевод с уточнением места: одно русское слово в разных местах переводится
 * по-разному («Все» во вкладке чатов — «전체», в доступе к сохранёнкам —
 * «모든 사용자»). Ключ словаря — «место:строка»; его нет — обычный перевод.
 */
export function tc(ctx: string, s: string, vars?: Record<string, string | number>): string {
  const k = `${ctx}:${s}`;
  return DICT[current] && DICT[current][k] ? t(DICT[current][k], vars) : t(s, vars);
}

/**
 * Склонение по числу. Формы русские (одна/две/пять), в них можно писать {n}:
 * tn(n, "{n} подписчик", "{n} подписчика", "{n} подписчиков"). Ключ словаря —
 * три формы через «|»; в en значение «one|other», в ko — одна форма.
 */
export function tn(n: number, one: string, few: string, many: string, vars?: Record<string, string | number>): string {
  const key = `${one}|${few}|${many}`;
  const tr = DICT[current] && DICT[current][key];
  let out: string;
  if (tr) {
    const forms = tr.split("|");
    out = current === "en" ? (Math.abs(n) === 1 ? forms[0] : forms[1] ?? forms[0]) : forms[0];
  } else {
    const a = Math.abs(n) % 100, b = a % 10;
    out = a > 10 && a < 20 ? many : b > 1 && b < 5 ? few : b === 1 ? one : many;
  }
  out = out.replace(/\{n\}/g, () => String(n));
  if (vars) for (const k of Object.keys(vars)) { const v = String(vars[k]); out = out.replace(new RegExp(`\\{${k}\\}`, "g"), () => v); }
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
