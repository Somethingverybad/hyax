import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Группа настроек: карточка со строками и волосяными разделителями между ними.
 * Рамка нужна светлой теме — там карточка белая на почти белом фоне и без
 * границы сливается; в тёмной она совпадает с цветом разделителей и не видна.
 */
export const SettingsCard = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn("shrink-0 ui-card rounded-lg bg-surface-2 border border-border divide-y divide-border overflow-hidden", className)}>
    {children}
  </div>
);

/**
 * Строка настроек. С onClick — кнопка с шевроном (ведёт на подэкран), без
 * него — просто строка со значением. trailing перебивает и то и другое:
 * туда кладут переключатель или кнопку «скопировать».
 */
export const SettingsRow = ({
  icon: Icon,
  label,
  value,
  hint,
  trailing,
  onClick,
  danger,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  /** Текущее значение справа — как «Включены» или «@ник». */
  value?: React.ReactNode;
  /** Пояснение под названием. */
  hint?: React.ReactNode;
  trailing?: React.ReactNode;
  onClick?: () => void;
  danger?: boolean;
}) => {
  const body = (
    <>
      {Icon && <Icon className={cn("w-5 h-5 shrink-0", danger ? "text-destructive" : "text-primary")} />}
      <span className="min-w-0 flex-1 text-left">
        <span className={cn("block text-body", danger && "text-destructive")}>{label}</span>
        {hint && <span className="block text-caption text-subtle truncate">{hint}</span>}
      </span>
      {value !== undefined && value !== null && (
        <span className="text-small text-muted-foreground max-w-[45%] truncate">{value}</span>
      )}
      {trailing ?? (onClick ? <ChevronRight className="w-4 h-4 text-subtle shrink-0" /> : null)}
    </>
  );

  const cls = "w-full min-h-14 px-4 py-2.5 flex items-center gap-3";
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cn(cls, "active:bg-surface-3")}>
        {body}
      </button>
    );
  }
  return <div className={cls}>{body}</div>;
};
