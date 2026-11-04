import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MESSAGE_EFFECTS, type MessageEffect } from "@/lib/effects";
import { t as tr } from "@/lib/i18n";

/**
 * Меню эффектов по удержанию стикера или кнопки «Отправить» (lib/effects):
 * карточка над тем, что держали (не влезает — под ним); тап мимо — закрыть.
 */
const EffectMenu = ({ anchor, onPick, onClose }: { anchor: DOMRect; onPick: (e: MessageEffect) => void; onClose: () => void }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight, vw = window.innerWidth;
    const left = Math.max(8, Math.min(anchor.left + anchor.width / 2 - w / 2, vw - w - 8));
    const top = anchor.top - h - 8 >= 8 ? anchor.top - h - 8 : anchor.bottom + 8;
    setPos({ left, top });
  }, [anchor]);
  return createPortal(
    <div className="fixed inset-0 z-[90]" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }}>
      <div ref={ref} role="menu" aria-label={tr("Отправить с эффектом")}
        className="fixed w-60 rounded-2xl bg-surface-2/95 border border-border shadow-xl py-1.5 animate-in fade-in zoom-in-95 duration-150"
        style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
        onClick={(e) => e.stopPropagation()}>
        <p className="px-4 pt-1 pb-1.5 text-caption text-subtle">{tr("Отправить с эффектом")}</p>
        {MESSAGE_EFFECTS.map((fx) => (
          <button key={fx.key} type="button" role="menuitem" onClick={() => onPick(fx.key)}
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

export default EffectMenu;
