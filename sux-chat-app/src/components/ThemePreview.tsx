import { useLayoutEffect, useRef } from "react";
import { Check, CheckCheck, Plus, Search } from "lucide-react";
import { paintTheme } from "@/themes/engine";
import type { ThemeDef } from "@/themes/types";

/**
 * Окно предпросмотра темы: кусочек списка чатов и переписки, собранный из тех
 * же классов, что и настоящие экраны. Тема применяется к обёртке — теми же
 * переменными и атрибутами, что и к корню документа (paintTheme), поэтому
 * предпросмотр показывает ровно то, что получится, и не трогает текущую тему.
 */
const ThemePreview = ({ theme, className = "" }: { theme: ThemeDef; className?: string }) => {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (ref.current) paintTheme(ref.current, theme); }, [theme]);

  return (
    <div
      ref={ref}
      className={`rounded-lg overflow-hidden border border-border bg-background text-foreground select-none ${className}`}
      style={{ colorScheme: theme.base }}
      aria-hidden
    >
      {/* шапка списка */}
      <div className="px-3 pt-3 pb-2 flex items-center gap-2">
        <span className="ui-me-avatar w-8 h-8 rounded-full bg-surface-4 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block text-small font-semibold truncate">{theme.name || "Моя тема"}</span>
          <span className="ui-status-chip inline-block text-[11px] text-online">В сети</span>
        </span>
        <span className="ui-plus w-8 h-8 shrink-0 rounded-full bg-primary text-primary-foreground flex items-center justify-center" style={{ width: 32, height: 32 }}>
          <Plus className="w-4 h-4" />
        </span>
      </div>
      <div className="px-3">
        <div className="ui-search flex items-center gap-2 h-8 px-2.5 rounded-md bg-surface-1 text-subtle text-[12px]">
          <Search className="w-3.5 h-3.5" /> Поиск чатов
        </div>
        <div className="mt-2 flex gap-1.5">
          <span className="ui-chip ui-chip-on h-6 px-2.5 rounded-full bg-primary text-primary-foreground text-[11px] font-medium inline-flex items-center">Все</span>
          <span className="ui-chip h-6 px-2.5 rounded-full bg-surface-1 text-muted-foreground text-[11px] font-medium inline-flex items-center gap-1">
            Непрочитанные
            <span className="ui-chip-count min-w-[15px] h-[15px] px-1 rounded-full bg-destructive text-destructive-foreground text-[9px] font-semibold inline-flex items-center justify-center">2</span>
          </span>
        </div>
      </div>
      {/* строка чата */}
      <div className="mt-2">
        <div className="chat-row relative">
          <div className="chat-row-card relative px-3 py-2 flex items-center gap-2.5 bg-background">
            <div className="w-9 h-9 rounded-full bg-surface-3 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-small font-semibold truncate">Graph_Morgan</span>
                <span className="text-[10px] text-subtle inline-flex items-center gap-0.5"><CheckCheck className="w-3 h-3 text-primary" />09:46</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] text-subtle truncate">Видел новую тему?</span>
                <span className="min-w-[16px] h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold flex items-center justify-center">2</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* переписка */}
      <div className="px-3 py-2.5 space-y-1.5" style={{ background: "hsl(var(--chat-canvas))" }}>
        <div className="flex">
          <div className="msg-bubble msg-peer px-2.5 py-1.5 rounded-lg text-[12px] max-w-[75%]">Привет! Как тебе тема?</div>
        </div>
        <div className="flex justify-end">
          <div className="msg-bubble msg-own px-2.5 py-1.5 rounded-lg text-[12px] max-w-[75%]">
            Выглядит бодро
            <span className="ml-2 inline-flex items-center gap-0.5 text-[10px] opacity-70">09:47 <Check className="w-3 h-3" /></span>
          </div>
        </div>
      </div>
      {/* карточка настроек, поле и кнопки */}
      <div className="px-3 py-2.5 space-y-2">
        <div className="ui-card rounded-lg bg-surface-2 border border-border divide-y divide-border">
          <div className="px-3 h-8 flex items-center justify-between text-[12px]"><span>Уведомления</span><span className="text-muted-foreground">Обычный звук</span></div>
          <div className="px-3 h-8 flex items-center text-[12px] text-destructive">Удалить аккаунт</div>
        </div>
        <div className="flex gap-2">
          <input readOnly tabIndex={-1} value="Сообщение…" className="flex-1 min-w-0 h-8 px-2.5 rounded-md bg-surface-2 border border-border text-[12px] text-subtle outline-none" />
          <button type="button" tabIndex={-1} className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-[12px] font-semibold">Отправить</button>
          <button type="button" tabIndex={-1} className="h-8 px-3 rounded-md bg-surface-4 text-[12px] font-medium">Отмена</button>
        </div>
      </div>
    </div>
  );
};

export default ThemePreview;
