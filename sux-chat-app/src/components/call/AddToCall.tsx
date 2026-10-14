import { useState } from "react";
import { X, UserPlus, Check } from "lucide-react";
import Identicon from "@/components/Identicon";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";

export interface CallCandidate { id: string; name: string; avatarUrl?: string | null }

/**
 * Кого позвать в идущий звонок: участники чата и люди из личных переписок,
 * кого ещё нет в звонке. Несколько сразу — одной кнопкой.
 */
const AddToCall = ({ candidates, onClose, onConfirm }: {
  candidates: CallCandidate[];
  onClose: () => void;
  onConfirm: (ids: string[]) => void;
}) => {
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [q, setQ] = useState("");
  const shown = candidates.filter((c) => !q.trim() || c.name.toLowerCase().includes(q.trim().toLowerCase()));
  const toggle = (id: string) => setPicked((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <div className="fixed inset-0 z-[70] bg-black/60 flex flex-col justify-end md:items-center md:justify-center" onClick={onClose}>
      <div className="bg-card border-t-2 md:border-2 border-border md:rounded-lg w-full md:w-[420px] max-h-[75%] flex flex-col pad-safe-bottom" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
          <UserPlus className="w-5 h-5 text-primary" />
          <span className="font-semibold flex-1">{t("Добавить в звонок")}</span>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")}><X className="w-5 h-5" /></button>
        </div>
        {candidates.length > 6 && (
          <div className="px-4 pt-3 shrink-0">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Поиск по нику")} className="w-full h-10 px-3 rounded-md bg-surface-4 text-body outline-none" />
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {candidates.length === 0 ? (
            <p className="text-small text-subtle py-4 text-center">{t("Некого позвать: нужны переписки с людьми")}</p>
          ) : shown.length === 0 ? (
            <p className="text-small text-subtle py-4 text-center">{t("Никого не нашлось")}</p>
          ) : shown.map((c) => {
            const on = picked.has(c.id);
            return (
              <button key={c.id} type="button" onClick={() => toggle(c.id)}
                className={cn("w-full min-h-12 px-3 rounded-md flex items-center gap-3 text-left bg-surface-4 active:opacity-70", on && "ring-2 ring-primary")}>
                <Identicon id={c.id} avatarUrl={c.avatarUrl} className="w-8 h-8" />
                <span className="flex-1 min-w-0 truncate text-body">{c.name}</span>
                {on && <Check className="w-5 h-5 text-primary shrink-0" />}
              </button>
            );
          })}
        </div>
        <div className="px-4 pt-2 pb-3 shrink-0">
          <button type="button" disabled={!picked.size} onClick={() => onConfirm([...picked])}
            className="w-full h-11 rounded-md bg-primary text-primary-foreground font-semibold disabled:opacity-40">
            {t("Позвать")}{picked.size ? ` (${picked.size})` : ""}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AddToCall;
