import { t as tr } from "@/lib/i18n";
import { useEffect, useRef } from "react";
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
const MiniPlayer = () => {
  const s = usePlayer();
  const t = currentTrack();
  const box = useRef<HTMLDivElement>(null);
  // На вкладке «Музыка» плеер — часть экрана (PlayerPanel), полоска там лишняя.
  const { pathname } = useLocation();
  // Десктоп: на экранах с панелью разделов слева плеер стоит в ней (RailPlayer).
  const desktop = useIsMobile() === false;
  const onMusicTab = pathname.startsWith("/music") || (desktop && /^\/(chat|wall|saved|profile)\/?$/.test(pathname));

  // Высота полосы — наружу: по ней сдвигается закреплённое сообщение.
  useEffect(() => {
    const root = document.documentElement;
    // На «Музыке» полоски нет — и места она не занимает (иначе виджет
    // свёрнутого звонка висел бы ниже пустоты).
    if (!t || onMusicTab) { root.style.setProperty("--player-h", "0px"); return; }
    const h = box.current?.offsetHeight || 56;
    root.style.setProperty("--player-h", `${h}px`);
    return () => { root.style.setProperty("--player-h", "0px"); };
  }, [t?.id, !!t, onMusicTab]);

  if (!t || onMusicTab) return null;

  const frac = s.duration ? Math.min(1, s.time / s.duration) : 0;

  return (
    <div
      ref={box}
      className="player-bar fixed left-0 right-0 z-30 px-2 md:left-auto md:right-3 md:w-[380px]"
      style={{ top: "var(--player-top, calc(var(--sat) + 56px))" }}
    >
      <div className="rounded-lg border border-border bg-surface-2 shadow-lg overflow-hidden">
        <div
          className={s.live ? "h-1 bg-black/20" : "h-1 bg-black/20 cursor-pointer"}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            if (s.duration) seek(((e.clientX - r.left) / r.width) * s.duration);
          }}
        >
          <div className="h-full bg-primary" style={{ width: `${frac * 100}%` }} />
        </div>
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
          <ShareTrackButton track={t} className="w-8 h-8" />
          <button type="button" onClick={stop} className="w-8 h-8 shrink-0 flex items-center justify-center text-subtle" aria-label={tr("Закрыть плеер")}>
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default MiniPlayer;
