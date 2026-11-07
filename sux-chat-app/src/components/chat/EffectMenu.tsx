import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MESSAGE_EFFECTS, type MessageEffect } from "@/lib/effects";
import { t as tr } from "@/lib/i18n";
import { applog } from "@/lib/applog";
import { FormattedText, type TextEntity } from "@/lib/format";

/**
 * Меню по удержанию кнопки «Отправить» (lib/effects): как меню стикера и меню
 * сообщения — экран размывается, в центре крупно само сообщение (с разметкой),
 * под ним — «Без звука», «Отложить» и эффекты; тап мимо — закрыть. Раньше
 * карточка висела у кнопки «Отправить». Клавиатуру на время меню сворачивает
 * ChatWindow: выбрали пункт — она не возвращается, закрыли тапом мимо —
 * возвращается.
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
/** Что отправляем — пузырём, как в ленте; длинное — первые строки. */
export type SendPreview = { text: string; entities?: TextEntity[] | null };
const EffectMenu = ({ preview, onPick, onClose, actions, effects = true, effectsNote }: {
  preview?: SendPreview | null;
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
  // Сначала кадр без меню, потом — выезд (как у меню стикера).
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return createPortal(
    // data-keep-panel: касание по меню ChatWindow не считает «тапом мимо» панели.
    <div data-keep-panel className="fixed inset-0 z-[90] touch-none flex flex-col items-center justify-center gap-3 px-6"
      style={{
        paddingTop: "max(12px, env(safe-area-inset-top))",
        paddingBottom: "max(12px, env(safe-area-inset-bottom))",
        background: shown ? "rgba(0,0,0,0.35)" : "rgba(0,0,0,0)",
        backdropFilter: shown ? "blur(14px)" : "blur(0px)",
        WebkitBackdropFilter: shown ? "blur(14px)" : "blur(0px)",
        transition: "background 180ms ease-out, backdrop-filter 180ms ease-out, -webkit-backdrop-filter 180ms ease-out",
      }}
      onMouseDown={keepFocus}
      // preventDefault: без него браузер после касания дошлёт mousedown туда,
      // где было меню, — в ленту, и она отнимет фокус у поля, которому
      // ChatWindow только что вернул клавиатуру.
      onTouchEnd={(e) => { if (e.cancelable) e.preventDefault(); viaTouch(() => closeBy("touchend"))(e); }} onClick={viaClick(() => closeBy("click"))}
      // Android после удержания сам шлёт contextmenu — первую секунду не закрываем.
      onContextMenu={(e) => { e.preventDefault(); if (Date.now() - openedAt.current > 1000) closeBy("contextmenu"); }}>
      {preview?.text && (
        <div data-send-preview className="pointer-events-none shrink-0 msg-bubble msg-own px-3 py-2 shadow-xl whitespace-pre-wrap text-body max-w-[min(320px,100%)] overflow-hidden"
          style={{
            display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 6,
            transformOrigin: "center bottom",
            transform: shown ? "scale(1)" : "scale(0.7)",
            opacity: shown ? 1 : 0,
            transition: "transform 240ms cubic-bezier(0.2, 0.9, 0.3, 1.2), opacity 150ms ease-out",
          }}>
          <FormattedText text={preview.text} entities={preview.entities} seed="send-preview" />
        </div>
      )}
      <div ref={ref} role="menu" aria-label={tr(actions?.length ? "Как отправить" : "Отправить с эффектом")}
        className="ui-card w-64 min-h-0 shrink overflow-y-auto touch-pan-y rounded-2xl bg-surface-2/95 shadow-xl py-1.5"
        style={{
          transformOrigin: "center top",
          transform: shown ? "scale(1)" : "scale(0.8)",
          opacity: shown ? 1 : 0,
          transition: "transform 220ms cubic-bezier(0.2, 0.9, 0.3, 1.15), opacity 160ms ease-out",
        }}
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
