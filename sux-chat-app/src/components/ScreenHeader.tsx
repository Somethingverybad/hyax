import { ChevronLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";

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
