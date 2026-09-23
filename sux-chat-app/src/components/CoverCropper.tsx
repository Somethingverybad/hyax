import { useEffect, useRef, useState } from "react";
import { X, Check, ZoomIn } from "lucide-react";

/**
 * Кадрирование обложки профиля: картинку двигают пальцем, масштаб — щипком или
 * ползунком. Рамка 3:1 — пропорции баннера в профиле, поэтому человек видит
 * ровно ту часть снимка, которая потом и покажется.
 *
 * Режем на клиенте: на сервере нет Pillow, он кладёт файл как есть, и в
 * баннер высотой 144 px улетал полноразмерный снимок с камеры.
 */
export const COVER_ASPECT = 3;
const OUT_WIDTH = 1200;
const MAX_ZOOM = 4;

const CoverCropper = ({ file, onCancel, onDone }: {
  file: File;
  onCancel: () => void;
  onDone: (cropped: File) => void;
}) => {
  const frameRef = useRef<HTMLDivElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [frame, setFrame] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  // Жест: одним пальцем двигаем, двумя — масштабируем.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ dist: number; zoom: number; x: number; y: number; cx: number; cy: number } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const el = new Image();
    el.onload = () => setImg(el);
    el.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    const measure = () => {
      const w = frameRef.current?.clientWidth || 0;
      setFrame({ w, h: Math.round(w / COVER_ASPECT) });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Масштаб, при котором картинка закрывает рамку целиком.
  const base = img && frame.w
    ? Math.max(frame.w / img.naturalWidth, frame.h / img.naturalHeight)
    : 1;
  const shown = { w: (img?.naturalWidth || 0) * base * zoom, h: (img?.naturalHeight || 0) * base * zoom };

  /** Не отпускаем картинку от краёв рамки: пустоты в обложке быть не должно. */
  const clamp = (p: { x: number; y: number }, size = shown) => ({
    x: Math.min(0, Math.max(frame.w - size.w, p.x)),
    y: Math.min(0, Math.max(frame.h - size.h, p.y)),
  });

  useEffect(() => {
    if (img && frame.w) setPos(clamp({ x: (frame.w - shown.w) / 2, y: (frame.h - shown.h) / 2 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img, frame.w]);

  const applyZoom = (next: number, cx: number, cy: number) => {
    const z = Math.min(MAX_ZOOM, Math.max(1, next));
    setZoom(z);
    const size = { w: (img?.naturalWidth || 0) * base * z, h: (img?.naturalHeight || 0) * base * z };
    // Точка под пальцем (или под центром рамки) остаётся на месте.
    setPos((p) => clamp({
      x: cx - ((cx - p.x) / zoom) * z,
      y: cy - ((cy - p.y) / zoom) * z,
    }, size));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const rect = frameRef.current!.getBoundingClientRect();
      gesture.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        zoom,
        x: pos.x, y: pos.y,
        cx: (a.x + b.x) / 2 - rect.left,
        cy: (a.y + b.y) / 2 - rect.top,
      };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size >= 2 && gesture.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      applyZoom(gesture.current.zoom * (dist / gesture.current.dist), gesture.current.cx, gesture.current.cy);
      return;
    }
    setPos((p) => clamp({ x: p.x + (e.clientX - prev.x), y: p.y + (e.clientY - prev.y) }));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gesture.current = null;
  };

  const save = async () => {
    if (!img || busy) return;
    setBusy(true);
    try {
      const k = base * zoom;            // экранные пиксели на пиксель снимка
      const canvas = document.createElement("canvas");
      canvas.width = OUT_WIDTH;
      canvas.height = Math.round(OUT_WIDTH / COVER_ASPECT);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("нет холста");
      ctx.drawImage(
        img,
        -pos.x / k, -pos.y / k, frame.w / k, frame.h / k,
        0, 0, canvas.width, canvas.height,
      );
      const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.85));
      if (!blob) throw new Error("не вышло");
      onDone(new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" }));
    } catch {
      // Не вышло обрезать — отдаём как есть, лучше так, чем ничего.
      onDone(file);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/90 flex flex-col">
      {/* pad-safe-top: иначе кнопки уезжают под строку состояния и островок. */}
      <div className="flex items-center justify-between px-4 min-h-14 pad-safe-top shrink-0">
        <button type="button" onClick={onCancel} className="ui-icon-btn p-2 text-white" aria-label="Отмена">
          <X className="w-5 h-5" />
        </button>
        <span className="text-small text-white/80 px-2 text-center">Двигайте и щипком меняйте масштаб</span>
        <button type="button" onClick={save} disabled={!img || busy} className="ui-icon-btn p-2 text-white disabled:opacity-50" aria-label="Готово">
          <Check className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center px-4">
        <div
          ref={frameRef}
          className="w-full max-w-[560px] overflow-hidden bg-black border border-white/30 touch-none select-none"
          style={{ height: frame.h || undefined }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {img && (
            <img
              src={img.src}
              alt=""
              draggable={false}
              style={{
                width: shown.w,
                height: shown.h,
                transform: `translate(${pos.x}px, ${pos.y}px)`,
                maxWidth: "none",
              }}
            />
          )}
        </div>
      </div>

      <div className="px-6 pt-2 pb-[calc(var(--sab)+24px)] flex items-center gap-3 shrink-0">
        <ZoomIn className="w-4 h-4 text-white/70 shrink-0" />
        <input
          type="range"
          min={1}
          max={MAX_ZOOM}
          step={0.01}
          value={zoom}
          onChange={(e) => applyZoom(Number(e.target.value), frame.w / 2, frame.h / 2)}
          className="flex-1 accent-primary"
          aria-label="Масштаб"
        />
      </div>
    </div>
  );
};

export default CoverCropper;
