import { useEffect, useRef } from "react";
import { Pause, Play, SkipBack, SkipForward, X } from "lucide-react";
import { currentTrack, fmtTime, next, prev, seek, stop, toggle, usePlayer } from "@/lib/player";

/**
 * Мини-плеер: полоса под шапкой — там же, где полоса закреплённого сообщения.
 * Появляется, когда играет трек, и не пропадает при переходе в другой чат:
 * очередь живёт в @/lib/player, а не на экране.
 *
 * Закреп при этом съезжает вниз на высоту плеера: обе полосы стоят в одном
 * месте, поэтому высоту плеер сообщает переменной --player-h, а закреп по ней
 * сдвигается (см. ChatWindow и index.css).
 */
const MiniPlayer = () => {
  const s = usePlayer();
  const t = currentTrack();
  const box = useRef<HTMLDivElement>(null);

  // Высота полосы — наружу: по ней сдвигается закреплённое сообщение.
  useEffect(() => {
    const root = document.documentElement;
    if (!t) { root.style.setProperty("--player-h", "0px"); return; }
    const h = box.current?.offsetHeight || 56;
    root.style.setProperty("--player-h", `${h}px`);
    return () => { root.style.setProperty("--player-h", "0px"); };
  }, [t?.id, !!t]);

  if (!t) return null;

  const frac = s.duration ? Math.min(1, s.time / s.duration) : 0;

  return (
    <div
      ref={box}
      className="player-bar fixed left-0 right-0 z-30 px-2 md:left-auto md:right-3 md:w-[380px]"
      style={{ top: "var(--player-top, calc(var(--sat) + 56px))" }}
    >
      <div className="rounded-lg border border-border bg-surface-2 shadow-lg overflow-hidden">
        <div
          className="h-1 bg-black/20 cursor-pointer"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            if (s.duration) seek(((e.clientX - r.left) / r.width) * s.duration);
          }}
        >
          <div className="h-full bg-primary" style={{ width: `${frac * 100}%` }} />
        </div>
        <div className="flex items-center gap-2 px-2 py-2">
          <button type="button" onClick={() => void prev()} className="w-8 h-8 shrink-0 flex items-center justify-center text-subtle" aria-label="Предыдущий">
            <SkipBack className="w-4 h-4" />
          </button>
          <button type="button" onClick={() => void toggle()} className="w-9 h-9 shrink-0 rounded-md bg-primary text-primary-foreground flex items-center justify-center" aria-label={s.playing ? "Пауза" : "Играть"}>
            {s.playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
          <button type="button" onClick={() => void next()} className="w-8 h-8 shrink-0 flex items-center justify-center text-subtle" aria-label="Следующий">
            <SkipForward className="w-4 h-4" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-small truncate">{t.title}</div>
            <div className="text-caption text-subtle tabular-nums">
              {fmtTime(s.time)}{s.duration ? ` / ${fmtTime(s.duration)}` : ""}
              {s.queue.length > 1 && ` · ${s.index + 1} из ${s.queue.length}`}
            </div>
          </div>
          <button type="button" onClick={stop} className="w-8 h-8 shrink-0 flex items-center justify-center text-subtle" aria-label="Закрыть плеер">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default MiniPlayer;
