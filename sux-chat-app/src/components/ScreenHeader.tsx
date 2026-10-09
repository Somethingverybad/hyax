import { useRef } from "react";
import { ChevronLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useMint, MintIcon } from "@/themes/mint";
import { useGlassHeight } from "@/themes/mint/glass";

/**
 * Шапка подэкрана: стрелка назад, заголовок по центру, необязательное
 * действие справа.
 *
 * Заголовок центрируется распоркой, а не absolute: шапка заходит под
 * статус-бар (pad-safe-top), и абсолютный элемент считал бы проценты от
 * padding-box вместе с отступом под вырез — текст вставал бы выше кнопок.
 * Пустая правая ячейка шириной с кнопку назад держит заголовок ровно посреди.
 */
const ScreenHeader = ({
  title,
  onBack,
  right,
  left,
}: {
  title: string;
  /** По умолчанию — шаг назад по истории. */
  onBack?: () => void;
  right?: React.ReactNode;
  /** Заменяет стрелку назад (например, текстовой «Отмена»). */
  left?: React.ReactNode;
}) => {
  const navigate = useNavigate();
  const mint = useMint();
  const glassRef = useRef<HTMLDivElement>(null);
  useGlassHeight(glassRef, mint);
  if (mint) {
    // «Мята»: назад — белая таблетка, заголовок по центру, действие справа —
    // салатовая таблетка (см. .mint-head-right в mint.css).
    return (
      <div ref={glassRef} className="mint-glass shrink-0 pad-safe-top">
        <div className="mint-head !pt-[19px] !pb-[12px]">
          {left ?? (
            <button type="button" onClick={onBack ?? (() => navigate(-1))} aria-label="Назад"
              className="mint-pill w-[37px] h-[31px] inline-flex items-center justify-center mint-muted">
              <MintIcon name="back" size={[7, 13]} />
            </button>
          )}
          <span className="mint-title truncate max-w-[56vw]">{title}</span>
          {right ? <span className="mint-head-right">{right}</span> : <span className="w-[37px]" aria-hidden />}
        </div>
      </div>
    );
  }
  return (
    <div className="shrink-0 px-2 py-3 pad-safe-top bg-background border-b border-border min-h-14 flex items-center gap-2">
      {left ?? (
        <button
          type="button"
          onClick={onBack ?? (() => navigate(-1))}
          className="w-10 h-10 -m-1 flex items-center justify-center active:opacity-60"
          aria-label="Назад"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
      )}
      <span className="flex-1 text-center text-h1 truncate">{title}</span>
      {right ?? <span className="w-10 shrink-0" aria-hidden />}
    </div>
  );
};

export default ScreenHeader;
