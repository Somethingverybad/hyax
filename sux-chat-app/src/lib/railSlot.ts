import { useSyncExternalStore } from "react";

/**
 * Звонок, свёрнутый на широком окне, живёт в панели разделов на месте
 * плеера (components/call/RailCall). NavRail регистрирует здесь свой слот,
 * CallOverlay рисует в него порталом, RailPlayer на это время прячется —
 * плеером тогда управляют с экрана «Музыка».
 */
let slot: HTMLElement | null = null;
let active = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

export function setRailCallSlot(el: HTMLElement | null) {
  if (slot === el) return;
  slot = el; emit();
}
export function setRailCallActive(v: boolean) {
  if (active === v) return;
  active = v; emit();
}
export const useRailCallSlot = () => useSyncExternalStore(subscribe, () => slot, () => null);
export const useRailCallActive = () => useSyncExternalStore(subscribe, () => active, () => false);
