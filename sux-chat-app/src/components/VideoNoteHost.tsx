import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Pause, Play, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { t as tr } from "@/lib/i18n";
import { GlassTriangle, triClip } from "@/components/chat/media";
import {
  closeNoteFull, fmtNoteTime, nudgeNote, openNoteFull, seekNote, stopNote, toggleNote, useNoteHost, useVideoNote,
} from "@/lib/videoNote";

/**
 * Видео-сообщение вне ленты (lib/videoNote): экран целиком и плавающий
 * виджет. Живёт выше экранов (App), поэтому ролик идёт дальше, когда
 * треугольник уехал за край ленты или из чата вышли.
 *
 * Экран целиком: тап по центру — пауза/играть, по краям — ±2 секунды,
 * полоска внизу — перемотка, свайп вниз или Esc — назад (ролик продолжает
 * играть в ленте или виджетом). Виджет: тап — во весь экран, свайп в любую
 * сторону — закрыть (остановить).
 */
const SKIP = 2;
const FLOAT_SIZE = 112;

const FullNote = () => {
  const s = useVideoNote();
  const hostRef = useNoteHost(s.mode === "full", { fit: "contain" });
  const [flash, setFlash] = useState<null | "back" | "fwd">(null);
  const flashTimer = useRef<number>(0);
  const [drag, setDrag] = useState(0);
  const pan = useRef<{ id: number; x: number; y: number; at: number; on: boolean; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  // Клик, открывший экран, ещё всплывает, когда видео уже переехало сюда:
  // React находит для него нового родителя — наш onTap — и мотал бы на −2 с.
  // Клики старше момента появления экрана не наши.
  const mountedAt = useRef(performance.now());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); closeNoteFull(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); nudgeNote(-SKIP); }
      else if (e.key === "ArrowRight") { e.preventDefault(); nudgeNote(SKIP); }
      else if (e.key === " ") { e.preventDefault(); toggleNote(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const showFlash = (k: "back" | "fwd") => {
    setFlash(k);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 420);
  };

  // Свайп вниз — назад, как у картинок и видео (ImageViewer, VideoViewer).
  const onDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse") return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (e.clientY > r.bottom - 88) return; // полоска перемотки
    pan.current = { id: e.pointerId, x: e.clientX, y: e.clientY, at: performance.now(), on: false, moved: false };
  };
  const onMove = (e: React.PointerEvent) => {
    const p = pan.current;
    if (!p || p.id !== e.pointerId) return;
    const dy = e.clientY - p.y;
    if (Math.abs(dy) > 8 || Math.abs(e.clientX - p.x) > 8) p.moved = true;
    if (!p.on && dy > 12) p.on = true;
    if (p.on) setDrag(Math.max(0, dy));
  };
  const onUp = (e: React.PointerEvent) => {
    const p = pan.current;
    if (!p || p.id !== e.pointerId) return;
    pan.current = null;
    if (p.moved) suppressClick.current = true;
    const dy = e.clientY - p.y;
    const speed = dy / Math.max(1, performance.now() - p.at);
    if (p.on && (dy > 110 || (dy > 40 && speed > 0.6))) { setDrag(0); closeNoteFull(); return; }
    setDrag(0);
  };
  // Тап: края — перемотка на ±2 с, середина — пауза/играть.
  const onTap = (e: React.MouseEvent) => {
    if (suppressClick.current) { suppressClick.current = false; return; }
    if (e.timeStamp && e.timeStamp < mountedAt.current) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width;
    if (fx < 0.28) { nudgeNote(-SKIP); showFlash("back"); }
    else if (fx > 0.72) { nudgeNote(SKIP); showFlash("fwd"); }
    else toggleNote();
  };

  // Полоска перемотки: тап и ведение пальцем.
  const barRef = useRef<HTMLDivElement | null>(null);
  const seeking = useRef(false);
  const seekAt = (x: number) => {
    const r = barRef.current?.getBoundingClientRect();
    if (!r || !r.width || !s.duration) return;
    seekNote(Math.min(1, Math.max(0, (x - r.left) / r.width)) * s.duration);
  };
  const barDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    seeking.current = true;
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* не везде */ }
    seekAt(e.clientX);
  };
  const barMove = (e: React.PointerEvent) => { if (seeking.current) { e.stopPropagation(); seekAt(e.clientX); } };
  const barUp = (e: React.PointerEvent) => { if (seeking.current) { e.stopPropagation(); seeking.current = false; seekAt(e.clientX); } };

  const frac = s.duration ? Math.min(1, s.time / s.duration) : 0;
  const moving = !!pan.current?.on;
  return createPortal(
    <div
      className="fixed inset-0 z-[85] select-none"
      style={{ backgroundColor: `rgba(0,0,0,${1 - Math.min(drag / 450, 0.7)})`, transition: moving ? "none" : "background-color 180ms ease-out" }}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
      onClick={onTap}
    >
      <div
        ref={hostRef}
        className="absolute inset-0"
        style={{ transform: `translateY(${drag}px) scale(${1 - Math.min(drag / 1600, 0.15)})`, transition: moving ? "none" : "transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1)" }}
      />
      {/* Подсказка перемотки по краям */}
      {flash && (
        <div className={cn("absolute top-1/2 -translate-y-1/2 pointer-events-none rounded-full bg-black/55 text-white px-3 py-1.5 text-small tabular-nums", flash === "back" ? "left-6" : "right-6")}>
          {tr("{n} с", { n: flash === "back" ? `−${SKIP}` : `+${SKIP}` })}
        </div>
      )}
      {!s.playing && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="w-16 h-16 rounded-full bg-black/55 text-white flex items-center justify-center">
            <Play className="w-7 h-7 ml-1" fill="currentColor" />
          </span>
        </div>
      )}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); closeNoteFull(); }}
        onPointerDown={(e) => e.stopPropagation()}
        className="absolute left-3 w-10 h-10 rounded-full bg-black/55 text-white flex items-center justify-center active:opacity-70"
        style={{ top: "calc(var(--sat) + 0.5rem)", opacity: drag ? Math.max(0, 1 - drag / 120) : 1 }}
        aria-label={tr("Закрыть")}
      >
        <X className="w-6 h-6" />
      </button>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); stopNote(); }}
        onPointerDown={(e) => e.stopPropagation()}
        className="absolute right-3 h-10 px-3 rounded-full bg-black/55 text-white text-small flex items-center justify-center active:opacity-70"
        style={{ top: "calc(var(--sat) + 0.5rem)", opacity: drag ? Math.max(0, 1 - drag / 120) : 1 }}
      >
        {tr("Стоп")}
      </button>
      {/* Перемотка и время */}
      <div
        className="absolute left-0 right-0 px-4 pb-3 pt-6"
        style={{ bottom: "var(--sab)", opacity: drag ? Math.max(0, 1 - drag / 120) : 1 }}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 text-white">
          <button type="button" onClick={toggleNote} className="w-9 h-9 shrink-0 flex items-center justify-center rounded-full bg-white/15" aria-label={s.playing ? tr("Пауза") : tr("Играть")}>
            {s.playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
          </button>
          <span className="text-caption tabular-nums w-11 text-right">{fmtNoteTime(s.time)}</span>
          <div
            ref={barRef}
            role="slider"
            aria-label={tr("Перемотка")}
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(frac * 100)}
            className="flex-1 h-8 flex items-center cursor-pointer"
            style={{ touchAction: "none" }}
            onPointerDown={barDown} onPointerMove={barMove} onPointerUp={barUp} onPointerCancel={barUp}
          >
            <div className="relative w-full h-1 rounded-full bg-white/30">
              <div className="absolute left-0 top-0 h-full rounded-full bg-white" style={{ width: `${frac * 100}%` }} />
              <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-white shadow" style={{ left: `${frac * 100}%` }} />
            </div>
          </div>
          <span className="text-caption tabular-nums w-11">{fmtNoteTime(s.duration || s.note?.seconds || 0)}</span>
        </div>
      </div>
    </div>,
    document.body,
  );
};

