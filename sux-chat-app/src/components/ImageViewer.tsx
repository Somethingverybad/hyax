import { useState, type ReactNode } from "react";
import { X, MoreVertical } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ViewerAction {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
}

export interface ViewerItem {
  url: string;
  name: string;
}

/**
 * Полноэкранный просмотр картинки. Тап по картинке (или «⋮») открывает
 * шторку действий: переслать, в сохранёнки, скачать, удалить — набор
 * передаёт вызывающий экран. Тап по чёрному фону закрывает просмотр.
 */
const ImageViewer = ({ item, onClose, actions }: { item: ViewerItem; onClose: () => void; actions: ViewerAction[] }) => {
  const [menuOpen, setMenuOpen] = useState(false);
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
        {actions.length > 0 && (
          <button type="button" onClick={() => setMenuOpen((v) => !v)} className="p-2 text-white" aria-label="Меню">
            <MoreVertical className="w-6 h-6" />
          </button>
        )}
      </div>

      <img
        src={item.url}
        alt=""
        className="max-h-full max-w-full object-contain select-none"
        draggable={false}
        onClick={(e) => { e.stopPropagation(); if (actions.length) setMenuOpen((v) => !v); }}
      />

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
