import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Brush, Check, Eraser, Loader2, RotateCcw, Undo2, X } from "lucide-react";
import { api } from "@/api/client";
import { COLORS, drawStroke, type Pt, type Stroke } from "@/components/PhotoEditor";
import StickerView from "@/components/chat/StickerView";
import { forgetStickerPacks } from "@/components/chat/StickerPicker";
import { confirmDialog } from "@/lib/confirm";
import { invalidateStickerIndex } from "@/lib/stickerIndex";
import { t as tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Граффити — рисунок от руки на прозрачном фоне (backend chat/graffiti.py).
 *
 * Нарисованное сохраняется в пак «Мои граффити» (заводится сам с первым
 * рисунком) и уходит дальше как выбранное: в переписке — стикером, в пост —
 * картинкой. Тот же пак открывается в окне граффити и в панели стикеров,
 * поэтому рисунки можно отправлять снова.
 */

export type GraffitiSticker = { id: string; pack: string; file_url: string; emoji?: string };

/** Холст — квадрат CANVAS×CANVAS в своих координатах; на выходе рисунок
 *  обрезается по краям и ужимается до OUT_MAX — как обычный стикер. */
const CANVAS = 1024;
const OUT_MAX = 512;
const PAD = 16;
const WIDTHS = [10, 22, 42];
/** Клетка под прозрачным холстом: видно и белые, и чёрные штрихи. */
const CHECKER = { backgroundImage: "repeating-conic-gradient(rgba(128,128,128,.22) 0 25%, transparent 0 50%)", backgroundSize: "28px 28px" };

/** Обрезать прозрачные поля и ужать до OUT_MAX; пусто — null. */
function exportPng(src: HTMLCanvasElement): Promise<Blob | null> {
  const ctx = src.getContext("2d")!;
  const { data, width, height } = ctx.getImageData(0, 0, src.width, src.height);
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return Promise.resolve(null);
  x0 = Math.max(0, x0 - PAD); y0 = Math.max(0, y0 - PAD);
  x1 = Math.min(width - 1, x1 + PAD); y1 = Math.min(height - 1, y1 + PAD);
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const k = Math.min(1, OUT_MAX / Math.max(w, h));
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(w * k));
  out.height = Math.max(1, Math.round(h * k));
  const octx = out.getContext("2d")!;
  octx.imageSmoothingQuality = "high";
  octx.drawImage(src, x0, y0, w, h, 0, 0, out.width, out.height);
  return new Promise((resolve) => out.toBlob((b) => resolve(b), "image/png"));
}

/** Холст для рисования: цвета, толщина, ластик, отмена, очистка. */
export const GraffitiEditor = ({ onCancel, onDone, busy }: {
  onCancel: () => void;
  onDone: (png: Blob) => void;
  busy?: boolean;
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Stroke[]>([]);
  const current = useRef<Stroke | null>(null);
  const pointer = useRef<number | null>(null);
  const [count, setCount] = useState(0);
  const [color, setColor] = useState(COLORS[2]);
  const [width, setWidth] = useState(WIDTHS[1]);
  const [erase, setErase] = useState(false);

  const redraw = () => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    for (const s of strokes.current) drawStroke(ctx, s);
  };

  const point = (e: React.PointerEvent<HTMLCanvasElement>): Pt => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * CANVAS, y: ((e.clientY - r.top) / r.height) * CANVAS };
  };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (pointer.current !== null || busy) return;
    pointer.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    current.current = { color, width, erase, points: [point(e)] };
    strokes.current.push(current.current);
    drawStroke(canvasRef.current!.getContext("2d")!, current.current);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (pointer.current !== e.pointerId || !current.current) return;
    const s = current.current;
    // Сгруппированные события (быстрый штрих на телефоне) — все точки, иначе ломаная.
    const evs = (e.nativeEvent as PointerEvent).getCoalescedEvents?.() || [e.nativeEvent];
    const r = e.currentTarget.getBoundingClientRect();
    const from = s.points.length;
    for (const ev of evs) s.points.push({ x: ((ev.clientX - r.left) / r.width) * CANVAS, y: ((ev.clientY - r.top) / r.height) * CANVAS });
    drawStroke(canvasRef.current!.getContext("2d")!, s, from);
  };
  const up = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (pointer.current !== e.pointerId) return;
    pointer.current = null;
    current.current = null;
    setCount(strokes.current.length);
  };

  const undo = () => { strokes.current.pop(); setCount(strokes.current.length); redraw(); };
  const clear = () => { strokes.current = []; setCount(0); redraw(); };
  const cancel = async () => {
    if (strokes.current.length && !(await confirmDialog("Выбросить рисунок?", { ok: tr("Выбросить") }))) return;
    onCancel();
  };
  const done = async () => {
    const blob = canvasRef.current && await exportPng(canvasRef.current);
    if (!blob) { toast.error(tr("Нарисуйте что-нибудь")); return; }
    onDone(blob);
  };

  useEffect(() => { redraw(); }, []);

  return createPortal(
    <div className="fixed inset-0 z-[95] bg-background flex flex-col pad-safe-top pad-safe-bottom select-none">
      <div className="flex items-center gap-2 px-3 h-14 shrink-0">
        <button type="button" onClick={() => void cancel()} disabled={busy} className="w-10 h-10 rounded-full flex items-center justify-center text-muted-foreground" aria-label={tr("Отмена")}>
          <X className="w-5 h-5" />
        </button>
        <span className="flex-1 text-center font-semibold">{tr("Граффити")}</span>
        <button type="button" onClick={() => void done()} disabled={busy || !count}
          className="h-10 px-4 rounded-full bg-primary text-primary-foreground font-semibold text-small flex items-center gap-1.5 disabled:opacity-40">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} {tr("Готово")}
        </button>
      </div>
      {/* Холст и инструменты — одной группой по центру, без пустых полей между ними. */}
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-4 px-4">
        <canvas
          ref={canvasRef}
          width={CANVAS}
          height={CANVAS}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          style={{ ...CHECKER, touchAction: "none", width: "min(100%, calc(var(--app-height, 100vh) - 260px), 640px)", aspectRatio: "1 / 1" }}
          className="rounded-xl border border-border bg-surface-2 cursor-crosshair"
          aria-label={tr("Холст для рисования")}
        />
      <div className="shrink-0 w-full pb-2 space-y-3">
        <div className="flex items-center justify-center gap-2">
          {COLORS.map((c) => (
            <button key={c} type="button" onClick={() => { setColor(c); setErase(false); }} aria-label={c}
              className={cn("w-8 h-8 rounded-full border-2 transition-transform", !erase && color === c ? "border-primary scale-110" : "border-border")}
              style={{ backgroundColor: c }} />
          ))}
        </div>
        <div className="flex items-center justify-center gap-3">
          {WIDTHS.map((w) => (
            <button key={w} type="button" onClick={() => setWidth(w)} aria-label={tr("Толщина {n}", { n: w })}
              className={cn("w-10 h-10 rounded-full flex items-center justify-center", width === w ? "bg-primary/15 ring-2 ring-primary" : "bg-surface-2")}>
              <span className="rounded-full bg-foreground" style={{ width: 4 + w / 3, height: 4 + w / 3 }} />
            </button>
          ))}
          <span className="w-px h-6 bg-border" aria-hidden />
          <button type="button" onClick={() => setErase((v) => !v)} aria-pressed={erase} aria-label={tr("Ластик")}
            className={cn("w-10 h-10 rounded-full flex items-center justify-center", erase ? "bg-primary text-primary-foreground" : "bg-surface-2 text-muted-foreground")}>
            <Eraser className="w-5 h-5" />
          </button>
          <button type="button" onClick={undo} disabled={!count} aria-label={tr("Отменить")}
            className="w-10 h-10 rounded-full bg-surface-2 text-muted-foreground flex items-center justify-center disabled:opacity-40">
            <Undo2 className="w-5 h-5" />
          </button>
          <button type="button" onClick={clear} disabled={!count} aria-label={tr("Очистить")}
            className="w-10 h-10 rounded-full bg-surface-2 text-muted-foreground flex items-center justify-center disabled:opacity-40">
            <RotateCcw className="w-5 h-5" />
          </button>
        </div>
      </div>
      </div>
    </div>,
    document.body,
  );
};

