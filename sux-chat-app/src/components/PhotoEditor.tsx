import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Check, Crop, RotateCw, FlipHorizontal2, Undo2, Eraser, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Редактор фото перед отправкой — как в Telegram: рисовалка, кадрирование,
 * поворот и отражение. Открывается тапом по превью вложения в композере.
 *
 * Устройство: `work` — холст с текущими пикселями (поворот, отражение и
 * кадрирование запекаются в него сразу), штрихи живут отдельным слоем
 * `ink` того же размера, чтобы их можно было отменять и стирать ластиком,
 * не трогая снимок. Перед любой геометрией и на выходе слой запекается.
 * На экране — один display-холст: work + ink, вписанный в сцену.
 */
type Tool = "draw" | "crop";
type Pt = { x: number; y: number };
type Stroke = { color: string; width: number; erase: boolean; points: Pt[] };
type Rect = { x: number; y: number; w: number; h: number };
type Aspect = { label: string; value: number | null };

const COLORS = ["#ffffff", "#0a0a0a", "#ff3b30", "#ff9500", "#ffd60a", "#30d158", "#0a84ff", "#bf5af2"];
const SIZES = [4, 9, 16];
const ASPECTS: Aspect[] = [
  { label: "Свободно", value: null }, { label: "1:1", value: 1 }, { label: "4:3", value: 4 / 3 },
  { label: "3:4", value: 3 / 4 }, { label: "16:9", value: 16 / 9 }, { label: "9:16", value: 9 / 16 },
];
const MAX_SIDE = 2048;
const HANDLE = 28;
const MIN_CROP = 48;

const makeCanvas = (w: number, h: number) => {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
};

