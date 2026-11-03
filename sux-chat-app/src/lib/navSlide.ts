import { Capacitor } from "@capacitor/core";
import { readCache } from "@/lib/session-cache";

/**
 * iPhone: «список чатов ↔ переписка» — сдвигом, как в iOS (pages/Chat.tsx):
 * переписка въезжает справа, список уходит на треть влево и темнеет; свайп
 * от левого края ведёт переписку за пальцем. Только сдвиг и затемнение, без
 * размытия и масштаба: «жидкое стекло» (38bb68e) мешало нажатиям и обоям.
 *
 * Пока на проверке — только по флагу устройства (localStorage hyax:navslide):
 * его включает переключатель во «Внешнем виде», видный админу на iPhone.
 * Выкладка по воздуху остальным ничего не меняет.
 */
const KEY = "hyax:navslide";
export function navSlideEnabled(): boolean {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}
export function setNavSlide(on: boolean) {
  try { if (on) localStorage.setItem(KEY, "1"); else localStorage.removeItem(KEY); } catch { /* приватный режим */ }
}
/** Переключатель пробы — админу на iPhone. */
export const navSlideTrialVisible = () => Capacitor.getPlatform() === "ios" && !!readCache<{ is_admin?: boolean }>("user")?.is_admin;

/** Кривая и длительность системного перехода iOS: резвый старт, мягкий доезд. */
export const NAV_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
export const NAV_MS = 380;
/** Насколько уходит влево экран под новым и как сильно темнеет. */
export const UNDER_SHIFT = 0.3;
export const UNDER_DIM = 0.12;
/** Ширина полосы у левого края, откуда начинается свайп назад. */
export const EDGE_PX = 24;
