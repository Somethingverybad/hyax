import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Mic, MicOff, PhoneOff, Users } from "lucide-react";
import Identicon from "@/components/Identicon";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { setRailCallActive, useRailCallSlot } from "@/lib/railSlot";

type Props = {
  peer: { id: string; name: string; avatarUrl?: string | null };
  isGroup?: boolean;
  status: string;
  muted: boolean;
  onToggleMute: () => void;
  onHangup: () => void;
  onExpand?: () => void;
};

/** Свёрнутый звонок столбиком в панели разделов (широкое окно): аватар с
 *  зелёной точкой — тап возвращает к звонку, под ним статус, микрофон, отбой. */
const RailCall = ({ peer, isGroup, status, muted, onToggleMute, onHangup, onExpand }: Props) => {
  const btn = "w-[46px] h-[30px] shrink-0 flex items-center justify-center rounded-[14px] transition-opacity active:opacity-60";
  return (
    <div className="rail-call flex flex-col items-center gap-1 py-2" aria-label={t("Звонок")}>
      <button type="button" onClick={onExpand} className="relative shrink-0 active:opacity-70" aria-label={t("Вернуться к звонку")} title={peer.name}>
        {isGroup
          ? <span className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center"><Users className="w-5 h-5 text-primary" /></span>
          : <Identicon id={peer.id} avatarUrl={peer.avatarUrl} className="w-9 h-9" />}
        <span className="call-bar-dot absolute -right-0.5 -bottom-0.5 w-3 h-3 rounded-full bg-success border-2 border-surface-2" aria-hidden />
      </button>
      <span className="rail-player-title rail-vertical text-caption text-success tabular-nums">{status}</span>
      <button type="button" onClick={onToggleMute}
        className={cn(btn, muted ? "bg-foreground text-background" : "bg-surface-4 text-foreground")}
        aria-label={muted ? t("Включить микрофон") : t("Выключить микрофон")}>
        {muted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
      </button>
      {/* Отбой — красный в любой теме. */}
      <button type="button" onClick={onHangup} className={cn(btn, "bg-[#ff3b30] text-white")} aria-label={t("Завершить")}>
        <PhoneOff className="w-4 h-4" />
      </button>
    </div>
  );
};

/** Есть слот в панели (широкое окно) — звонок рисуется там, плеер прячется;
 *  нет (телефон) — обычная плашка fallback. */
export const RailCallPortal = ({ fallback, ...props }: Props & { fallback: ReactNode }) => {
  const slot = useRailCallSlot();
  useEffect(() => {
    setRailCallActive(!!slot);
    return () => setRailCallActive(false);
  }, [slot]);
  return slot ? createPortal(<RailCall {...props} />, slot) : <>{fallback}</>;
};

export default RailCall;
