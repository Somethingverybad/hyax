import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/client";
import { cn } from "@/lib/utils";
import { MAIN_REACTIONS, EXTRA_REACTIONS, type ReactionSummary } from "@/lib/reactions";
import { Smile, Plus } from "lucide-react";
import { t } from "@/lib/i18n";
import NotoEmoji from "@/components/NotoEmoji";

/**
 * Реакции — один модуль на переписку и на каналы.
 *
 * И там и там это реакции на Message (пост канала — тоже сообщение), поэтому
 * запрос один: api.reactToMessage. Меняем здесь — меняется везде.
 *
 * Размеры из тайллиста: S 28, M 32, L 40 — высота таблетки; эмодзи в
 * ней 20–24 px — анимированные Google Noto (components/NotoEmoji).
 */
export type ReactionSize = "s" | "m" | "l";

const SIZE: Record<ReactionSize, string> = {
  s: "h-7 text-[13px] pl-1.5 pr-2 gap-1",
  m: "h-8 text-[15px] pl-2 pr-2.5 gap-1.5",
  l: "h-10 text-[17px] pl-2.5 pr-3 gap-2",
};
const EMOJI_PX: Record<ReactionSize, number> = { s: 20, m: 22, l: 24 };

/** Ряд таблеток «эмодзи + число» под сообщением. Свои подсвечены акцентом.
 *  Реакция, которой стало больше (поставили вы или собеседник), один раз
 *  проигрывает анимацию; нажатие — таблетка чуть увеличивается и играет. */
export const ReactionBar = ({ reactions, onToggle, size = "m", className }: {
  reactions?: ReactionSummary[];
  onToggle: (emoji: string) => void;
  size?: ReactionSize;
  className?: string;
}) => {
  const prev = useRef<Map<string, number> | null>(null);
  const [plays, setPlays] = useState<Record<string, number>>({});
  useEffect(() => {
    const now = new Map((reactions || []).map((r) => [r.emoji, r.count] as const));
    const was = prev.current;
    prev.current = now;
    if (!was) return;
    const grew = [...now].filter(([e, c]) => c > (was.get(e) || 0)).map(([e]) => e);
    if (grew.length) setPlays((p) => { const n = { ...p }; grew.forEach((e) => { n[e] = (n[e] || 0) + 1; }); return n; });
  }, [reactions]);
  if (!reactions?.length) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {reactions.map((r) => (
        <button
          key={r.emoji}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (!r.mine) e.currentTarget.animate([{ transform: "scale(1)" }, { transform: "scale(1.16)", offset: 0.35 }, { transform: "scale(1)" }], { duration: 420, easing: "cubic-bezier(.3, 1.4, .5, 1)" });
            onToggle(r.emoji);
          }}
          aria-pressed={!!r.mine}
          aria-label={r.emoji}
          className={cn(
            "ui-reaction inline-flex items-center rounded-full border transition-colors",
            SIZE[size],
            r.mine
              ? "border-primary/50 bg-primary/15 text-foreground"
              : "border-border bg-surface-3 text-muted-foreground active:bg-surface-4",
          )}
        >
          <NotoEmoji emoji={r.emoji} size={EMOJI_PX[size]} play={plays[r.emoji] || 0} />
          {r.count > 1 && <span className="leading-none tabular-nums">{r.count}</span>}
        </button>
      ))}
    </div>
  );
};

/** Выбор реакции: основной набор в ряд, остальные — по кнопке «ещё». */
export const ReactionPicker = ({ open, onPick, onClose }: {
  open: boolean;
  onPick: (emoji: string) => void;
  onClose: () => void;
}) => {
  const [all, setAll] = useState(false);
  if (!open) return null;
  const list = all ? [...MAIN_REACTIONS, ...EXTRA_REACTIONS] : MAIN_REACTIONS;
  return (
    <div className="fixed inset-0 z-[75] flex items-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="ui-card relative w-full rounded-t-[16px] bg-surface-2 p-4 pb-[calc(var(--sab)+20px)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-foreground/20" aria-hidden />
        <div className="flex flex-wrap gap-2">
          {list.map((r, i) => (
            <button
              key={r.emoji}
              type="button"
              title={t(r.label)}
              aria-label={t(r.label)}
              onClick={() => onPick(r.emoji)}
              className="w-12 h-12 rounded-full bg-surface-4 text-[26px] leading-none flex items-center justify-center active:opacity-70"
            >
              <NotoEmoji emoji={r.emoji} size={30} autoPlay delay={i * 45} />
            </button>
          ))}
          {!all && (
            <button
              type="button"
              onClick={() => setAll(true)}
              aria-label={t("Ещё реакции")}
              className="w-12 h-12 rounded-full bg-surface-4 flex items-center justify-center text-muted-foreground active:opacity-70"
            >
              <Plus className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

/** Кнопка «добавить реакцию» рядом с сообщением — как в макете. */
export const AddReactionButton = ({ onClick, className }: { onClick: () => void; className?: string }) => (
  <button
    type="button"
    onClick={(e) => { e.stopPropagation(); onClick(); }}
    aria-label={t("Добавить реакцию")}
    className={cn("w-8 h-8 rounded-full bg-surface-3 text-muted-foreground flex items-center justify-center active:opacity-70", className)}
  >
    <Smile className="w-4 h-4" />
  </button>
);

/**
 * Переключение реакции с мгновенным откликом: рисуем сразу, ответ сервера
 * потом поправит числа, ошибка — вернёт как было. Общая логика для переписки
 * и каналов, поэтому живёт здесь, а не в экранах.
 */
export function applyReaction(list: ReactionSummary[] | undefined, emoji: string): ReactionSummary[] {
  const rows = (list || []).map((r) => ({ ...r }));
  const found = rows.find((r) => r.emoji === emoji);
  if (found?.mine) {
    found.count -= 1;
    found.mine = false;
    return rows.filter((r) => r.count > 0);
  }
  if (found) { found.count += 1; found.mine = true; return rows; }
  return [...rows, { emoji, count: 1, mine: true }];
}

export async function sendReaction(
  messageId: string,
  emoji: string,
  onDone: (reactions: ReactionSummary[]) => void,
  onFail: () => void,
) {
  try {
    const r = await api.reactToMessage(messageId, emoji);
    onDone(r.reactions);
  } catch (e: any) {
    onFail();
    toast.error(e?.message || t("Не удалось поставить реакцию"));
  }
}
