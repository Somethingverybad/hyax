import { useRef, useState } from "react";
import { Play, X } from "lucide-react";
import { t as tr } from "@/lib/i18n";
import { GlassTriangle, triClip } from "@/components/chat/media";
import {
  fmtNoteTime, stopNote, toggleNote, useNoteHost, useVideoNote,
} from "@/lib/videoNote";

/**
 * Видео-сообщение вне ленты (lib/videoNote): плавающий виджет. Живёт выше
 * экранов (App), поэтому ролик идёт дальше, когда треугольник уехал за край
 * ленты или из чата вышли. Тап — пауза/играть, свайп в любую сторону —
 * закрыть (остановить). Увеличенный просмотр и перемотка — на месте, в ленте
 * (chat/media.tsx VideoNote), как в Telegram.
 */
const FLOAT_SIZE = 112;

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
    if (!p.moved) { setShift(null); toggleNote(); return; }
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

const VideoNoteHost = () => {
  const mode = useVideoNote();
  if (!mode.note) return null;
  return mode.mode === "float" ? <FloatNote /> : null;
};

export default VideoNoteHost;
