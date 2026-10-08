import { useEffect, useState } from "react";
import { Sparkles, Check } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/api/client";
import { useVibeLevels, vibeState } from "@/lib/vibeLevels";

/** Шкала и цвет — по уровням, которые настраивает админ (lib/vibeLevels.ts).
 *  Счётчик без предела. */
export function VibeBar({ vibe }: { vibe: number | null }) {
  const cfg = useVibeLevels();
  const st = vibeState(vibe ?? 0, cfg);
  const color = st.level?.color;
  return (
    <div className="mt-3 h-2 rounded-full bg-surface-2" aria-hidden>
      <div className={`h-full rounded-full transition-[width] duration-500 ${color ? "" : "bg-primary"} ${st.glow ? "vibe-glow-bar" : ""}`}
        style={{ width: `${vibe === null ? 0 : Math.max(4, st.fill * 100)}%`, ...(color ? { background: color, ["--vibe-c" as string]: color } : {}) }} />
    </div>
  );
}

/**
 * Вайбометр в профиле. Чужой — можно один раз «поднять вайб» (+1).
 * Свой — только смотреть. Баллы ещё и за голоса в «Долгом ящике» (+5) и
 * лайки своих идей (+10). Сервер: chat/ideabox.py (VibeView).
 */
export default function Vibometer({ profileId, own, initial }: { profileId: string; own?: boolean; initial?: number | null }) {
  const [vibe, setVibe] = useState<number | null>(initial ?? null);
  const [voted, setVoted] = useState(false);
  const [canVote, setCanVote] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let off = false;
    api.getVibe(profileId).then((s) => { if (!off) { setVibe(s.vibe); setVoted(s.voted); setCanVote(s.can_vote); } }).catch(() => {});
    return () => { off = true; };
  }, [profileId]);
  const raise = async () => {
    if (busy || !canVote) return;
    setBusy(true);
    setVibe((v) => (v ?? 0) + 1);
    setCanVote(false);
    try {
      const s = await api.raiseVibe(profileId);
      setVibe(s.vibe); setVoted(true);
    } catch (e: any) {
      if (e?.state) { setVibe(e.state.vibe); setVoted(e.state.voted); setCanVote(e.state.can_vote); }
      else { setVibe((v) => (v ?? 1) - 1); setCanVote(true); }
      toast.error(e?.message || "Не получилось");
    } finally { setBusy(false); }
  };
  const v = vibe ?? 0;
  const st = vibeState(v, useVibeLevels());
  return (
    <div className="rounded-lg bg-surface-4 p-4">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-primary shrink-0" />
        <span className="text-h2 flex-1">Вайбометр</span>
        {st.level && (
          <span className="px-2 h-6 rounded-full text-caption font-semibold flex items-center"
            style={{ color: st.level.color, background: `color-mix(in srgb, ${st.level.color} 16%, transparent)` }}>
            {st.level.name}
          </span>
        )}
        <span className="text-[22px] leading-none font-semibold tabular-nums" style={st.level ? { color: st.level.color } : undefined}>{vibe === null ? "…" : v}</span>
      </div>
      <VibeBar vibe={vibe} />
      {own ? null : voted ? (
        <p className="mt-3 h-10 rounded-md bg-surface-2 text-small text-subtle flex items-center justify-center gap-2">
          <Check className="w-4 h-4" />Вы подняли вайб
        </p>
      ) : canVote ? (
        <button type="button" onClick={raise} disabled={busy}
          className="mt-3 w-full h-10 rounded-md bg-primary text-primary-foreground text-small font-medium flex items-center justify-center gap-2 active:opacity-90 disabled:opacity-60">
          <Sparkles className="w-4 h-4" />Поднять вайб +1
        </button>
      ) : null}
    </div>
  );
}
