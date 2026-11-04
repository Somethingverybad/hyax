import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type RowMenuItem = {
  label: string;
  icon?: React.ReactNode;
  /** Подпись мелким под пунктом («Без уведомлений до 14:30»). */
  hint?: string;
  danger?: boolean;
  onClick?: () => void;
  /** Второй уровень (сроки уведомлений) — в той же карточке, с «назад». */
  sub?: RowMenuItem[];
};

const ITEM_H = 44;
const GAP = 8;
const EDGE = 12;

const cssPx = (name: string) => {
  const n = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name).trim());
  return Number.isFinite(n) ? n : 0;
};

/**
 * Меню чата на телефоне — как меню сообщения (MessageContextMenu): список
 * размывается, строка чата остаётся чёткой на своём месте (копия поверх
 * размытия), под ней — меню. Порталом на body: поверх острова навигации и
 * слоёв экрана. Строку у нижнего края поднимаем, чтобы меню влезло.
 * peek — мини-окно переписки под строкой (как в Telegram): строка становится
 * его шапкой, тап по окну — открыть чат (onOpen).
 */
const PEEK_MAX = 380;
const PEEK_MIN = 140;

const ChatRowMenu = ({ anchor, items, onClose, peek, onOpen }: {
  anchor: HTMLElement; items: RowMenuItem[]; onClose: () => void; peek?: React.ReactNode; onOpen?: () => void;
}) => {
  const openedAt = useRef(Date.now());
  const rowRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [sub, setSub] = useState<RowMenuItem | null>(null);
  const [geo, setGeo] = useState<{ from: number; top: number; left: number; width: number; height: number; peekH: number; menuLeft: number; menuW: number } | null>(null);
  const [shown, setShown] = useState(false);

  useLayoutEffect(() => {
    const rect = anchor.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const sat = cssPx("--sat"), sab = cssPx("--sab");
    // Место под самый длинный уровень меню: подменю бывает выше основного.
    const tallest = Math.max(items.length, ...items.map((i) => (i.sub ? i.sub.length + 1 : 0))) * ITEM_H + 12 + 28;
    // Мини-окно — сколько влезает между строкой и меню; меньше PEEK_MIN — без него.
    const room = vh - sab - sat - EDGE * 2 - tallest - GAP - rect.height;
    const peekH = peek && room >= PEEK_MIN ? Math.min(PEEK_MAX, room) : 0;
    const maxTop = vh - sab - EDGE - tallest - GAP - rect.height - peekH;
    const top = Math.max(sat + EDGE, Math.min(rect.top, maxTop));
    const menuW = Math.min(300, vw - EDGE * 2);
    setGeo({ from: rect.top, top, left: rect.left, width: rect.width, height: rect.height, peekH, menuLeft: Math.max(EDGE, Math.min(rect.left + 12, vw - EDGE - menuW)), menuW });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor]);

  // Копия строки — после того как появился контейнер под неё.
  useLayoutEffect(() => {
    const host = rowRef.current;
    if (!geo || !host || host.childElementCount) return;
    const clone = anchor.cloneNode(true) as HTMLElement;
    clone.style.transform = "none";
    clone.style.width = `${geo.width}px`;
    clone.style.margin = "0";
    host.appendChild(clone);
    const raf = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo]);

  // Список под оверлеем не прокручиваем (React вешает touchmove пассивно).
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    const block = (e: TouchEvent) => e.preventDefault();
    el.addEventListener("touchmove", block, { passive: false });
    return () => el.removeEventListener("touchmove", block);
  }, []);

  const renderItem = (it: RowMenuItem, idx: number) => (
    <button
      key={idx}
      type="button"
      onClick={(e) => { e.stopPropagation(); if (it.sub) setSub(it); else it.onClick?.(); }}
      className={cn("w-full min-h-11 px-4 py-2 flex items-center gap-3.5 text-left text-body active:bg-foreground/10", it.danger ? "text-destructive" : "text-foreground")}
    >
      {it.icon && <span className={cn("w-5 h-5 shrink-0 flex items-center justify-center", it.danger ? "text-destructive" : "text-foreground/80")}>{it.icon}</span>}
      <span className="flex-1 min-w-0">
        <span className="block truncate">{it.label}</span>
        {it.hint && <span className="block text-caption text-subtle truncate">{it.hint}</span>}
      </span>
      {it.sub && <ChevronRight className="w-4 h-4 text-subtle shrink-0" />}
    </button>
  );

  return createPortal(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[90] touch-none"
      style={{
        background: shown ? "rgba(0,0,0,0.35)" : "rgba(0,0,0,0)",
        backdropFilter: shown ? "blur(14px)" : "blur(0px)",
        WebkitBackdropFilter: shown ? "blur(14px)" : "blur(0px)",
        transition: "background 180ms ease-out, backdrop-filter 180ms ease-out, -webkit-backdrop-filter 180ms ease-out",
      }}
      onClick={onClose}
      // Android: системный contextmenu приходит после нашего удержания —
      // первую секунду его не считаем «кликом мимо» (как у меню сообщения).
      onContextMenu={(e) => { e.preventDefault(); if (Date.now() - openedAt.current > 1000) onClose(); }}
    >
      {geo && (
        <>
          {/* Копия строки чата: с места в списке — туда, где под ней влезет меню.
              С мини-окном строка — его шапка, а тап по карточке открывает чат. */}
          <div
            className={cn("fixed overflow-hidden rounded-2xl bg-background shadow-xl", geo.peekH && onOpen ? "cursor-pointer" : "pointer-events-none")}
            style={{ left: geo.left, width: geo.width, height: geo.height + geo.peekH, top: shown ? geo.top : geo.from, transition: "top 220ms cubic-bezier(0.2, 0.8, 0.2, 1)" }}
            onClick={geo.peekH && onOpen ? (e) => { e.stopPropagation(); onOpen(); } : undefined}
          >
            <div ref={rowRef} className="pointer-events-none" style={{ height: geo.height }} />
            {geo.peekH > 0 && (
              <div className="pointer-events-none border-t border-border/60 transition-opacity duration-200" style={{ height: geo.peekH, opacity: shown ? 1 : 0 }}>
                {peek}
              </div>
            )}
          </div>
          <div
            className="ui-card fixed rounded-2xl bg-surface-2/95 py-1.5 shadow-xl overflow-hidden"
            style={{
              left: geo.menuLeft, width: geo.menuW, top: geo.top + geo.height + geo.peekH + GAP,
              transformOrigin: "left top",
              transform: shown ? "scale(1)" : "scale(0.7)",
              opacity: shown ? 1 : 0,
              transition: "transform 220ms cubic-bezier(0.2, 0.9, 0.3, 1.15), opacity 160ms ease-out",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {sub ? (
              <>
                <button type="button" onClick={(e) => { e.stopPropagation(); setSub(null); }}
                  className="w-full h-11 px-4 flex items-center gap-3.5 text-left text-body text-subtle active:bg-foreground/10">
                  <ChevronLeft className="w-5 h-5 shrink-0" /><span className="truncate">{sub.label}</span>
                </button>
                <div className="mx-4 my-1 border-t border-foreground/15" />
                {(sub.sub || []).map(renderItem)}
              </>
            ) : items.map(renderItem)}
          </div>
        </>
      )}
    </div>,
    document.body,
  );
};

export default ChatRowMenu;
