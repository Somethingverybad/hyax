import { createPortal } from "react-dom";
import { Bell, BellOff, X } from "lucide-react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { isMutedNow, muteLabel, MUTE_SPANS, type MuteSpan, type MuteState } from "@/lib/chatMute";

/**
 * Шторка «Уведомления»: на сколько выключить (1, 4, 8 часов, навсегда) или
 * включить снова. Открывается из профиля собеседника (аватар в шапке
 * переписки). Порталом на body — поверх экрана профиля и острова навигации.
 */
const MuteSheet = ({ name, state, onPick, onClose }: {
  name: string;
  state: MuteState;
  onPick: (span: MuteSpan) => void;
  onClose: () => void;
}) => {
  const muted = isMutedNow(state);
  const row = "w-full h-12 px-4 flex items-center gap-3 text-body text-left active:bg-surface-3";
  return createPortal(
    <div className="fixed inset-0 z-[95] bg-black/60 flex items-end md:items-center md:justify-center" onClick={onClose}>
      <div role="dialog" aria-label={t("Уведомления")}
        className="w-full md:w-[420px] bg-surface-2 rounded-t-[16px] md:rounded-lg md:border md:border-border p-5 pb-[calc(var(--sab)+20px)] md:pb-5 relative"
        onClick={(e) => e.stopPropagation()}>
        <div className="md:hidden absolute top-2 left-1/2 -translate-x-1/2 w-9 h-1 rounded-full bg-foreground/20" aria-hidden />
        <div className="flex items-center gap-2 mb-1">
          {muted ? <BellOff className="w-5 h-5 text-primary" /> : <Bell className="w-5 h-5 text-primary" />}
          <h2 className="text-h2 flex-1 truncate">{t("Уведомления: {name}", { name })}</h2>
          <button type="button" onClick={onClose} className="p-1.5 text-subtle" aria-label={t("Закрыть")}><X className="w-4 h-4" /></button>
        </div>
        <p className="text-small text-subtle mb-4">{muteLabel(state)}</p>
        <div className="rounded-lg bg-surface-4 divide-y divide-border overflow-hidden">
          {muted && (
            <button type="button" onClick={() => onPick("off")} className={cn(row, "text-primary font-medium")}>
              <Bell className="w-5 h-5" />{t("Включить уведомления")}</button>
          )}
          {MUTE_SPANS.map(({ span, label }) => (
            <button key={span} type="button" onClick={() => onPick(span)} className={row}>
              <BellOff className="w-5 h-5 text-subtle" />{t(label)}</button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default MuteSheet;
