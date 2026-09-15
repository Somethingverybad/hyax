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
  const drag = useRef<{ x: number; y: number } | null>(null);

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

  // Свайп: горизонтальный жест листает, вертикальный отдаём прокрутке —
  // иначе на телефоне картинку невозможно было бы просто «смахнуть» вниз.
  const onDown = (e: React.PointerEvent) => { drag.current = { x: e.clientX, y: e.clientY }; };
  const onUp = (e: React.PointerEvent) => {
    const from = drag.current;
    drag.current = null;
    if (!from) return;
    const dx = e.clientX - from.x;
    const dy = e.clientY - from.y;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy)) return;
    go(dx < 0 ? 1 : -1);
  };

  return (
    <div
      className="fixed inset-0 z-[80] bg-black flex items-center justify-center"
      style={{ paddingTop: "var(--sat)", paddingBottom: "var(--sab)" }}
      onClick={() => (menuOpen ? setMenuOpen(false) : onClose())}
    >
      <div
        className="absolute inset-x-0 flex items-center justify-between px-3"
        style={{ top: "calc(var(--sat) + 0.5rem)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" onClick={onClose} className="p-2 text-white" aria-label="Закрыть">
          <X className="w-6 h-6" />
        </button>
        {items.length > 1 && (
          <span className="text-white/80 text-small tabular-nums">{index + 1} из {items.length}</span>
        )}
        {actions.length > 0 ? (
          <button type="button" onClick={() => setMenuOpen((v) => !v)} className="p-2 text-white" aria-label="Меню">
            <MoreVertical className="w-6 h-6" />
          </button>
        ) : <span className="w-10" />}
      </div>

      {url ? (
        <img
          src={url}
          alt=""
          className="max-h-full max-w-full object-contain select-none touch-pan-y"
          draggable={false}
          onPointerDown={onDown}
          onPointerUp={onUp}
          onClick={(e) => { e.stopPropagation(); if (actions.length) setMenuOpen((v) => !v); }}
        />
      ) : (
        <div className="text-white/60 text-small">Загрузка…</div>
      )}

      {/* Стрелки для мыши: на телефоне достаточно свайпа. */}
      {items.length > 1 && index > 0 && (
        <button type="button" onClick={(e) => { e.stopPropagation(); go(-1); }}
          className="hidden md:flex absolute left-3 w-10 h-10 rounded-full bg-black/40 text-white items-center justify-center"
          aria-label="Предыдущая">
          <ChevronLeft className="w-6 h-6" />
        </button>
      )}
      {items.length > 1 && index < items.length - 1 && (
        <button type="button" onClick={(e) => { e.stopPropagation(); go(1); }}
          className="hidden md:flex absolute right-3 w-10 h-10 rounded-full bg-black/40 text-white items-center justify-center"
          aria-label="Следующая">
          <ChevronRight className="w-6 h-6" />
        </button>
      )}

      {menuOpen && <div className="absolute inset-0 bg-black/40" aria-hidden />}
      {menuOpen && (
        <div
          className="absolute inset-x-0 bottom-0 p-4 pb-[calc(var(--sab)+8px)] md:inset-x-auto md:right-3 md:bottom-auto md:top-14 md:p-0 md:w-64"
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
