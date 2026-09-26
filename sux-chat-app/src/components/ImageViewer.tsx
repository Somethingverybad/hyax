import { useEffect, useRef, useState, type ReactNode } from "react";
import { X, MoreVertical, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { api, mediaUrl } from "@/api/client";

export interface ViewerAction {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
}

export interface ViewerItem {
  /** Как лежит на сервере: /media/... или s3://key. */
  raw: string;
  name: string;
  /** Сообщение или пост, которому картинка принадлежит — для действий. */
  messageId: string;
}

/** Ссылка для показа: своя картинка — из локального blob, чужая в S3 — по
 *  временной подписи. Подписи кэшируем, чтобы листание не дёргало сервер. */
const signed = new Map<string, string>();
const resolveUrl = async (raw: string, localMap?: Map<string, string>) => {
  const local = raw.startsWith("blob:") ? raw : localMap?.get(raw);
  if (local) return local;
  if (!raw.startsWith("s3://")) return mediaUrl(raw);
  const hit = signed.get(raw);
  if (hit) return hit;
  const url = await api.signMedia(raw);
  signed.set(raw, url);
  return url;
};

/**
 * Полноэкранный просмотр картинок с перелистыванием: свайп влево-вправо на
 * телефоне, стрелки и кнопки по краям на десктопе. Список — все картинки
 * этой переписки по порядку, поэтому снимки из одного альбома идут подряд.
 *
 * Тап по картинке (или «⋮») открывает шторку действий: переслать, в
 * сохранёнки, скачать, удалить — набор передаёт вызывающий экран. Тап по
 * чёрному фону закрывает просмотр.
 */
/** Кнопки поверх снимка: белый значок на тёмной полупрозрачной подложке.
 *  Без неё крестик и меню терялись на светлых фото и скриншотах — снимок
 *  во весь экран оказывается прямо под ними. */
const chrome = "w-10 h-10 rounded-full bg-black/55 text-white flex items-center justify-center active:opacity-70";

const ImageViewer = ({ items, index, onIndex, onClose, actions, localMap }: {
  items: ViewerItem[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  actions: ViewerAction[];
  localMap?: Map<string, string>;
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [url, setUrl] = useState("");
  const item = items[index];
  // Зум: масштаб и сдвиг картинки. Щипок — масштаб вокруг пальцев, один
  // палец при зуме — сдвиг, двойной тап — 2.5× в точку и обратно, колесо —
  // на десктопе. При масштабе 1 горизонтальный свайп листает.
  const [t, setT] = useState({ s: 1, x: 0, y: 0 });
  const tRef = useRef(t);
  tRef.current = t;
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ dist: number; mid: { x: number; y: number }; t: { s: number; x: number; y: number } } | null>(null);
  const pan = useRef<{ p: { x: number; y: number }; t: { x: number; y: number }; moved: boolean } | null>(null);
  const lastTap = useRef<{ at: number; x: number; y: number } | null>(null);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const MAX_S = 5;

  /** Точка экрана → координаты относительно центра сцены. */
  const rel = (x: number, y: number) => {
    const r = stageRef.current?.getBoundingClientRect();
    return r ? { x: x - (r.left + r.width / 2), y: y - (r.top + r.height / 2) } : { x, y };
  };
  /** Не отпускать картинку дальше своих краёв; меньше сцены — по центру. */
  const clampT = (n: { s: number; x: number; y: number }) => {
    const st = stageRef.current, im = imgRef.current;
    if (!st || !im) return n;
    const maxX = Math.max(0, (im.offsetWidth * n.s - st.clientWidth) / 2);
    const maxY = Math.max(0, (im.offsetHeight * n.s - st.clientHeight) / 2);
    return { s: n.s, x: Math.max(-maxX, Math.min(maxX, n.x)), y: Math.max(-maxY, Math.min(maxY, n.y)) };
  };
  /** Масштаб s2 вокруг экранной точки p (относительно центра сцены). */
  const zoomAt = (from: { s: number; x: number; y: number }, s2: number, p: { x: number; y: number }) => {
    const s = Math.max(1, Math.min(MAX_S, s2));
    const k = s / from.s;
    return clampT({ s, x: p.x - (p.x - from.x) * k, y: p.y - (p.y - from.y) * k });
  };
  const resetZoom = () => setT({ s: 1, x: 0, y: 0 });
  useEffect(() => { resetZoom(); }, [index]);

  const go = (step: number) => {
    const next = index + step;
    if (next < 0 || next >= items.length) return;
    setMenuOpen(false);
    onIndex(next);
  };

  useEffect(() => {
    let alive = true;
    setUrl("");
    if (item) resolveUrl(item.raw, localMap).then((u) => { if (alive) setUrl(u); }).catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.raw]);

  // Стрелки на десктопе, Esc — закрыть.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!item) return null;

  const onDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: rel((a.x + b.x) / 2, (a.y + b.y) / 2), t: tRef.current };
      pan.current = null;
      if (tapTimer.current) { clearTimeout(tapTimer.current); tapTimer.current = null; }
    } else if (pointers.current.size === 1) {
      pan.current = { p: { x: e.clientX, y: e.clientY }, t: { x: tRef.current.x, y: tRef.current.y }, moved: false };
    }
  };
  const onMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (g && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = rel((a.x + b.x) / 2, (a.y + b.y) / 2);
      const z = zoomAt(g.t, g.t.s * (dist / g.dist), g.mid);
      setT(clampT({ s: z.s, x: z.x + (mid.x - g.mid.x), y: z.y + (mid.y - g.mid.y) }));
      return;
    }
    const p = pan.current;
    if (!p) return;
    const dx = e.clientX - p.p.x, dy = e.clientY - p.p.y;
    if (Math.hypot(dx, dy) > 6) p.moved = true;
    if (tRef.current.s > 1) setT(clampT({ s: tRef.current.s, x: p.t.x + dx, y: p.t.y + dy }));
  };
  const onUp = (e: React.PointerEvent) => {
    const had = pointers.current.has(e.pointerId);
    pointers.current.delete(e.pointerId);
    if (!had) return;
    if (pointers.current.size < 2) gesture.current = null;
    if (pointers.current.size > 0) { pan.current = null; return; }
    const p = pan.current;
    pan.current = null;
    if (!p) return;
    const dx = e.clientX - p.p.x, dy = e.clientY - p.p.y;
    // Свайп при масштабе 1 — листание.
    if (tRef.current.s === 1 && Math.abs(dx) >= 60 && Math.abs(dx) > Math.abs(dy)) { go(dx < 0 ? 1 : -1); return; }
    if (p.moved) return;
    // Тап. Двойной — зум; одиночный ждёт 280 мс, чтобы не сработать вместе с ним.
    const now = performance.now();
    const lt = lastTap.current;
    const onImage = e.target === imgRef.current;
    if (lt && now - lt.at < 300 && Math.hypot(e.clientX - lt.x, e.clientY - lt.y) < 30) {
      lastTap.current = null;
      if (tapTimer.current) { clearTimeout(tapTimer.current); tapTimer.current = null; }
      if (!onImage) return;
      const cur = tRef.current;
      setT(cur.s > 1 ? { s: 1, x: 0, y: 0 } : zoomAt(cur, 2.5, rel(e.clientX, e.clientY)));
      return;
    }
    lastTap.current = { at: now, x: e.clientX, y: e.clientY };
    if (tapTimer.current) clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(() => {
      tapTimer.current = null;
      if (menuOpen) { setMenuOpen(false); return; }
      if (onImage) { if (actions.length) setMenuOpen(true); }
      else onClose();
    }, 280);
  };
  const onWheel = (e: React.WheelEvent) => {
    const cur = tRef.current;
    const next = zoomAt(cur, cur.s * Math.exp(-e.deltaY * 0.0025), rel(e.clientX, e.clientY));
    setT(next.s <= 1.02 ? { s: 1, x: 0, y: 0 } : next);
  };

  return (
    <div
      className="fixed inset-0 z-[80] bg-black flex items-center justify-center"
      style={{ paddingTop: "var(--sat)", paddingBottom: "var(--sab)" }}
    >
      {/* Сцена с жестами: тапы, щипок и сдвиг обрабатываем сами (см. onUp). */}
      <div
        ref={stageRef}
        className="absolute inset-0 touch-none overflow-hidden flex items-center justify-center"
        style={{ top: "var(--sat)", bottom: "var(--sab)" }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onWheel={onWheel}
      >
        {url ? (
          <img
            ref={imgRef}
            src={url}
            alt=""
            className="max-h-full max-w-full object-contain select-none"
            draggable={false}
            style={{
              transform: `translate(${t.x}px, ${t.y}px) scale(${t.s})`,
              transition: pointers.current.size ? "none" : "transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1)",
            }}
          />
        ) : (
          <div className="text-white/60 text-small">Загрузка…</div>
        )}
      </div>

      <div
        className="absolute inset-x-0 z-10 flex items-center justify-between px-3"
        style={{ top: "calc(var(--sat) + 0.5rem)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" onClick={onClose} className={chrome} aria-label="Закрыть">
          <X className="w-6 h-6" />
        </button>
        {items.length > 1 && (
          <span className="px-2.5 py-1 rounded-full bg-black/55 text-white/90 text-small tabular-nums">{index + 1} из {items.length}</span>
        )}
        {actions.length > 0 ? (
          <button type="button" onClick={() => setMenuOpen((v) => !v)} className={chrome} aria-label="Меню">
            <MoreVertical className="w-6 h-6" />
          </button>
        ) : <span className="w-10" />}
      </div>

      {/* Стрелки для мыши: на телефоне достаточно свайпа. */}
      {items.length > 1 && index > 0 && (
        <button type="button" onClick={(e) => { e.stopPropagation(); go(-1); }}
          className="hidden md:flex absolute z-10 left-3 w-10 h-10 rounded-full bg-black/40 text-white items-center justify-center"
          aria-label="Предыдущая">
          <ChevronLeft className="w-6 h-6" />
        </button>
      )}
      {items.length > 1 && index < items.length - 1 && (
        <button type="button" onClick={(e) => { e.stopPropagation(); go(1); }}
          className="hidden md:flex absolute z-10 right-3 w-10 h-10 rounded-full bg-black/40 text-white items-center justify-center"
          aria-label="Следующая">
          <ChevronRight className="w-6 h-6" />
        </button>
      )}

      {menuOpen && <div className="absolute inset-0 z-10 bg-black/40" aria-hidden onClick={() => setMenuOpen(false)} />}
      {menuOpen && (
        <div
          className="absolute z-20 inset-x-0 bottom-0 p-4 pb-[calc(var(--sab)+8px)] md:inset-x-auto md:right-3 md:bottom-auto md:top-14 md:p-0 md:w-64"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="rounded-lg bg-surface-1 overflow-hidden divide-y divide-border">
            {actions.map((a) => (
              <button
                key={a.label}
                type="button"
                onClick={() => { setMenuOpen(false); a.onClick(); }}
                className={cn("w-full h-12 px-4 flex items-center gap-3 text-body text-left active:bg-surface-3 md:hover:bg-surface-2", a.danger && "text-primary")}
              >
                {a.icon}
                {a.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setMenuOpen(false)}
            className="mt-2 w-full h-12 rounded-lg bg-surface-1 text-body font-semibold md:hidden"
          >
            Отмена
          </button>
        </div>
      )}
    </div>
  );
};

export default ImageViewer;
