import { useEffect, useState } from "react";
import type { AudioLevels } from "@/lib/nativeCall";

/** Порог речи (audioLevel WebRTC, 0…1) и сколько держать подсветку после. */
const THRESHOLD = 0.03;
const HANG_MS = 600;
/** Говорящий в главном окне меняется, только если новый говорит дольше
 *  этого, а прежний замолчал дольше SWITCH_QUIET_MS — без дёрганья. */
const SWITCH_LOUD_MS = 350;
const SWITCH_QUIET_MS = 1200;

/**
 * Кто сейчас говорит в групповом звонке: опрашивает уровни звука и отдаёт
 * подсвечиваемых (speaking, вместе с собой) и «главного» говорящего из
 * собеседников (activeSpeaker) — его показывает режим «Говорящий».
 */
export function useSpeaking(getLevels: (() => Promise<AudioLevels>) | undefined, selfId: string, active: boolean) {
  const [speaking, setSpeaking] = useState<string[]>([]);
  const [activeSpeaker, setActiveSpeaker] = useState<string | null>(null);
  useEffect(() => {
    if (!active || !getLevels) {
      setSpeaking([]);
      return;
    }
    let alive = true;
    let busy = false;
    const lastLoud = new Map<string, number>();
    const loudSince = new Map<string, number>();
    let current: string | null = null;
    const tick = async () => {
      if (busy) return;
      busy = true;
      const lv = await getLevels().catch(() => null);
      busy = false;
      if (!alive || !lv) return;
      const now = Date.now();
      const all: Record<string, number> = { ...lv.peers, [selfId]: lv.local };
      for (const [id, v] of Object.entries(all)) {
        if (v >= THRESHOLD) {
          lastLoud.set(id, now);
          if (!loudSince.has(id)) loudSince.set(id, now);
        } else if (now - (lastLoud.get(id) || 0) > HANG_MS) {
          loudSince.delete(id);
        }
      }
      const sp = Object.keys(all).filter((id) => now - (lastLoud.get(id) || 0) <= HANG_MS).sort();
      setSpeaking((prev) => (prev.join() === sp.join() ? prev : sp));
      const currentQuiet = !current || now - (lastLoud.get(current) || 0) > SWITCH_QUIET_MS || !(current in lv.peers);
      if (currentQuiet) {
        const next = Object.keys(lv.peers)
          .filter((id) => loudSince.has(id) && now - (loudSince.get(id) || now) >= SWITCH_LOUD_MS)
          .sort((a, b) => (lv.peers[b] || 0) - (lv.peers[a] || 0))[0];
        if (next && next !== current) {
          current = next;
          setActiveSpeaker(next);
        }
      }
    };
    const timer = setInterval(tick, 250);
    void tick();
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [active, getLevels, selfId]);
  return { speaking, activeSpeaker };
}