const drawStroke = (ctx: CanvasRenderingContext2D, s: Stroke, from = 0) => {
  if (s.points.length === 0) return;
  ctx.save();
  ctx.globalCompositeOperation = s.erase ? "destination-out" : "source-over";
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineWidth = s.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (s.points.length === 1) {
    const p = s.points[0];
    ctx.beginPath(); ctx.arc(p.x, p.y, s.width / 2, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.beginPath();
    const start = Math.max(0, from - 1);
    ctx.moveTo(s.points[start].x, s.points[start].y);
    for (let i = start + 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y);
    ctx.stroke();
  }
  ctx.restore();
};

const PhotoEditor = ({ file, onCancel, onDone }: {
  file: File;
  onCancel: () => void;
  onDone: (edited: File) => void;
}) => {
  const stageRef = useRef<HTMLDivElement>(null);
  const displayRef = useRef<HTMLCanvasElement>(null);
  const workRef = useRef<HTMLCanvasElement | null>(null);
  const inkRef = useRef<HTMLCanvasElement | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const currentRef = useRef<Stroke | null>(null);
  const drawingPointer = useRef<number | null>(null);
  const [version, setVersion] = useState(0);       // work поменялся — пересчитать бокс
  const [strokeCount, setStrokeCount] = useState(0); // для кнопки «отменить»
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [tool, setTool] = useState<Tool>("draw");
  const [color, setColor] = useState(COLORS[2]);
  const [size, setSize] = useState(SIZES[1]);
  const [erase, setErase] = useState(false);
  const [crop, setCrop] = useState<Rect | null>(null);
  const [aspect, setAspect] = useState<number | null>(null);
  const cropDrag = useRef<{ mode: "move" | "nw" | "ne" | "sw" | "se"; start: Pt; rect: Rect } | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  // Загрузка: снимок → work (не больше MAX_SIDE по стороне), чистый ink.
  const load = async () => {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const work = makeCanvas(bmp.width * k, bmp.height * k);
    work.getContext("2d")!.drawImage(bmp, 0, 0, work.width, work.height);
    bmp.close?.();
    workRef.current = work;
    inkRef.current = makeCanvas(work.width, work.height);
    strokesRef.current = [];
    setStrokeCount(0);
    setVersion((v) => v + 1);
    setReady(true);
  };
  useEffect(() => { void load().catch(() => onCancel()); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [file]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setStage({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Бокс: work, вписанный в сцену с полями.
  const work = workRef.current;
  const box: Rect = (() => {
    if (!work || !stage.w || !stage.h) return { x: 0, y: 0, w: 0, h: 0 };
    const k = Math.min((stage.w - 16) / work.width, (stage.h - 16) / work.height);
    const w = Math.floor(work.width * k), h = Math.floor(work.height * k);
    return { x: Math.round((stage.w - w) / 2), y: Math.round((stage.h - h) / 2), w, h };
  })();
  const kWork = box.w ? (work?.width || 1) / box.w : 1; // пиксели снимка на экранный пиксель

  const refresh = () => {
    const d = displayRef.current, w = workRef.current, ink = inkRef.current;
    if (!d || !w || !ink || !box.w) return;
    const ctx = d.getContext("2d")!;
    ctx.clearRect(0, 0, d.width, d.height);
    ctx.drawImage(w, 0, 0, d.width, d.height);
    ctx.drawImage(ink, 0, 0, d.width, d.height);
  };
  useEffect(() => {
    const d = displayRef.current;
    if (!d || !box.w) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    d.width = Math.round(box.w * dpr);
    d.height = Math.round(box.h * dpr);
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box.w, box.h, version]);

  const rebuildInk = () => {
    const ink = inkRef.current;
    if (!ink) return;
    const ctx = ink.getContext("2d")!;
    ctx.clearRect(0, 0, ink.width, ink.height);
    strokesRef.current.forEach((s) => drawStroke(ctx, s));
    refresh();
  };

  /** Запечь штрихи в снимок — перед геометрией и на выходе. */
  const bake = () => {
    const w = workRef.current, ink = inkRef.current;
    if (!w || !ink) return;
    if (strokesRef.current.length) {
      w.getContext("2d")!.drawImage(ink, 0, 0);
      ink.getContext("2d")!.clearRect(0, 0, ink.width, ink.height);
      strokesRef.current = [];
      setStrokeCount(0);
    }
  };

  const replaceWork = (next: HTMLCanvasElement) => {
    workRef.current = next;
    inkRef.current = makeCanvas(next.width, next.height);
    setVersion((v) => v + 1);
  };

  const rotate = () => {
    const w = workRef.current; if (!w) return;
    bake();
    const c = makeCanvas(w.height, w.width);
    const ctx = c.getContext("2d")!;
    ctx.translate(c.width, 0); ctx.rotate(Math.PI / 2); ctx.drawImage(w, 0, 0);
    replaceWork(c);
  };
  const flip = () => {
    const w = workRef.current; if (!w) return;
    bake();
    const c = makeCanvas(w.width, w.height);
    const ctx = c.getContext("2d")!;
    ctx.translate(c.width, 0); ctx.scale(-1, 1); ctx.drawImage(w, 0, 0);
    replaceWork(c);
  };
  const undo = () => {
    if (!strokesRef.current.length) return;
    strokesRef.current.pop();
    setStrokeCount(strokesRef.current.length);
    rebuildInk();
  };
  const reset = () => { setTool("draw"); setCrop(null); void load(); };

  // ---- Рисование -------------------------------------------------------
  const toWork = (e: React.PointerEvent): Pt => {
    const r = displayRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) * kWork, y: (e.clientY - r.top) * kWork };
  };
  const drawDown = (e: React.PointerEvent) => {
    if (tool !== "draw" || drawingPointer.current !== null) return;
    drawingPointer.current = e.pointerId;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const s: Stroke = { color, width: size * kWork, erase, points: [toWork(e)] };
    currentRef.current = s;
    drawStroke(inkRef.current!.getContext("2d")!, s);
    refresh();
  };
  const drawMove = (e: React.PointerEvent) => {
    const s = currentRef.current;
    if (!s || e.pointerId !== drawingPointer.current) return;
    s.points.push(toWork(e));
    drawStroke(inkRef.current!.getContext("2d")!, s, s.points.length - 1);
    refresh();
  };
  const drawUp = (e: React.PointerEvent) => {
    if (e.pointerId !== drawingPointer.current) return;
    drawingPointer.current = null;
    const s = currentRef.current;
    currentRef.current = null;
    if (s) { strokesRef.current.push(s); setStrokeCount(strokesRef.current.length); }
  };

  // ---- Кадрирование ------------------------------------------------------
  const fitAspect = (a: number | null): Rect => {
    if (!a) return { x: 0, y: 0, w: box.w, h: box.h };
    let w = box.w, h = w / a;
    if (h > box.h) { h = box.h; w = h * a; }
    return { x: (box.w - w) / 2, y: (box.h - h) / 2, w, h };
  };
  const startCrop = () => { setAspect(null); setCrop(fitAspect(null)); setTool("crop"); };
  const pickAspect = (a: number | null) => { setAspect(a); setCrop(fitAspect(a)); };
  const clampRect = (r: Rect): Rect => ({
    x: Math.max(0, Math.min(r.x, box.w - r.w)), y: Math.max(0, Math.min(r.y, box.h - r.h)),
    w: Math.min(r.w, box.w), h: Math.min(r.h, box.h),
  });
  const cropDown = (e: React.PointerEvent) => {
    if (!crop) return;
    const r = e.currentTarget.getBoundingClientRect();
    const p = { x: e.clientX - r.left, y: e.clientY - r.top };
    const near = (x: number, y: number) => Math.abs(p.x - x) <= HANDLE && Math.abs(p.y - y) <= HANDLE;
    const mode = near(crop.x, crop.y) ? "nw" : near(crop.x + crop.w, crop.y) ? "ne"
      : near(crop.x, crop.y + crop.h) ? "sw" : near(crop.x + crop.w, crop.y + crop.h) ? "se"
      : (p.x >= crop.x && p.x <= crop.x + crop.w && p.y >= crop.y && p.y <= crop.y + crop.h) ? "move" : null;
    if (!mode) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    cropDrag.current = { mode, start: p, rect: crop };
  };
  const cropMove = (e: React.PointerEvent) => {
    const d = cropDrag.current;
    if (!d) return;
    const r = e.currentTarget.getBoundingClientRect();
    const dx = e.clientX - r.left - d.start.x, dy = e.clientY - r.top - d.start.y;
    const o = d.rect;
    if (d.mode === "move") { setCrop(clampRect({ ...o, x: o.x + dx, y: o.y + dy })); return; }
    // Тянем угол: противоположный стоит на месте, размер — расстояние до него.
    const east = d.mode.includes("e"), south = d.mode.includes("s");
    const fx = east ? o.x : o.x + o.w;               // неподвижная вертикальная грань
    const fy = south ? o.y : o.y + o.h;              // неподвижная горизонтальная грань
    const mx = (east ? o.x + o.w : o.x) + dx;        // подвижный угол
    const my = (south ? o.y + o.h : o.y) + dy;
    const roomW = east ? box.w - fx : fx, roomH = south ? box.h - fy : fy;
    let w = Math.min(roomW, Math.max(MIN_CROP, east ? mx - fx : fx - mx));
    let h = Math.min(roomH, Math.max(MIN_CROP, south ? my - fy : fy - my));
    if (aspect) {
      h = w / aspect;
      if (h > roomH) { h = roomH; w = h * aspect; }
      if (h < MIN_CROP) { h = MIN_CROP; w = h * aspect; }
    }
    setCrop({ x: east ? fx : fx - w, y: south ? fy : fy - h, w, h });
  };
  const cropUp = () => { cropDrag.current = null; };
  const applyCrop = () => {
    const w = workRef.current;
    if (!w || !crop) return;
    bake();
    const sx = Math.round(crop.x * kWork), sy = Math.round(crop.y * kWork);
    const sw = Math.max(1, Math.round(crop.w * kWork)), sh = Math.max(1, Math.round(crop.h * kWork));
    const c = makeCanvas(sw, sh);
    c.getContext("2d")!.drawImage(w, sx, sy, sw, sh, 0, 0, sw, sh);
    replaceWork(c);
    setCrop(null);
    setTool("draw");
  };

  const save = async () => {
    const w = workRef.current;
    if (!w || busy) return;
    setBusy(true);
    try {
      bake();
      const png = file.type === "image/png";
      const blob: Blob | null = await new Promise((res) => w.toBlob(res, png ? "image/png" : "image/jpeg", 0.9));
      if (!blob) throw new Error("не вышло");
      const name = file.name.replace(/\.[^.]+$/, "") + (png ? ".png" : ".jpg");
      onDone(new File([blob], name, { type: blob.type }));
    } catch {
      onDone(file);
    } finally {
      setBusy(false);
    }
  };

  const toolBtn = "flex flex-col items-center gap-1 min-w-16 text-[11px] text-white/85 active:opacity-70";
  const toolIcon = "w-11 h-11 rounded-full bg-white/10 flex items-center justify-center";

  // Порталом на body: открывается из панели ввода с transform под клавиатуру.
  return createPortal(
    <div className="fixed inset-0 z-[85] bg-black flex flex-col select-none">
      <div className="flex items-center justify-between px-3 min-h-14 pad-safe-top shrink-0">
        <button type="button" onClick={tool === "crop" ? () => { setCrop(null); setTool("draw"); } : onCancel} className="w-10 h-10 rounded-full text-white flex items-center justify-center active:opacity-70" aria-label="Отмена">
          <X className="w-6 h-6" />
        </button>
        <div className="flex items-center gap-1">
          {tool === "draw" && (
            <>
              <button type="button" onClick={undo} disabled={!strokeCount} className="w-10 h-10 rounded-full text-white flex items-center justify-center disabled:opacity-30 active:opacity-70" aria-label="Отменить штрих">
                <Undo2 className="w-5 h-5" />
              </button>
              <button type="button" onClick={reset} className="w-10 h-10 rounded-full text-white flex items-center justify-center active:opacity-70" aria-label="Сбросить всё">
                <RotateCcw className="w-5 h-5" />
              </button>
            </>
          )}
        </div>
        <button type="button" onClick={tool === "crop" ? applyCrop : save} disabled={!ready || busy} className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-50 active:opacity-80" aria-label={tool === "crop" ? "Применить" : "Готово"}>
          <Check className="w-6 h-6" />
        </button>
      </div>

      <div ref={stageRef} className="flex-1 relative min-h-0 overflow-hidden">
        {!ready && <p className="absolute inset-0 flex items-center justify-center text-white/60 text-small">Загрузка…</p>}
        <canvas
          ref={displayRef}
          className={cn("absolute touch-none", tool === "draw" ? "cursor-crosshair" : "pointer-events-none")}
          style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
          onPointerDown={drawDown}
          onPointerMove={drawMove}
          onPointerUp={drawUp}
          onPointerCancel={drawUp}
        />
        {tool === "crop" && crop && (
          <div
            className="absolute touch-none overflow-hidden"
            style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
            onPointerDown={cropDown}
            onPointerMove={cropMove}
            onPointerUp={cropUp}
            onPointerCancel={cropUp}
          >
            <div
              className="absolute border border-white/90"
              style={{ left: crop.x, top: crop.y, width: crop.w, height: crop.h, boxShadow: "0 0 0 9999px rgba(0,0,0,0.6)" }}
            >
              {/* Сетка третей и уголки */}
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute top-1/3 inset-x-0 border-t border-white/30" />
                <div className="absolute top-2/3 inset-x-0 border-t border-white/30" />
                <div className="absolute left-1/3 inset-y-0 border-l border-white/30" />
                <div className="absolute left-2/3 inset-y-0 border-l border-white/30" />
              </div>
              {(["nw", "ne", "sw", "se"] as const).map((c) => (
                <span key={c} className={cn("absolute w-5 h-5 border-white border-[3px]",
                  c === "nw" && "-left-0.5 -top-0.5 border-r-0 border-b-0",
                  c === "ne" && "-right-0.5 -top-0.5 border-l-0 border-b-0",
                  c === "sw" && "-left-0.5 -bottom-0.5 border-r-0 border-t-0",
                  c === "se" && "-right-0.5 -bottom-0.5 border-l-0 border-t-0")} />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="shrink-0 px-3 pt-3 pb-[calc(var(--sab)+12px)] space-y-3">
        {tool === "draw" ? (
          <>
            <div className="flex items-center justify-center gap-2.5">
              {COLORS.map((c) => (
                <button key={c} type="button" onClick={() => { setColor(c); setErase(false); }} aria-label={c}
                  className={cn("w-7 h-7 rounded-full border-2 transition-transform", color === c && !erase ? "border-white scale-125" : "border-white/30")}
                  style={{ background: c }} />
              ))}
              <button type="button" onClick={() => setErase((v) => !v)} aria-label="Ластик"
                className={cn("w-8 h-8 rounded-full flex items-center justify-center border-2", erase ? "border-white bg-white/20 text-white" : "border-white/30 text-white/70")}>
                <Eraser className="w-4 h-4" />
              </button>
            </div>
            <div className="flex items-center justify-center gap-4">
              {SIZES.map((s) => (
                <button key={s} type="button" onClick={() => setSize(s)} aria-label={`Толщина ${s}`}
                  className={cn("w-9 h-9 rounded-full flex items-center justify-center", size === s ? "bg-white/20" : "bg-white/5")}>
                  <span className="rounded-full bg-white" style={{ width: s + 2, height: s + 2 }} />
                </button>
              ))}
            </div>
            <div className="flex items-center justify-center gap-2 pt-1">
              <button type="button" onClick={startCrop} disabled={!ready} className={toolBtn}><span className={toolIcon}><Crop className="w-5 h-5" /></span>Кадр</button>
              <button type="button" onClick={rotate} disabled={!ready} className={toolBtn}><span className={toolIcon}><RotateCw className="w-5 h-5" /></span>Повернуть</button>
              <button type="button" onClick={flip} disabled={!ready} className={toolBtn}><span className={toolIcon}><FlipHorizontal2 className="w-5 h-5" /></span>Отразить</button>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-2 overflow-x-auto justify-center py-2">
            {ASPECTS.map((a) => (
              <button key={a.label} type="button" onClick={() => pickAspect(a.value)}
                className={cn("shrink-0 h-9 px-3.5 rounded-full text-small font-medium", aspect === a.value ? "bg-white text-black" : "bg-white/10 text-white")}>
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};

export default PhotoEditor;
