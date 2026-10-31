import { useLocation, useNavigate } from "react-router-dom";
import { ChevronRight, Palette, X } from "lucide-react";
import { t } from "@/lib/i18n";
import { tryTheme, useTrial } from "@/lib/theme";

/**
 * Плашка примерки темы (редактор → «Примерить»): тема на всём приложении, но
 * не сохранена. «К редактору» — вернуться и сохранить, крестик — снять
 * примерку. В самом редакторе плашки нет: там свои кнопки.
 */
const ThemeTryBar = () => {
  const trial = useTrial();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  if (!trial || pathname === trial.from) return null;
  const name = trial.theme.name?.trim() || t("Моя тема");
  // Узкая — между кнопками шапки (в «Мяте» по краям «Изм.» и «+»): вся таблетка
  // ведёт в редактор, крестик снимает примерку; название — в подсказке.
  return (
    <div title={name} className="fixed z-[95] left-1/2 -translate-x-1/2 top-[calc(var(--sat,0px)+6px)] h-10 p-1 rounded-full bg-surface-1 text-foreground border border-border shadow-xl flex items-center gap-1">
      <button type="button" onClick={() => navigate(trial.from)} aria-label={t("К редактору")}
        className="h-8 pl-2.5 pr-1.5 rounded-full bg-primary text-primary-foreground text-[12.5px] font-semibold flex items-center gap-1 whitespace-nowrap active:opacity-90">
        <Palette className="w-3.5 h-3.5" />{t("Примерка")}<ChevronRight className="w-3.5 h-3.5" />
      </button>
      <button type="button" onClick={() => tryTheme(null)} aria-label={t("Отменить примерку")} className="w-8 h-8 rounded-full grid place-items-center text-subtle shrink-0 active:bg-surface-3">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

export default ThemeTryBar;
