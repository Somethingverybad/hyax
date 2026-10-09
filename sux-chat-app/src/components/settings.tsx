import { ChevronRight, Tag, AlignLeft, AtSign, Images, Bell, Sticker, Lock, Palette, RefreshCw, Bug, Eraser, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMint, MintIcon, type MintIconName } from "@/themes/mint";

/** «Мята»: значки строк из макета вместо lucide (где в макете они есть). */
const MINT_ROW_ICON = new Map<unknown, MintIconName>([
  [Tag, "rowTag"], [AlignLeft, "rowAbout"], [AtSign, "rowAt"], [Images, "rowSaved"], [Bell, "rowBell"],
  [Sticker, "rowSticker"], [Lock, "rowLock"], [Palette, "rowAppearance"], [RefreshCw, "rowUpdate"],
  [Bug, "rowBug"], [Eraser, "rowCache"], [LogOut, "rowLogout"],
]);

/**
 * Группа настроек: карточка со строками и волосяными разделителями между ними.
 * Рамка нужна светлой теме — там карточка белая на почти белом фоне и без
 * границы сливается; в тёмной она совпадает с цветом разделителей и не видна.
 */
export const SettingsCard = ({ children, className }: { children: React.ReactNode; className?: string }) => {
  const mint = useMint();
  if (mint) return <div className={cn("shrink-0 mint-card mint-rows overflow-hidden", className)}>{children}</div>;
  return (
    <div className={cn("shrink-0 ui-card rounded-lg bg-surface-2 border border-border divide-y divide-border overflow-hidden", className)}>
      {children}
    </div>
  );
};

/**
 * Строка настроек. С onClick — кнопка с шевроном (ведёт на подэкран), без
 * него — просто строка со значением. trailing перебивает и то и другое:
 * туда кладут переключатель или кнопку «скопировать».
 */
export const SettingsRow = ({
  icon: Icon,
  leading,
  label,
  value,
  hint,
  trailing,
  onClick,
  danger,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  /** Заменяет значок слева — например обложкой пака. */
  leading?: React.ReactNode;
  label: string;
  /** Текущее значение справа — как «Включены» или «@ник». */
  value?: React.ReactNode;
  /** Пояснение под названием. */
  hint?: React.ReactNode;
  trailing?: React.ReactNode;
  onClick?: () => void;
  danger?: boolean;
}) => {
  const mint = useMint();
  if (mint) {
    const mi = Icon ? MINT_ROW_ICON.get(Icon) : undefined;
    const mbody = (
      <>
        {leading ?? (Icon && (
          <span className={cn("w-[22px] shrink-0 flex justify-center", danger ? "text-destructive" : "mint-ink")}>
            {mi ? <MintIcon name={mi} size={19} /> : <Icon className="w-[19px] h-[19px]" />}
          </span>
        ))}
        <span className="min-w-0 flex-1 text-left">
          <span className={cn("block mint-row-label", danger && "!text-destructive")}>{label}</span>
          {hint && <span className="block mint-row-hint truncate">{hint}</span>}
        </span>
        {value !== undefined && value !== null && <span className="mint-row-value max-w-[45%] truncate">{value}</span>}
        {trailing ?? (onClick ? <MintIcon name="chevron" size={[5, 10]} className="mint-muted" /> : null)}
      </>
    );
    const mcls = "w-full min-h-[51px] px-[19px] py-2.5 flex items-center gap-[13px]";
    return onClick
      ? <button type="button" onClick={onClick} className={cn(mcls, "active:bg-black/5")}>{mbody}</button>
      : <div className={mcls}>{mbody}</div>;
  }
  const body = (
    <>
      {leading ?? (Icon && <Icon className={cn("w-5 h-5 shrink-0", danger ? "text-destructive" : "text-primary")} />)}
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
