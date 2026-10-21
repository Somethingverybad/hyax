import { t as tr } from "@/lib/i18n";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Pause, Play, SkipBack, SkipForward, X, Volume1, Volume2, VolumeX } from "lucide-react";
import { currentTrack, fmtTime, next, prev, seek, setVolume, stop, toggle, usePlayer } from "@/lib/player";
import ShareTrackButton from "@/components/music/ShareTrackButton";
import { useIsMobile } from "@/hooks/use-mobile";

/**
 * Мини-плеер: полоса под шапкой — там же, где полоса закреплённого сообщения.
 * Появляется, когда играет трек, и не пропадает при переходе в другой чат:
 * очередь живёт в @/lib/player, а не на экране.
 *
 * Закреп при этом съезжает вниз на высоту плеера: обе полосы стоят в одном
 * месте, поэтому высоту плеер сообщает переменной --player-h, а закреп по ней
 * сдвигается (см. ChatWindow и index.css).
 */
/** Перемотка: тап — в точку, можно вести пальцем (палец показывает место,
 *  плеер встаёт туда при отпускании). В эфире закрыта — там место задаёт
 *  расписание станции. */
const SeekBar = ({ time, duration, live }: { time: number; duration: number; live: boolean }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const fracAt = (x: number) => {
    const r = ref.current?.getBoundingClientRect();
    return r && r.width ? Math.min(1, Math.max(0, (x - r.left) / r.width)) : 0;
  };
  const down = (e: React.PointerEvent) => {
    if (live || !duration) return;
    e.stopPropagation();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* не везде */ }
    setDrag(fracAt(e.clientX));
  };
  const move = (e: React.PointerEvent) => { if (drag !== null) setDrag(fracAt(e.clientX)); };
  const up = (e: React.PointerEvent) => {
    if (drag === null) return;
    const f = fracAt(e.clientX);
    setDrag(null);
    seek(f * duration);
  };
  const frac = drag ?? (duration ? Math.min(1, time / duration) : 0);
  return (
    <div
      ref={ref}
      role="slider"
      aria-label={tr("Перемотка")}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(frac * 100)}
      className={live ? "h-1 bg-black/20" : "relative h-3 flex items-center cursor-pointer select-none"}
      style={{ touchAction: "none" }}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(null)}
    >
      {live ? null : (
        <>
          <div className="absolute inset-x-0 top-0 h-1 bg-black/20">
            <div className="h-full bg-primary" style={{ width: `${frac * 100}%` }} />
          </div>
          {/* Ручка — только пока ведут: в покое полоска тонкая, как была. */}
          {drag !== null && (
            <div className="absolute top-0.5 -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-primary shadow" style={{ left: `${frac * 100}%` }} />
          )}
        </>
      )}
    </div>
  );
};

const MiniPlayer = () => {
  const s = usePlayer();
  const t = currentTrack();
  const box = useRef<HTMLDivElement>(null);
  // На вкладке «Музыка» плеер — часть экрана (PlayerPanel), полоска там лишняя.
  const { pathname } = useLocation();
  // Десктоп: на экранах с панелью разделов слева плеер стоит в ней (RailPlayer).
  const desktop = useIsMobile() === false;
  const onMusicTab = pathname.startsWith("/music") || (desktop && /^\/(chat|wall|saved|profile)\/?$/.test(pathname));
  // Голосовое из открытого чата: им управляет сам пузырь в ленте, полоска не нужна —
  // появится, когда из чата выйдут (lib/player: Track.chatId).
  const inItsChat = !!t && t.kind === "voice" && !!t.chatId && s.openChat === t.chatId;

  // Высота полосы — наружу: по ней сдвигается закреплённое сообщение.
  useEffect(() => {
    const root = document.documentElement;
    // На «Музыке» полоски нет — и места она не занимает (иначе виджет
    // свёрнутого звонка висел бы ниже пустоты).
    if (!t || onMusicTab || inItsChat) { root.style.setProperty("--player-h", "0px"); return; }
    const h = box.current?.offsetHeight || 56;
    root.style.setProperty("--player-h", `${h}px`);
    return () => { root.style.setProperty("--player-h", "0px"); };
  }, [t?.id, !!t, onMusicTab, inItsChat]);

  if (!t || onMusicTab || inItsChat) return null;

  const frac = s.duration ? Math.min(1, s.time / s.duration) : 0;

  return (
    <div
      ref={box}
      className="player-bar fixed left-0 right-0 z-[19] px-2 md:left-auto md:right-3 md:w-[380px]"
      style={{ top: "var(--player-top, calc(var(--sat) + 56px))" }}
    >
      <div className="rounded-lg border border-border bg-surface-2 shadow-lg overflow-hidden">
        <SeekBar time={s.time} duration={s.duration} live={!!s.live} />
        <div className="flex items-center gap-2 px-2 py-2">
          {/* В эфире треки переключает расписание станции (@/lib/radio). */}
          {!s.live && (
            <button type="button" onClick={() => void prev()} className="w-8 h-8 shrink-0 flex items-center justify-center text-subtle" aria-label={tr("Предыдущий")}>
              <SkipBack className="w-4 h-4" />
            </button>
          )}
          <button type="button" onClick={() => void toggle()} className="w-9 h-9 shrink-0 rounded-md bg-primary text-primary-foreground flex items-center justify-center" aria-label={s.playing ? tr("Пауза") : tr("Играть")}>
            {s.playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
          {!s.live && (
            <button type="button" onClick={() => void next()} className="w-8 h-8 shrink-0 flex items-center justify-center text-subtle" aria-label={tr("Следующий")}>
              <SkipForward className="w-4 h-4" />
            </button>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-small truncate">{t.title}</div>
            <div className="text-caption text-subtle tabular-nums truncate">
              {fmtTime(s.time)}{s.duration ? ` / ${fmtTime(s.duration)}` : ""}
              {s.live ? ` · 📻 ${s.live.name}` : s.queue.length > 1 && ` · ${tr("{i} из {n}", { i: s.index + 1, n: s.queue.length })}`}
            </div>
          </div>
          {/* Громкость — только на десктопе: на телефоне есть кнопки, а место дорого. */}
          <div className="hidden md:flex items-center gap-1 shrink-0" title={tr("Громкость")}>
            <button type="button" onClick={() => setVolume(s.volume > 0 ? 0 : 1)} className="w-7 h-7 flex items-center justify-center text-subtle" aria-label={s.volume > 0 ? tr("Выключить звук") : tr("Включить звук")}>
              {s.volume === 0 ? <VolumeX className="w-4 h-4" /> : s.volume < 0.5 ? <Volume1 className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
            <input type="range" min={0} max={1} step={0.02} value={s.volume} onChange={(e) => setVolume(Number(e.target.value))}
              className="w-20 h-1 accent-primary cursor-pointer" aria-label={tr("Громкость")} />
          </div>
          {t.kind !== "voice" && <ShareTrackButton track={t} className="w-8 h-8" />}
          <button type="button" onClick={stop} className="w-8 h-8 shrink-0 flex items-center justify-center text-subtle" aria-label={tr("Закрыть плеер")}>
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default MiniPlayer;
