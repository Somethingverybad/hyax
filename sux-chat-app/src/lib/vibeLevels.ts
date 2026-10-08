import { useEffect, useState } from "react";
import { api, type VibeLevelsConfig, type VibeLevel } from "@/api/client";

/**
 * Уровни вайбометра (настраивает админ): с порога шкала и число красятся в
 * цвет уровня. Шкала показывает путь до следующего уровня; на последнем —
 * bar_length баллов от его порога, потом полная.
 */
const CACHE = "hyax.vibe-levels";
const readCfg = (): VibeLevelsConfig | null => { try { const v = localStorage.getItem(CACHE); return v ? JSON.parse(v) : null; } catch { return null; } };
const writeCfg = (c: VibeLevelsConfig) => { try { localStorage.setItem(CACHE, JSON.stringify(c)); } catch { /* недоступно */ } };
const FALLBACK: VibeLevelsConfig = { bar_length: 10, levels: [] };
let inflight: Promise<VibeLevelsConfig> | null = null;

export function loadVibeLevels(force = false): Promise<VibeLevelsConfig> {
  if (!inflight || force) {
    inflight = api.getVibeLevels()
      .then((c) => { writeCfg(c); return c; })
      .catch(() => readCfg() || FALLBACK);
  }
  return inflight;
}

export function useVibeLevels(): VibeLevelsConfig {
  const [cfg, setCfg] = useState<VibeLevelsConfig>(() => readCfg() || FALLBACK);
  useEffect(() => { let off = false; void loadVibeLevels().then((c) => { if (!off) setCfg(c); }); return () => { off = true; }; }, []);
  return cfg;
}

export function vibeState(v: number, cfg: VibeLevelsConfig): { level: VibeLevel | null; next: VibeLevel | null; fill: number; glow: boolean } {
  const levels = [...cfg.levels].sort((a, b) => a.min_vibe - b.min_vibe);
  let level: VibeLevel | null = null;
  for (const l of levels) if (l.min_vibe <= v) level = l;
  const next = levels.find((l) => l.min_vibe > v) || null;
  const start = level ? level.min_vibe : 0;
  const span = next ? next.min_vibe - start : Math.max(1, cfg.bar_length);
  const fill = Math.max(0, Math.min(1, (v - start) / span));
  const glow = level ? level.glow : v >= cfg.bar_length;
  return { level, next, fill, glow };
}