/**
 * Окно граффити: «Нарисовать» и свои прежние рисунки. onPick — выбрали
 * готовое или нарисовали новое (оно уже лежит в «Моих граффити»).
 * draw — сразу открыть холст (кнопка-кисть в панели стикеров).
 */
export const GraffitiSheet = ({ onPick, onClose, draw = false }: {
  onPick: (sticker: GraffitiSticker) => void;
  onClose: () => void;
  draw?: boolean;
}) => {
  const [list, setList] = useState<GraffitiSticker[] | null>(null);
  const [drawing, setDrawing] = useState(draw);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (draw) return;
    let alive = true;
    api.myGraffiti().then((l) => { if (alive) setList(l); }).catch(() => { if (alive) setList([]); });
    return () => { alive = false; };
  }, [draw]);

  const save = async (png: Blob) => {
    setSaving(true);
    try {
      const sticker = await api.saveGraffiti(png);
      // «Мои граффити» мог только что появиться — панель стикеров перечитает наборы.
      forgetStickerPacks(sticker.pack);
      invalidateStickerIndex();
      onPick(sticker);
    } catch (e) {
      toast.error((e as Error)?.message || tr("Не удалось сохранить граффити"));
      setSaving(false);
    }
  };

  if (drawing) {
    return <GraffitiEditor busy={saving} onCancel={() => (draw ? onClose() : setDrawing(false))} onDone={(png) => void save(png)} />;
  }
  return createPortal(
    <div className="fixed inset-0 z-[85] bg-black/60 flex items-end md:items-center md:justify-center" onClick={onClose}>
      <div className="ui-card w-full md:w-[440px] max-h-[75vh] bg-surface-2 rounded-t-[16px] md:rounded-lg flex flex-col pb-[calc(var(--sab)+12px)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 h-14 shrink-0">
          <Brush className="w-5 h-5 text-primary" />
          <span className="text-h2 flex-1">{tr("Граффити")}</span>
          <button type="button" onClick={onClose} className="p-1.5 text-subtle" aria-label={tr("Закрыть")}><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-2">
          <div className="grid grid-cols-4 gap-2">
            <button type="button" onClick={() => setDrawing(true)}
              className="aspect-square rounded-lg border-2 border-dashed border-primary/50 text-primary flex flex-col items-center justify-center gap-1 active:opacity-70">
              <Brush className="w-6 h-6" />
              <span className="text-caption font-medium">{tr("Нарисовать")}</span>
            </button>
            {(list || []).map((s) => (
              <button key={s.id} type="button" onClick={() => onPick(s)} style={CHECKER}
                className="aspect-square rounded-lg bg-surface-4 p-1.5 active:opacity-70" aria-label={tr("Граффити")}>
                <StickerView url={s.file_url} alt="" className="w-full h-full object-contain" />
              </button>
            ))}
          </div>
          {!list && <div className="py-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-subtle" /></div>}
          {list && list.length === 0 && (
            <p className="py-4 text-center text-caption text-subtle">{tr("Здесь появятся ваши рисунки — их можно будет отправить снова.")}</p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};
