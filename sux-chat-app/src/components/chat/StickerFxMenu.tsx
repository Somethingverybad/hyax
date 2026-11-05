import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { mediaUrl } from "@/api/client";
import StickerView, { isTgs } from "@/components/chat/StickerView";
import { useMenuTaps } from "@/components/chat/EffectMenu";
import { MESSAGE_EFFECTS, type MessageEffect } from "@/lib/effects";
import { t as tr } from "@/lib/i18n";
import { pauseTgs, tgsSource } from "@/lib/tgsPlayer";

/**
 * Меню эффектов по удержанию стикера — как меню сообщения: экран размывается,
 * стикер крупно выезжает в центр, под ним — эффекты. Раньше меню висело у
 * ячейки стикера, появлялось сбоку и перескакивало на место (баг-репорт
 * e09e591f: «лагает анимация при выборе эффекта»).
 *
 * Пока меню открыто, анимации стикеров на экране на паузе (pauseTgs): под
 * размытием они только грузили бы телефон. Крупный стикер играет своей
 * анимацией вне общего бюджета (tgsSource).
 *
 * Касания — как у EffectMenu (useMenuTaps): меню открывается, пока палец ещё
 * держит стикер, эхо-click после отпускания не закрывает его. data-keep-panel —
 * касание по меню не закрывает панель стикеров (ChatWindow).
 */
const PREVIEW = 168;

const BigSticker = ({ url }: { url: string }) => {
  const src = mediaUrl(url);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isTgs(src) || !box.current) return;
    let alive = true;
    let destroy: (() => void) | null = null;
    void tgsSource(src, PREVIEW).then((s) => {
      if (!alive || !box.current) { s.destroy(); return; }
      s.el.style.cssText = "width:100%;height:100%";
      box.current.appendChild(s.el);
      destroy = s.destroy;
    }).catch(() => {});
    return () => { alive = false; destroy?.(); };
  }, [src]);
  if (isTgs(src)) return <div ref={box} className="w-full h-full" aria-hidden />;
  return <StickerView url={url} className="w-full h-full object-contain" />;
};

const StickerFxMenu = ({ url, onPick, onClose }: { url: string; onPick: (e: MessageEffect) => void; onClose: () => void }) => {
  const { openedAt, viaTouch, viaClick, keepFocus } = useMenuTaps();
  // Сначала кадр без меню, потом — выезд: переход, а не мгновенная подмена.
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);
  useLayoutEffect(() => {
    pauseTgs(true);
    return () => pauseTgs(false);
  }, []);
  return createPortal(
    <div data-keep-panel className="fixed inset-0 z-[90] touch-none flex flex-col items-center justify-center gap-4 px-6"
      style={{
        background: shown ? "rgba(0,0,0,0.35)" : "rgba(0,0,0,0)",
        backdropFilter: shown ? "blur(14px)" : "blur(0px)",
        WebkitBackdropFilter: shown ? "blur(14px)" : "blur(0px)",
        transition: "background 180ms ease-out, backdrop-filter 180ms ease-out, -webkit-backdrop-filter 180ms ease-out",
      }}
      onMouseDown={keepFocus} onTouchEnd={viaTouch(onClose)} onClick={viaClick(onClose)}
      // Android после удержания сам шлёт contextmenu — первую секунду не закрываем.
      onContextMenu={(e) => { e.preventDefault(); if (Date.now() - openedAt.current > 1000) onClose(); }}>
      <div data-fx-preview className="pointer-events-none"
        style={{
          width: PREVIEW, height: PREVIEW,
          transform: shown ? "scale(1)" : "scale(0.55)",
          opacity: shown ? 1 : 0,
          transition: "transform 240ms cubic-bezier(0.2, 0.9, 0.3, 1.25), opacity 150ms ease-out",
        }}>
        <BigSticker url={url} />
      </div>
      <div role="menu" aria-label={tr("Отправить с эффектом")}
        className="ui-card w-64 rounded-2xl bg-surface-2/95 py-1.5 shadow-xl"
        style={{
          transformOrigin: "center top",
          transform: shown ? "scale(1)" : "scale(0.8)",
          opacity: shown ? 1 : 0,
          transition: "transform 220ms cubic-bezier(0.2, 0.9, 0.3, 1.15), opacity 160ms ease-out",
        }}
        onClick={(e) => e.stopPropagation()} onTouchEnd={(e) => e.stopPropagation()}>
        <p className="px-4 pt-1 pb-1.5 text-caption text-subtle">{tr("Отправить с эффектом")}</p>
        {MESSAGE_EFFECTS.map((fx) => (
          <button key={fx.key} type="button" role="menuitem"
            onMouseDown={keepFocus} onTouchEnd={viaTouch(() => onPick(fx.key))} onClick={viaClick(() => onPick(fx.key))}
            className="w-full px-4 py-2 flex items-center gap-3 text-left active:bg-foreground/10">
            <span className="text-2xl leading-none w-7 text-center" aria-hidden>{fx.icon}</span>
            <span className="min-w-0">
              <span className="block text-body font-medium">{tr(fx.label)}</span>
              <span className="block text-caption text-subtle">{tr(fx.hint)}</span>
            </span>
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
};

export default StickerFxMenu;
