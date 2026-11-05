import { useMemo, useState } from "react";
import { BellOff, Clock, Loader2, Send, Trash2, X } from "lucide-react";
import type { ScheduledItem } from "@/api/client";
import { getLang, t as tr } from "@/lib/i18n";

/**
 * Отложенная отправка: выбор времени (SchedulePicker) и список отложенных в
 * чате (ScheduledList). Сообщение уходит само в назначенное время — сервер
 * (chat/scheduled.py), даже если приложение закрыто.
 */

const LOCALE = { ru: "ru-RU", en: "en-US", ko: "ko-KR" } as const;
const locale = () => LOCALE[getLang()] || "ru-RU";
const MAX_AHEAD = 365 * 24 * 3600 * 1000;

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** «сегодня в 20:00», «завтра в 9:00», «12 нояб. в 9:00». */
export function fmtWhen(d: Date): string {
  const now = new Date();
  const time = d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  if (sameDay(d, now)) return tr("сегодня в {time}", { time });
  if (sameDay(d, tomorrow)) return tr("завтра в {time}", { time });
  const date = d.toLocaleDateString(locale(), { day: "numeric", month: "short", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
  return tr("{date} в {time}", { date, time });
}

const pad = (n: number) => String(n).padStart(2, "0");
const dateValue = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeValue = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

const at = (days: number, h: number, m = 0) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(h, m, 0, 0); return d; };

/** Когда отправить: готовые варианты и свои дата и время. */
export const SchedulePicker = ({ title, initial, busy, onPick, onClose }: {
  title: string;
  initial?: Date;
  busy?: boolean;
  onPick: (d: Date) => void;
  onClose: () => void;
}) => {
  const start = initial || new Date(Date.now() + 60 * 60 * 1000);
  const [date, setDate] = useState(dateValue(start));
  const [time, setTime] = useState(timeValue(start));
  const quick = useMemo(() => {
    const now = Date.now();
    const hour = new Date(now + 60 * 60 * 1000); hour.setSeconds(0, 0);
    const list = [{ label: tr("Через час"), d: hour }];
    const tonight = at(0, 20);
    if (tonight.getTime() - now > 30 * 60 * 1000) list.push({ label: fmtWhen(tonight), d: tonight });
    list.push({ label: fmtWhen(at(1, 9)), d: at(1, 9) }, { label: fmtWhen(at(1, 20)), d: at(1, 20) });
    return list;
  }, []);
  const custom = (() => {
    const d = new Date(`${date}T${time || "00:00"}`);
    return Number.isNaN(d.getTime()) ? null : d;
  })();
  const ok = !!custom && custom.getTime() > Date.now() + 30 * 1000 && custom.getTime() < Date.now() + MAX_AHEAD;
  return (
    <div className="fixed inset-0 z-[85] bg-black/60 flex flex-col justify-end md:items-center md:justify-center" onClick={onClose}>
      <div role="dialog" aria-label={title}
        className="bg-card border-t-2 md:border-2 border-border md:rounded-lg w-full md:w-[400px] p-4 pad-safe-bottom space-y-3"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-primary" />
          <p className="text-body font-semibold flex-1">{title}</p>
          <button type="button" onClick={onClose} className="p-1 -mr-1 text-subtle" aria-label={tr("Закрыть")}><X className="w-5 h-5" /></button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {quick.map((q) => (
            <button key={q.label} type="button" disabled={busy} onClick={() => onPick(q.d)}
              className="h-11 px-2 rounded-md bg-surface-4 text-small font-medium active:opacity-80 disabled:opacity-50 truncate">
              {q.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input type="date" value={date} min={dateValue(new Date())} onChange={(e) => setDate(e.target.value)}
            aria-label={tr("Дата")} className="flex-1 min-w-0 h-11 px-3 rounded-md bg-surface-4 outline-none text-body" />
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)}
            aria-label={tr("Время")} className="w-28 h-11 px-3 rounded-md bg-surface-4 outline-none text-body" />
        </div>
        <button type="button" disabled={!ok || busy} onClick={() => custom && onPick(custom)}
          className="w-full h-11 rounded-md bg-primary text-primary-foreground text-small font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          {ok && custom ? tr("Отправить {when}", { when: fmtWhen(custom) }) : tr("Выберите время в будущем")}
        </button>
      </div>
    </div>
  );
};

/** Отложенные в этом чате: отправить сейчас, перенести, удалить. */
export const ScheduledList = ({ items, onSendNow, onMove, onDelete, onClose }: {
  items: ScheduledItem[];
  onSendNow: (s: ScheduledItem) => void;
  onMove: (s: ScheduledItem) => void;
  onDelete: (s: ScheduledItem) => void;
  onClose: () => void;
}) => (
  <div className="fixed inset-0 z-[80] bg-black/60 flex flex-col justify-end md:items-center md:justify-center" onClick={onClose}>
    <div role="dialog" aria-label={tr("Отложенные сообщения")}
      className="bg-card border-t-2 md:border-2 border-border md:rounded-lg w-full md:w-[440px] max-h-[75%] flex flex-col pad-safe-bottom"
      onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
        <Clock className="w-5 h-5 text-primary" />
        <p className="text-body font-semibold flex-1">{tr("Отложенные сообщения")}</p>
        <button type="button" onClick={onClose} className="p-1 -mr-1 text-subtle" aria-label={tr("Закрыть")}><X className="w-5 h-5" /></button>
      </div>
      <div className="flex-1 overflow-y-auto divide-y divide-border">
        {!items.length && <p className="px-4 py-6 text-small text-subtle text-center">{tr("Отложенных сообщений нет")}</p>}
        {items.map((s) => (
          <div key={s.id} className="px-4 py-3 space-y-1.5" data-scheduled={s.id}>
            <div className="flex items-center gap-2 text-caption">
              <span className="font-semibold text-primary">{fmtWhen(new Date(s.send_at))}</span>
              {s.silent && <span className="inline-flex items-center gap-1 text-subtle"><BellOff className="w-3.5 h-3.5" />{tr("без звука")}</span>}
            </div>
            <p className="text-body whitespace-pre-wrap break-words line-clamp-3">{s.content}</p>
            {s.error && <p className="text-caption text-destructive">{tr("Не отправилось: {error}", { error: tr(s.error) })}</p>}
            <div className="flex items-center gap-4 pt-0.5 text-small">
              <button type="button" onClick={() => onSendNow(s)} className="inline-flex items-center gap-1 text-primary font-medium"><Send className="w-4 h-4" />{tr("Отправить сейчас")}</button>
              <button type="button" onClick={() => onMove(s)} className="inline-flex items-center gap-1"><Clock className="w-4 h-4" />{tr("Перенести")}</button>
              <button type="button" onClick={() => onDelete(s)} className="inline-flex items-center gap-1 text-destructive ml-auto" aria-label={tr("Удалить")}><Trash2 className="w-4 h-4" /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>
);
