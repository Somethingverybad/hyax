import { Pause, Play, X } from "lucide-react";
import Identicon from "@/components/Identicon";
import { fmtNoteTime, setNoteRate, stopNote, toggleNote, useVideoNote } from "@/lib/videoNote";
import { getLang, t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const RATES = [1, 1.5, 2, 0.5];

/**
 * Плашка управления играющим треугольником — под шапкой чата, как закреп
 * (референс — Telegram): аватар и имя отправителя, пауза/играть, время,
 * скорость, крестик. Видна, пока ролик играет в этом чате (не виджетом).
 */
export default function VideoNoteBar({ chatId, mint, offset = 0 }: { chatId: string; mint: boolean; offset?: number }) {
  const s = useVideoNote();
  const n = s.note;
  if (!n || n.chatId !== chatId || s.mode === "float") return null;
  const lang = getLang();
  const when = n.at ? new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : lang === "ko" ? "ko-KR" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(n.at)) : "";
  const cycle = () => setNoteRate(RATES[(RATES.indexOf(s.rate) + 1) % RATES.length]);
  return (
    <div
      className={cn(mint ? "mint-card absolute left-[17px] right-[17px] z-20 flex items-center gap-[10px] px-3 py-[6px]"
        : "absolute left-0 right-0 z-20 flex items-center gap-3 px-4 md:px-7 py-1.5 border-b border-border bg-surface-1/95 backdrop-blur")}
      style={{ top: `calc(var(--glass-h, 0px) + var(--player-h, 0px) + var(--call-h, 0px) + ${offset}px)` }}
      role="toolbar"
      aria-label={t("Видео-сообщение")}
    >
      {n.sender && <Identicon id={n.sender.id} avatarUrl={n.sender.avatar_url} className="w-8 h-8 shrink-0 rounded-full" />}
      <button type="button" onClick={toggleNote} className="w-9 h-9 shrink-0 rounded-full bg-primary text-primary-foreground flex items-center justify-center" aria-label={s.playing ? t("Пауза") : t("Играть")}>
        {s.playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
      </button>
      <div className="min-w-0 flex-1">
        <p className="text-small font-medium truncate">{n.sender?.username || t("Видео-сообщение")}</p>
        <p className="text-caption text-subtle tabular-nums truncate">{fmtNoteTime(s.time)}{when ? ` · ${when}` : ` / ${fmtNoteTime(s.duration || n.seconds)}`}</p>
      </div>
      <button type="button" onClick={cycle} className={cn("h-7 min-w-[2.4rem] px-1.5 rounded-md text-[11px] font-semibold tabular-nums border", s.rate === 1 ? "border-border text-subtle" : "border-primary text-primary")} aria-label={t("Скорость {n}×", { n: s.rate })}>
        {s.rate}×
      </button>
      <button type="button" onClick={stopNote} className="w-9 h-9 shrink-0 flex items-center justify-center text-subtle active:text-foreground" aria-label={t("Закрыть")}>
        <X className="w-5 h-5" />
      </button>
    </div>
  );
}
