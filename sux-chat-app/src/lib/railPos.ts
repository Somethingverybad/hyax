import { useSyncExternalStore } from "react";

/**
 * Панель разделов на широком окне (components/BottomNav NavRail) — где стоит
 * столбик вкладок: сверху, по центру или снизу. Настройка устройства
 * (localStorage), выбирается во «Внешнем виде». Плеер и пузырь звонка живут
 * в той же колонке, но на положение вкладок не влияют (см. index.css
 * .nav-rail-wrap[data-pos]).
 */
export type RailPos = "top" | "middle" | "bottom";
export const RAIL_POS: RailPos[] = ["top", "middle", "bottom"];
/** Подписи — ключи перевода. */
export const RAIL_POS_LABELS: Record<RailPos, string> = { top: "Сверху", middle: "По центру", bottom: "Снизу" };

const KEY = "hyax:setting:rail_pos";
const subs = new Set<() => void>();
let cache: RailPos | undefined;

export function getRailPos(): RailPos {
  if (cache === undefined) {
    try { const v = localStorage.getItem(KEY) as RailPos | null; cache = v && RAIL_POS.includes(v) ? v : "middle"; }
    catch { cache = "middle"; }
  }
  return cache;
}

export function setRailPos(v: RailPos) {
  cache = v;
  try { localStorage.setItem(KEY, v); } catch { /* приватный режим */ }
  subs.forEach((f) => f());
}

const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const useRailPos = () => useSyncExternalStore(subscribe, getRailPos, getRailPos);
