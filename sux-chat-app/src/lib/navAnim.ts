import { readCache } from "@/lib/session-cache";

/**
 * Переход «список чатов ↔ переписка» на телефоне (pages/Chat.tsx). Выбор —
 * на этом устройстве (localStorage hyax:navanim), слабому телефону можно
 * выключить совсем:
 *   • classic — как было: переписка проявляется с небольшим сдвигом (CSS screen-push/pop);
 *   • slide   — как в iOS: переписка въезжает справа, список уходит на треть
 *               влево и темнеет; назад — свайпом от края за пальцем;
 *   • depth   — «глубина»: список отступает вглубь и гаснет, переписка проявляется;
 *   • lift    — «подъём»: переписка поднимается снизу и проявляется над притемнённым списком;
 *   • sheet   — «шторка»: переписка выезжает снизу целиком, список под ней
 *               чуть уменьшается и темнеет;
 *   • off     — без анимации: экраны меняются сразу (и переходы между разделами тоже, index.css).
 * Переписка только двигается и проявляется, без масштаба: при открытии она
 * меряет положение метки непрочитанных (getBoundingClientRect), масштаб сбил
 * бы прокрутку. Масштаб — только у списка. Без размытия: «жидкое стекло»
 * (38bb68e) мешало нажатиям и обоям.
 * Пробные варианты видит только админ, «Обычные» и «Без анимации» — все.
 * Системное «Уменьшить движение» — тоже без анимации.
 */
export type NavAnim = "classic" | "slide" | "depth" | "lift" | "sheet" | "off";
export const NAV_ANIMS: NavAnim[] = ["classic", "slide", "depth", "lift", "sheet", "off"];
export const NAV_TRIAL = new Set<NavAnim>(["slide", "depth", "lift", "sheet"]);
/** Ключи перевода. */
export const NAV_ANIM_LABELS: Record<NavAnim, string> = {
  classic: "Обычные", slide: "Сдвиг", depth: "Глубина", lift: "Подъём", sheet: "Шторка", off: "Без анимации",
};
export const NAV_ANIM_EVENT = "hyax:navanim";

const KEY = "hyax:navanim";
// Флаг первой пробы сдвига: у кого включён — это «slide».
const OLD_KEY = "hyax:navslide";

export function getNavAnimChoice(): NavAnim {
  try {
    const v = localStorage.getItem(KEY) as NavAnim | null;
    if (v && NAV_ANIMS.includes(v)) return v;
    if (localStorage.getItem(OLD_KEY) === "1") return "slide";
  } catch { /* приватный режим */ }
  return "classic";
}

// Один запрос на всё приложение: navAnim() зовёт каждая отрисовка переписки.
let motionQuery: MediaQueryList | null | undefined;
export const reducedMotion = () => {
  if (motionQuery === undefined) {
    try { motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)"); } catch { motionQuery = null; }
  }
  return !!motionQuery?.matches;
};

/**
 * «Анимации и эффекты» (Внешний вид) — одним переключателем всё движение
 * этого устройства: эффекты сообщений и действий (MessageEffect, ActionEffect),
 * переходы между экранами, анимация удаления, заставка при запуске
 * (index.html читает тот же ключ). Системное «Уменьшить движение» — то же.
 */
const MOTION_KEY = "hyax:motion";
export const MOTION_EVENT = "hyax:motion";
export function animationsOn(): boolean {
  try { return localStorage.getItem(MOTION_KEY) !== "off"; } catch { return true; }
}
export function setAnimationsOn(on: boolean) {
  try { localStorage.setItem(MOTION_KEY, on ? "on" : "off"); } catch { /* приватный режим */ }
  applyNavAnimAttr();
  try { window.dispatchEvent(new Event(MOTION_EVENT)); window.dispatchEvent(new Event(NAV_ANIM_EVENT)); } catch { /* нет DOM */ }
}
/** Без движения: выключено в настройках или в системе. */
export const motionOff = () => reducedMotion() || !animationsOn();

/** Что играть сейчас. */
export const navAnim = (): NavAnim => (motionOff() ? "off" : getNavAnimChoice());

/** html[data-nav] — для CSS (index.css): «Без анимации» гасит и переходы разделов. */
export function applyNavAnimAttr() {
  try { document.documentElement.dataset.nav = animationsOn() ? getNavAnimChoice() : "off"; } catch { /* нет DOM */ }
}

export function setNavAnim(v: NavAnim) {
  try {
    localStorage.removeItem(OLD_KEY);
    if (v === "classic") localStorage.removeItem(KEY); else localStorage.setItem(KEY, v);
  } catch { /* приватный режим */ }
  applyNavAnimAttr();
  window.dispatchEvent(new Event(NAV_ANIM_EVENT));
}

/** Пробные варианты — админу. */
export const navAnimTrialVisible = () => !!readCache<{ is_admin?: boolean }>("user")?.is_admin;

/** Переходы, которые ведёт Chat.tsx слоями (Web Animations): откуда въезжает
 *  переписка (на место — без этих свойств) и куда уходит список под ней.
 *  Закрытие — те же кадры в обратную сторону; close — если уходить ей
 *  нужно с другой кривой (тормозящая кривая на уходе даёт рывок). */
export type NavStyle = { ms: number; ease: string; chat: Keyframe; list?: Keyframe; dim: number; swipe?: boolean; close?: { ms: number; ease: string } };

/** Кривая системного перехода iOS: резвый старт, мягкий доезд. */
export const IOS_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
/** Насколько уходит влево список под перепиской при сдвиге. */
export const UNDER_SHIFT = 0.3;
/** Ширина полосы у левого края, откуда начинается свайп назад. */
export const EDGE_PX = 24;

export const NAV_STYLES: Partial<Record<NavAnim, NavStyle>> = {
  slide: { ms: 380, ease: IOS_EASE, chat: { transform: "translateX(100%)" }, list: { transform: `translateX(${-UNDER_SHIFT * 100}%)` }, dim: 0.12, swipe: true },
  depth: { ms: 300, ease: "cubic-bezier(0.2, 0, 0, 1)", chat: { opacity: 0 }, list: { transform: "scale(0.92)", opacity: 0 }, dim: 0 },
  lift: { ms: 320, ease: "cubic-bezier(0.05, 0.7, 0.1, 1)", chat: { transform: "translateY(12%)", opacity: 0 }, dim: 0.15, close: { ms: 220, ease: "cubic-bezier(0.3, 0, 0.8, 0.15)" } },
  sheet: { ms: 420, ease: IOS_EASE, chat: { transform: "translateY(100%)" }, list: { transform: "scale(0.94)" }, dim: 0.3 },
};

/** Лента новой переписки встала на место (ChatWindow, detail.chatId): с этого
 *  кадра её можно двигать. Раньше первый кадр новой переписки на телефоне
 *  собирался 0,3–0,5 с, анимация к нему уже проходила, и «Глубина» (0,3 с) не
 *  была видна совсем (баг-репорт 2dd6c250). */
export const FEED_READY_EVENT = "hyax:feed-ready";
/** Дольше ленту не ждём (нет кэша, медленная сеть) — едем с тем, что есть. */
export const NAV_WAIT_MS = 450;

/** Кадр «на месте» для тех же свойств. */
export const restFrame = (f: Keyframe): Keyframe =>
  Object.fromEntries(Object.keys(f).map((k) => [k, k === "opacity" ? 1 : "none"]));
