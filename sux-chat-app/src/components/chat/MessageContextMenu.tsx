import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { MAIN_REACTIONS } from "@/lib/reactions";

export type MenuItem = { label: string; icon?: React.ReactNode; danger?: boolean; onClick: () => void };

/**
 * Меню сообщения на телефоне — как в Telegram: лента размывается, пузырь
 * поднимается наверх, над ним ряд быстрых реакций, под ним компактное меню.
 * Раньше была нижняя шторка во весь экран — от сообщения она отрывала.
 *
 * Пузырь не переносим, а клонируем (cloneNode): настоящий живёт в прокрутке
 * под оверлеем, и вытащить его поверх размытия без перестройки дерева
 * нельзя. Клон — картинка на время меню, тапы по нему не ловим.
 */
const QUICK = MAIN_REACTIONS.slice(0, 6);
const REACT_H = 48;
const ITEM_H = 44;
const GAP = 8;
const EDGE = 12;

const cssPx = (name: string) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

const MessageContextMenu = ({ anchor, isOwn, items, mine, onReact, onMoreReactions, onClose }: {
  /** Элемент пузыря в ленте — откуда берём геометрию и копию. */
  anchor: HTMLElement;
  isOwn: boolean;
  items: MenuItem[];
  /** Мои реакции на это сообщение — подсветить в ряду. */
  mine: string[];
  onReact: (emoji: string) => void;
  onMoreReactions: () => void;
  onClose: () => void;
}) => {
  const bubbleRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [geo, setGeo] = useState<{ from: number; top: number; left: number; width: number; height: number; clipped: boolean; menuLeft: number; menuW: number; barLeft: number; barW: number } | null>(null);
  const [shown, setShown] = useState(false);

  const selectIdx = items.findIndex((i) => i.label === "Выбрать");
  const mainItems = items.filter((i) => i.label !== "Выбрать");
  const menuH = items.length * ITEM_H + 12 + (selectIdx >= 0 ? 9 : 0);

  useLayoutEffect(() => {
    const rect = anchor.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const sat = cssPx("--sat"), sab = cssPx("--sab");
    const minTop = sat + EDGE + REACT_H + GAP;
    const maxBubbleH = vh - sab - EDGE - menuH - GAP - minTop;
    const height = Math.max(40, Math.min(rect.height, maxBubbleH));
    const maxTop = vh - sab - EDGE - menuH - GAP - height;
    const top = Math.max(minTop, Math.min(rect.top, maxTop));
    const menuW = Math.min(260, vw - EDGE * 2);
    const barW = QUICK.length * 44 + 40 + 12;
    const side = (w: number) => {
      const l = isOwn ? rect.right - w : rect.left;
      return Math.max(EDGE, Math.min(l, vw - EDGE - w));
    };
    setGeo({ from: rect.top, top, left: rect.left, width: rect.width, height, clipped: height < rect.height - 1, menuLeft: side(menuW), menuW, barLeft: side(barW), barW });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor]);

  // Контейнер под копию появляется только вместе с geo — клонируем после.
  useLayoutEffect(() => {
    const host = bubbleRef.current;
    if (!geo || !host || host.childElementCount) return;
    const clone = anchor.cloneNode(true) as HTMLElement;
    clone.style.margin = "0";
    clone.style.width = `${geo.width}px`;
    clone.style.maxWidth = "none";
    clone.removeAttribute("id");
    host.appendChild(clone);
    const raf = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo]);

  // Прокрутку ленты под оверлеем глушим нативным слушателем: React вешает
  // touchmove пассивно, и preventDefault оттуда не работает.
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    const block = (e: TouchEvent) => e.preventDefault();
    el.addEventListener("touchmove", block, { passive: false });
    return () => el.removeEventListener("touchmove", block);
  }, []);

  const renderItem = (it: MenuItem, idx: number) => (
    <button
      key={idx}
      type="button"
      onClick={(e) => { e.stopPropagation(); it.onClick(); }}
      className={cn(
        "w-full h-11 px-4 flex items-center gap-3.5 text-left text-body active:bg-foreground/10",
        it.danger ? "text-destructive" : "text-foreground",
      )}
    >
      <span className={cn("w-5 h-5 shrink-0 flex items-center justify-center", it.danger ? "text-destructive" : "text-foreground/80")}>{it.icon}</span>
      <span className="truncate">{it.label}</span>
    </button>
  );

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[70] touch-none"
      style={{
        background: shown ? "rgba(0,0,0,0.35)" : "rgba(0,0,0,0)",
        backdropFilter: shown ? "blur(14px)" : "blur(0px)",
        WebkitBackdropFilter: shown ? "blur(14px)" : "blur(0px)",
        transition: "background 180ms ease-out, backdrop-filter 180ms ease-out, -webkit-backdrop-filter 180ms ease-out",
      }}
      onClick={onClose}
      onContextMenu={(e) => { e.preventDefault(); onClose(); }}
    >
      {geo && (
        <>
          {/* Быстрые реакции — над пузырём */}
          <div
            className="ui-card fixed h-12 rounded-full bg-surface-2/95 flex items-center px-1.5 gap-0.5 shadow-lg"
            style={{
              left: geo.barLeft, width: geo.barW, top: geo.top - GAP - REACT_H,
              transformOrigin: isOwn ? "right bottom" : "left bottom",
              transform: shown ? "scale(1)" : "scale(0.6)",
              opacity: shown ? 1 : 0,
              transition: "transform 220ms cubic-bezier(0.2, 0.9, 0.3, 1.2), opacity 160ms ease-out",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {QUICK.map((r) => (
              <button
                key={r.emoji}
                type="button"
                aria-label={r.label}
                onClick={() => onReact(r.emoji)}
                className={cn("w-11 h-11 rounded-full text-[26px] leading-none flex items-center justify-center active:scale-125 transition-transform", mine.includes(r.emoji) && "bg-primary/20")}
              >
                {r.emoji}
              </button>
            ))}
            <button
              type="button"
              aria-label="Ещё реакции"
              onClick={onMoreReactions}
              className="w-10 h-10 rounded-full bg-surface-4 text-foreground/80 flex items-center justify-center active:opacity-70"
            >
              <ChevronDown className="w-5 h-5" />
            </button>
          </div>

          {/* Копия пузыря: едет с места в ленте на своё место под реакциями */}
          <div
            ref={bubbleRef}
            className="fixed pointer-events-none rounded-lg"
            style={{
              // Обрезаем только укороченный пузырь: у целого хвостик торчит за край.
              left: geo.left, width: geo.width, maxHeight: geo.height, overflow: geo.clipped ? "hidden" : "visible",
              top: shown ? geo.top : geo.from,
              transition: "top 220ms cubic-bezier(0.2, 0.8, 0.2, 1)",
            }}
          />

          {/* Меню — под пузырём */}
          <div
            className="ui-card fixed rounded-2xl bg-surface-2/95 py-1.5 shadow-xl overflow-hidden"
            style={{
              left: geo.menuLeft, width: geo.menuW, top: geo.top + geo.height + GAP,
              transformOrigin: isOwn ? "right top" : "left top",
              transform: shown ? "scale(1)" : "scale(0.7)",
              opacity: shown ? 1 : 0,
              transition: "transform 220ms cubic-bezier(0.2, 0.9, 0.3, 1.15), opacity 160ms ease-out",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {mainItems.map(renderItem)}
            {selectIdx >= 0 && (
              <>
                <div className="mx-4 my-1 border-t border-foreground/15" />
                {renderItem(items[selectIdx], 999)}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default MessageContextMenu;
