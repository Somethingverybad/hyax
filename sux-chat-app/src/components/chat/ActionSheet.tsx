import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { api, type ChatActionInfo } from "@/api/client";

let cache: ChatActionInfo[] | null = null;
/** Каталог действий — один раз за сессию (меняется только в админке). */
export async function loadActions(): Promise<ChatActionInfo[]> {
  if (cache) return cache;
  cache = await api.getActions();
  return cache;
}

/** Сетка действий («подмигнуть», «обнять»…) — для панели стикеров и меню сообщения. */
export const ActionGrid = ({ onPick, compact }: { onPick: (a: ChatActionInfo) => void; compact?: boolean }) => {
  const [list, setList] = useState<ChatActionInfo[]>(cache || []);
  useEffect(() => { loadActions().then(setList).catch(() => {}); }, []);
  if (!list.length) return <p className="text-sm text-muted-foreground text-center py-6">Загрузка…</p>;
  return (
    <div className={compact ? "grid grid-cols-3 gap-2 p-2" : "grid grid-cols-2 gap-2 px-4 py-3"}>
      {list.map((a) => (
        <button key={a.id} type="button" onClick={() => onPick(a)}
          className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-surface-4 text-left active:opacity-70">
          <span className="text-xl leading-none">{a.emoji}</span>
          <span className="text-sm truncate">{a.name}</span>
        </button>
      ))}
    </div>
  );
};

/** Шторка «Действие для <ник>» из меню сообщения. */
const ActionSheet = ({ title, onClose, onPick }: { title: string; onClose: () => void; onPick: (a: ChatActionInfo) => void }) => (
  <div className="fixed inset-0 z-[80] bg-black/60 flex flex-col justify-end md:items-center md:justify-center" onClick={onClose}>
    <div className="bg-card border-t-2 md:border-2 border-border md:rounded-lg w-full md:w-[420px] max-h-[70%] flex flex-col pad-safe-bottom" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
        <span className="font-semibold flex-1 truncate">{title}</span>
        <button type="button" onClick={onClose} aria-label="Закрыть"><X className="w-5 h-5" /></button>
      </div>
      <div className="flex-1 overflow-y-auto"><ActionGrid onPick={onPick} /></div>
    </div>
  </div>
);

export default ActionSheet;
