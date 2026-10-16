import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { api, actionName, type ChatActionInfo } from "@/api/client";
import { getLang, t } from "@/lib/i18n";
import { readCache } from "@/lib/session-cache";
import { cn } from "@/lib/utils";
import { useKeyboardHeight } from "@/lib/useKeyboardHeight";

let cache: ChatActionInfo[] | null = null;
let cacheAdult: boolean | null = null;
/** Каталог действий — один раз за сессию (меняется только в админке). Действия
 *  18+ сервер отдаёт только с галкой «Показывать 18+» — включил или выключил её,
 *  каталог перечитываем. */
export async function loadActions(force = false): Promise<ChatActionInfo[]> {
  const adult = !!readCache<{ allow_adult?: boolean }>("user")?.allow_adult;
  if (cache && !force && cacheAdult === adult) return cache;
  cache = await api.getActions();
  cacheAdult = adult;
  return cache;
}

/** Сетка действий («подмигнуть», «обнять»…) — для панели стикеров и меню сообщения. */
export const ActionGrid = ({ onPick, compact }: { onPick: (a: ChatActionInfo) => void; compact?: boolean }) => {
  const [list, setList] = useState<ChatActionInfo[]>(cache || []);
  const [q, setQ] = useState("");
  useEffect(() => { loadActions().then(setList).catch(() => {}); }, []);
  if (!list.length) return <p className="text-sm text-muted-foreground text-center py-6">{t("Загрузка…")}</p>;
  // Поиск — по названию на языке приложения и по-русски (кнопка и глагол).
  const s = q.trim().toLowerCase();
  const shown = s ? list.filter((a) => [actionName(a, getLang()), a.name, a.verb].some((x) => (x || "").toLowerCase().includes(s))) : list;
  return (
    <div>
      <label className={cn("flex items-center gap-2 h-10 px-3 rounded-md bg-surface-4", compact ? "mx-2 mt-2" : "mx-4 mt-3")}>
        <Search className="w-4 h-4 text-subtle shrink-0" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Поиск действия")} enterKeyHint="search"
          className="flex-1 min-w-0 bg-transparent outline-none text-body" />
        {q && <button type="button" onClick={() => setQ("")} aria-label={t("Очистить")} className="text-subtle"><X className="w-4 h-4" /></button>}
      </label>
      {!shown.length && <p className="text-sm text-muted-foreground text-center py-6">{t("Ничего не найдено")}</p>}
    {/* Узкий экран — одна колонка: длинные названия («Послать лучи добра»,
        «Twirl at the temple») иначе обрезались многоточием. */}
    <div className={compact ? "grid grid-cols-1 min-[480px]:grid-cols-2 sm:grid-cols-3 gap-2 p-2" : "grid grid-cols-1 min-[480px]:grid-cols-2 gap-2 px-4 py-3"}>
      {shown.map((a) => (
        <button key={a.id} type="button" onClick={() => onPick(a)}
          className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-surface-4 text-left active:opacity-70">
          <span className="text-xl leading-none shrink-0">{a.emoji}</span>
          <span className="text-sm leading-snug break-words min-w-0">{actionName(a, getLang())}</span>
        </button>
      ))}
    </div>
    </div>
  );
};

/** Шторка «Действие для <ник>» из меню сообщения. */
const ActionSheet = ({ title, onClose, onPick }: { title: string; onClose: () => void; onPick: (a: ChatActionInfo) => void }) => {
  // Высота клавиатуры — из общего события: на iPhone --kb-* на корне нет.
  const kb = useKeyboardHeight();
  return (
  <div className="fixed inset-0 z-[80] bg-black/60 flex flex-col justify-end md:items-center md:justify-center" onClick={onClose}>
    {/* Высота — в пределах видимой части над клавиатурой (поиск её открывает). */}
    <div className="bg-card border-t-2 md:border-2 border-border md:rounded-lg w-full md:w-[420px] flex flex-col pad-safe-bottom"
      style={{ maxHeight: `min(70%, calc(100% - ${kb}px - var(--sat, 0px) - 12px))` }}
      onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
        <span className="font-semibold flex-1 truncate">{title}</span>
        <button type="button" onClick={onClose} aria-label={t("Закрыть")}><X className="w-5 h-5" /></button>
      </div>
      <div className="flex-1 overflow-y-auto"><ActionGrid onPick={onPick} /></div>
    </div>
  </div>
  );
};

export default ActionSheet;
