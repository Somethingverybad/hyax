import { useLayoutEffect, useRef, type RefObject } from "react";
import CustomEmoji from "./CustomEmoji";
import type { CustomEmojiRange } from "@/lib/format";

/**
 * Свои эмодзи прямо в поле ввода. В textarea картинку не вставить, поэтому
 * поверх поля лежит его копия с теми же шрифтом, отступами и переносами:
 * обычный текст в ней видимый, а на месте своего эмодзи — картинка над
 * прозрачным символом той же ширины (поэтому каретка и переносы совпадают).
 * Сам текст поля в это время прозрачный (класс compose-has-custom), каретка,
 * выделение и ввод — его; копия кликов не ловит.
 */
const COPY = [
  "fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "letterSpacing", "wordSpacing",
  "textIndent", "textTransform", "tabSize", "boxSizing",
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
] as const;

const ComposeMirror = ({ text, ranges, target }: { text: string; ranges: CustomEmojiRange[]; target: RefObject<HTMLTextAreaElement> }) => {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const ta = target.current, el = ref.current;
    if (!ta || !el) return;
    const sync = () => {
      const cs = getComputedStyle(ta);
      for (const k of COPY) el.style[k] = cs[k];
      el.style.width = `${ta.offsetWidth}px`;
      el.style.height = `${ta.offsetHeight}px`;
      el.style.left = `${ta.offsetLeft}px`;
      el.style.top = `${ta.offsetTop}px`;
      el.scrollTop = ta.scrollTop;
      // Каретка поля — цветом текста: свой цвет у него сейчас прозрачный.
      ta.style.setProperty("--compose-caret", getComputedStyle(el).color);
    };
    sync();
    const onScroll = () => { el.scrollTop = ta.scrollTop; };
    ta.addEventListener("scroll", onScroll, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(sync) : null;
    ro?.observe(ta);
    return () => { ta.removeEventListener("scroll", onScroll); ro?.disconnect(); };
  });
  const parts: React.ReactNode[] = [];
  let pos = 0;
  for (const r of [...ranges].sort((a, b) => a.offset - b.offset)) {
    if (r.offset < pos || r.offset + r.length > text.length) continue;
    if (r.offset > pos) parts.push(text.slice(pos, r.offset));
    const glyph = text.slice(r.offset, r.offset + r.length);
    parts.push(r.url ? (
      <span key={r.offset} className="compose-cemoji">
        {glyph}
        <CustomEmoji url={r.url} alt="" loop={false} className="compose-cemoji-img" />
      </span>
    ) : glyph);
    pos = r.offset + r.length;
  }
  // Пустая строка после последнего переноса тоже занимает высоту — как в поле.
  parts.push(text.slice(pos) + "​");
  return <div ref={ref} aria-hidden className="compose-mirror">{parts}</div>;
};

export default ComposeMirror;
