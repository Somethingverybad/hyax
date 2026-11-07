import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MESSAGE_EFFECTS, type MessageEffect } from "@/lib/effects";
import { t as tr } from "@/lib/i18n";
import { applog } from "@/lib/applog";

/**
 * Меню эффектов по удержанию стикера или кнопки «Отправить» (lib/effects):
 * карточка над тем, что держали (не влезает — под ним); тап мимо — закрыть.
 *
 * Касания (баг-репорт 07009208, iPhone): меню открывается, пока палец ещё
 * держит стикер, и iOS после отпускания шлёт click туда, где палец теперь, —
 * в подложку: меню тут же закрывалось, стикер не уходил. Поэтому на касание
 * отвечаем только touchend, а он приходит лишь касаниям, начатым на самом
 * меню (удержание началось на стикере); click сразу после любого касания —
 * это его эхо от iOS, пропускаем. Мышь (компьютер) — обычным click.
 * mousedown гасим — как у кнопки «Отправить»: нажатие не отнимает фокус у
 * поля ввода, и клавиатура не сворачивается.
 */
const ECHO_MS = 700;

/** Касания меню, открытого удержанием (см. выше): пункт — по touchend, click
 *  сразу после любого касания — эхо iOS, mousedown не отнимает фокус. */
export function useMenuTaps() {
  const openedAt = useRef(Date.now());
  const touchEndAt = useRef(0);
  useEffect(() => {
    const on = () => { touchEndAt.current = Date.now(); };
    document.addEventListener("touchend", on, true);
    return () => document.removeEventListener("touchend", on, true);
  }, []);
  const viaTouch = (fn: () => void) => (e: React.TouchEvent) => { e.stopPropagation(); fn(); };
  const viaClick = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); if (Date.now() - touchEndAt.current > ECHO_MS) fn(); };
  const keepFocus = (e: React.MouseEvent) => e.preventDefault();
  return { openedAt, viaTouch, viaClick, keepFocus };
}
/** Пункт над эффектами: «Без звука», «Отложить» (удержание «Отправить»). */
export type SendAction = { key: string; icon: ReactNode; label: string; hint?: string; onPick: () => void };
const EffectMenu = ({ anchor, onPick, onClose, actions, effects = true, effectsNote }: {
  anchor: DOMRect;
  onPick: (e: MessageEffect) => void;
  onClose: () => void;
  actions?: SendAction[];
  /** Показывать эффекты (их нет у вложений). */
  effects?: boolean;
  /** Почему эффектов нет (длинное сообщение) — строкой вместо списка. */
  effectsNote?: string;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const openedAt = useRef(Date.now());
  // Последнее отпускание пальца где угодно: click в ближайшие ECHO_MS — эхо касания.
  const touchEndAt = useRef(0);
  useEffect(() => {
    const on = () => { touchEndAt.current = Date.now(); };
    document.addEventListener("touchend", on, true);
    return () => document.removeEventListener("touchend", on, true);
  }, []);
  const viaTouch = (fn: () => void) => (e: React.TouchEvent) => { e.stopPropagation(); fn(); };
  const viaClick = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); if (Date.now() - touchEndAt.current > ECHO_MS) fn(); };
  const keepFocus = (e: React.MouseEvent) => e.preventDefault();
  // В журнал — чем закрыли мимо и через сколько после открытия (iPhone: «эффекты не работают»).
  const closeBy = (how: string) => { applog.info(`effect menu закрыто мимо: ${how} через ${Date.now() - openedAt.current} мс`); onClose(); };
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
    // data-keep-panel: меню стикера рисуется вне панели стикеров, и касание по
    // нему ChatWindow считал «тапом мимо» — панель закрывалась вместе с меню
    // раньше, чем доходил выбор, стикер не уходил вовсе («эффекты у стикеров
    // не работают»).
    <div data-keep-panel className="fixed inset-0 z-[90]" onMouseDown={keepFocus}
      onTouchEnd={viaTouch(() => closeBy("touchend"))} onClick={viaClick(() => closeBy("click"))}
      // Android после удержания сам шлёт contextmenu — первую секунду не закрываем.
      onContextMenu={(e) => { e.preventDefault(); if (Date.now() - openedAt.current > 1000) closeBy("contextmenu"); }}>
      <div ref={ref} role="menu" aria-label={tr(actions?.length ? "Как отправить" : "Отправить с эффектом")}
        className="fixed w-60 rounded-2xl bg-surface-2/95 border border-border shadow-xl py-1.5 animate-in fade-in zoom-in-95 duration-150"
        style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
        onClick={(e) => e.stopPropagation()} onTouchEnd={(e) => e.stopPropagation()}>
        {actions?.map((a) => (
          <button key={a.key} type="button" role="menuitem"
            onMouseDown={keepFocus} onTouchEnd={viaTouch(a.onPick)} onClick={viaClick(a.onPick)}
            className="w-full px-4 py-2 flex items-center gap-3 text-left active:bg-foreground/10">
            <span className="w-7 flex justify-center shrink-0 text-primary" aria-hidden>{a.icon}</span>
            <span className="min-w-0">
              <span className="block text-body font-medium">{a.label}</span>
              {a.hint && <span className="block text-caption text-subtle">{a.hint}</span>}
            </span>
          </button>
        ))}
        {!effects && effectsNote && <p className="px-4 pt-2 pb-1.5 text-caption text-subtle border-t border-border mt-1">{effectsNote}</p>}
        {effects && !!actions?.length && <div className="my-1 border-t border-border" />}
        {effects && <p className="px-4 pt-1 pb-1.5 text-caption text-subtle">{tr(actions?.length ? "С эффектом" : "Отправить с эффектом")}</p>}
        {effects && MESSAGE_EFFECTS.map((fx) => (
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

export default EffectMenu;