const FloatNote = () => {
  const s = useVideoNote();
  const rim = 3;
  const innerH = FLOAT_SIZE - rim - rim * Math.sqrt(5);
  const clip = triClip(innerH, innerH, !!s.note?.flip);
  const hostRef = useNoteHost(s.mode === "float", { fit: "cover", clip });
  const [shift, setShift] = useState<{ x: number; y: number } | null>(null);
  const pan = useRef<{ id: number; x: number; y: number; at: number; moved: boolean } | null>(null);
  const onDown = (e: React.PointerEvent) => {
    pan.current = { id: e.pointerId, x: e.clientX, y: e.clientY, at: performance.now(), moved: false };
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* не везде */ }
  };
  const onMove = (e: React.PointerEvent) => {
    const p = pan.current;
    if (!p || p.id !== e.pointerId) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (Math.hypot(dx, dy) > 6) p.moved = true;
    if (p.moved) setShift({ x: dx, y: dy });
  };
  const onUp = (e: React.PointerEvent) => {
    const p = pan.current;
    if (!p || p.id !== e.pointerId) return;
    pan.current = null;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    const dist = Math.hypot(dx, dy);
    const speed = dist / Math.max(1, performance.now() - p.at);
    if (!p.moved) { setShift(null); openNoteFullFromFloat(); return; }
    // Свайп — закрыть: улетает в сторону жеста и останавливается.
    if (dist > 70 || speed > 0.6) {
      const k = 600 / Math.max(1, dist);
      setShift({ x: dx * k, y: dy * k });
      window.setTimeout(() => { stopNote(); setShift(null); }, 160);
      return;
    }
    setShift(null);
  };
  const dragging = !!pan.current?.moved;
  const far = shift ? Math.hypot(shift.x, shift.y) : 0;
  return (
    <div
      className="fixed z-30 right-3"
      style={{
        bottom: "calc(var(--sab, 0px) + 92px)",
        transform: shift ? `translate(${shift.x}px, ${shift.y}px)` : undefined,
        opacity: shift ? Math.max(0, 1 - far / 320) : 1,
        transition: dragging ? "none" : "transform 160ms ease-out, opacity 160ms ease-out",
        touchAction: "none",
      }}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
      role="button"
      aria-label={tr("Видео-сообщение")}
    >
      <GlassTriangle size={FLOAT_SIZE} flip={s.note?.flip}>
        <div ref={hostRef} className="absolute inset-0" />
        {!s.playing && (
          <span className="tri-play-pos" style={{ paddingBottom: 20 }}>
            <span className="tri-glass w-8 h-8 rounded-full flex items-center justify-center">
              <Play className="w-4 h-4 ml-0.5" fill="currentColor" />
            </span>
          </span>
        )}
        <span className="tri-pill tri-pill-pos absolute left-1/2 -translate-x-1/2 rounded-full px-1.5 text-[10px] leading-[14px] tabular-nums pointer-events-none">
          {fmtNoteTime(s.time)}
        </span>
      </GlassTriangle>
      {/* Крестик — для мыши: свайпом на компьютере неудобно. */}
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); stopNote(); }}
        className="hidden md:flex absolute -top-1 -right-1 w-6 h-6 rounded-full bg-black/60 text-white items-center justify-center"
        aria-label={tr("Закрыть")}
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

// Отложенно: клик по виджету не должен достаться экрану целиком, который появится на его месте.
const openNoteFullFromFloat = () => { window.setTimeout(openNoteFull, 0); };

const VideoNoteHost = () => {
  const mode = useVideoNote();
  if (!mode.note) return null;
  return (
    <>
      {mode.mode === "float" && <FloatNote />}
      {mode.mode === "full" && <FullNote />}
    </>
  );
};

export default VideoNoteHost;
