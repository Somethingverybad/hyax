import { Capacitor } from "@capacitor/core";

/**
 * iPhone: «список чатов ↔ переписка» — сдвигом, как в iOS (pages/Chat.tsx):
 * переписка въезжает справа, список уходит на треть влево и темнеет; свайп
 * от левого края ведёт переписку за пальцем. Только сдвиг и затемнение, без
 * размытия и масштаба: «жидкое стекло» (38bb68e) мешало нажатиям и обоям.
 * В браузере включается флагом localStorage hyax:navslide=1 — для проверки.
 */
export function navSlideEnabled(): boolean {
  if (Capacitor.getPlatform() === "ios") return true;
  try { return localStorage.getItem("hyax:navslide") === "1"; } catch { return false; }
}

/** Кривая и длительность системного перехода iOS: резвый старт, мягкий доезд. */
export const NAV_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
export const NAV_MS = 380;
/** Насколько уходит влево экран под новым и как сильно темнеет. */
export const UNDER_SHIFT = 0.3;
export const UNDER_DIM = 0.12;
/** Ширина полосы у левого края, откуда начинается свайп назад. */
export const EDGE_PX = 24;
