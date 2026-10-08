import { useEffect, useState } from "react";
import { Sparkles, Check, Lightbulb } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/api/client";

/** Отметки шкалы: полоска показывает путь до следующей. */
const STEPS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
const nextStep = (v: number) => STEPS.find((s) => s > v) ?? Math.ceil((v + 1) / 10000) * 10000;
const prevStep = (v: number) => [0, ...STEPS].filter((s) => s <= v).pop() ?? 0;

/**
 * Вайбометр в профиле. Чужой — можно один раз «поднять вайб» (+1).
 * Свой — только смотреть и узнать, как набрать: голоса за идеи в «Долгом
 * ящике» (+5) и лайки своих идей (+10). Сервер: chat/ideabox.py (VibeView).
 */
export default function Vibometer({ profileId, own, initial }: { profileId: string; own?: boolean; initial?: number | null }) {
  const navigate = useNavigate();
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
  const lo = prevStep(v), hi = nextStep(v);
  const pct = Math.max(4, Math.min(100, ((v - lo) / (hi - lo)) * 100));
  return (
    <div className="rounded-lg bg-surface-4 p-4">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-primary shrink-0" />
        <span className="text-h2 flex-1">Вайбометр</span>
        <span className="text-[22px] leading-none font-semibold tabular-nums">{vibe === null ? "…" : v}</span>
      </div>
      <div className="mt-3 h-2 rounded-full bg-surface-2 overflow-hidden" aria-hidden>
        <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${vibe === null ? 0 : pct}%` }} />
      </div>
      <p className="mt-1.5 text-caption text-subtle tabular-nums">до {hi} — ещё {Math.max(0, hi - v)}</p>
      {own ? (
        <button type="button" onClick={() => navigate("/profile/ideas")}
          className="mt-3 w-full h-10 rounded-md bg-surface-2 text-small font-medium flex items-center justify-center gap-2 active:opacity-80">
          <Lightbulb className="w-4 h-4" />Голосовать за идеи: +5 за голос, +10 за лайк вашей идеи
        </button>
      ) : voted ? (
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
