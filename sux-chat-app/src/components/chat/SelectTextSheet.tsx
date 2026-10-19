import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Copy, Languages, Quote, X } from "lucide-react";
import { t as tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * «Выделить текст» из меню сообщения. В ленте текст не выделяется: долгое
 * нажатие там — жест (меню, запись голосового), поэтому выделение — здесь,
 * обычными системными ручками. Выделенное можно процитировать (ответ с
 * цитатой — тап по ней ведёт к сообщению) или скопировать; без выделения —
 * копируется всё. Есть перевод — можно выделять и в нём.
 */
export default function SelectTextSheet({ original, translation, showTranslation, canQuote, onQuote, onCopy, onClose }: {
  original: string;
  translation?: string | null;
  /** В пузыре сейчас показан перевод — с него и начинаем. */
  showTranslation: boolean;
  canQuote: boolean;
  onQuote: (fragment: string) => void;
  onCopy: (text: string) => void;
  onClose: () => void;
}) {
  const [useTr, setUseTr] = useState(!!translation && showTranslation);
  const text = useTr && translation ? translation : original;
  const boxRef = useRef<HTMLDivElement>(null);
  const selRef = useRef("");
  const [hasSel, setHasSel] = useState(false);

  // Что выделено внутри текста. На телефоне касание кнопки снимает выделение
  // раньше, чем придёт нажатие, — поэтому пустое выделение принимаем не сразу.
  useEffect(() => {
    let clear: ReturnType<typeof setTimeout> | null = null;
    const on = () => {
      const s = document.getSelection();
      const box = boxRef.current;
      const inside = !!s && !!box && s.rangeCount > 0 && !!s.anchorNode && !!s.focusNode
        && box.contains(s.anchorNode) && box.contains(s.focusNode);
      const picked = inside ? s!.toString().trim() : "";
      if (picked) {
        if (clear) { clearTimeout(clear); clear = null; }
        selRef.current = picked;
        setHasSel(true);
        return;
      }
      if (clear) clearTimeout(clear);
      clear = setTimeout(() => { clear = null; selRef.current = ""; setHasSel(false); }, 500);
    };
    document.addEventListener("selectionchange", on);
    return () => { document.removeEventListener("selectionchange", on); if (clear) clearTimeout(clear); };
  }, []);

  // Переключили оригинал/перевод — прежнее выделение к новому тексту не относится.
  useEffect(() => {
    document.getSelection()?.removeAllRanges();
    selRef.current = "";
    setHasSel(false);
  }, [useTr]);

  // На компьютере нажатие мышью на кнопку не должно снимать выделение.
  const keepSel = (e: React.MouseEvent) => e.preventDefault();

  return createPortal(
    <div className="fixed inset-0 z-[90] bg-black/60 flex flex-col justify-end" onClick={onClose}>
      <div className="bg-card border-t-2 border-border rounded-t-2xl pad-safe-bottom px-4 pt-3 pb-3 space-y-3 max-h-[85%] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <span className="font-semibold flex-1">{tr("Выделите текст")}</span>
          {!!translation && (
            <button type="button" onMouseDown={keepSel} onClick={() => setUseTr((v) => !v)}
              className="h-8 px-3 rounded-full bg-surface-2 border border-border text-caption font-medium flex items-center gap-1.5">
              <Languages className="w-3.5 h-3.5" /> {useTr ? tr("Оригинал") : tr("Перевод")}
            </button>
          )}
          <button type="button" onClick={onClose} aria-label={tr("Закрыть")}><X className="w-5 h-5" /></button>
        </div>
        <div ref={boxRef}
          className="select-text min-h-0 overflow-y-auto whitespace-pre-wrap break-words text-body rounded-md bg-surface-2 border border-border px-3.5 py-3"
          style={{ WebkitUserSelect: "text", userSelect: "text", WebkitTouchCallout: "default" } as React.CSSProperties}>
          {text}
        </div>
        <p className="text-caption text-subtle">
          {canQuote ? tr("Выделите кусок — его можно процитировать в ответе. Без выделения копируется весь текст.") : tr("Без выделения копируется весь текст.")}
        </p>
        <div className="flex gap-2">
          <button type="button" onMouseDown={keepSel} onClick={() => onCopy(selRef.current || text)}
            className="flex-1 h-11 rounded-md bg-surface-2 border border-border text-small font-medium flex items-center justify-center gap-2 active:opacity-80">
            <Copy className="w-4 h-4" /> {hasSel ? tr("Скопировать выделенное") : tr("Скопировать всё")}
          </button>
          {canQuote && (
            <button type="button" onMouseDown={keepSel} disabled={!hasSel} onClick={() => selRef.current && onQuote(selRef.current)}
              className={cn("flex-1 h-11 rounded-md bg-primary text-primary-foreground text-small font-medium flex items-center justify-center gap-2 active:opacity-80 disabled:opacity-40")}>
              <Quote className="w-4 h-4" /> {tr("Цитировать")}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
