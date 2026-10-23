import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/client";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import { MAIN_REACTIONS, EXTRA_REACTIONS, customReactionKey, quickReaction, reactionKey, type ReactionPick, type ReactionSummary } from "@/lib/reactions";
import { Smile, Plus } from "lucide-react";
import { t } from "@/lib/i18n";
import NotoEmoji from "@/components/NotoEmoji";
import CustomEmoji from "@/components/chat/CustomEmoji";
import { cachedCustomPacks, refreshCustomPacks } from "@/components/chat/EmojiPanel";

/**
 * Реакции — один модуль на переписку и на каналы.
 *
 * И там и там это реакции на Message (пост канала — тоже сообщение), поэтому
 * запрос один: api.reactToMessage. Меняем здесь — меняется везде.
 *
 * Размеры из тайллиста: S 28, M 32, L 40 — высота таблетки; эмодзи в
 * ней 20–24 px — анимированные Google Noto (components/NotoEmoji) или свой
 * эмодзи из набора (custom). Реакцию везде узнаём по reactionKey: у своего
 * эмодзи emoji — лишь обычный двойник для старых клиентов.
 */
/** Быстрая реакция (lib/reactions quickReaction) с перерисовкой при смене в настройках. */
export function useQuickReaction(): ReactionPick {
  const [pick, setPick] = useState(quickReaction);
  useEffect(() => {
    const on = () => setPick(quickReaction());
    window.addEventListener("hyax:quick-reaction", on);
    return () => window.removeEventListener("hyax:quick-reaction", on);
  }, []);
  return pick;
}

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
  onToggle: (key: string) => void;
  size?: ReactionSize;
  className?: string;
}) => {
  const prev = useRef<Map<string, number> | null>(null);
  const [plays, setPlays] = useState<Record<string, number>>({});
  useEffect(() => {
    const now = new Map((reactions || []).map((r) => [reactionKey(r), r.count] as const));
    const was = prev.current;
    prev.current = now;
    if (!was) return;
    const grew = [...now].filter(([e, c]) => c > (was.get(e) || 0)).map(([e]) => e);
    if (grew.length) setPlays((p) => { const n = { ...p }; grew.forEach((e) => { n[e] = (n[e] || 0) + 1; }); return n; });
  }, [reactions]);
  if (!reactions?.length) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {reactions.map((r) => { const key = reactionKey(r); return (
        <button
          key={key}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (!r.mine) e.currentTarget.animate([{ transform: "scale(1)" }, { transform: "scale(1.16)", offset: 0.35 }, { transform: "scale(1)" }], { duration: 420, easing: "cubic-bezier(.3, 1.4, .5, 1)" });
            onToggle(key);
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
          {r.custom
            ? <CustomEmoji url={r.custom.url} alt={r.emoji} repaint={r.custom.repaint} className="shrink-0 object-contain"
                style={{ width: EMOJI_PX[size], height: EMOJI_PX[size] }} />
            : <NotoEmoji emoji={r.emoji} size={EMOJI_PX[size]} play={plays[key] || 0} />}
          {r.count > 1 && <span className="leading-none tabular-nums">{r.count}</span>}
        </button>
      ); })}
    </div>
  );
};

/** Выбор реакции: основной набор в ряд, остальные — по кнопке «ещё»; ниже —
 *  мои наборы своих эмодзи (свои и сохранённые), как в панели эмодзи. */
/** Сетка реакций: основные, «ещё», свои наборы. selectedKey — отметить
 *  текущую (настройка быстрой реакции). Общая для шторки и настроек. */
export const ReactionGrid = ({ onPick, selectedKey, active = true }: {
  onPick: (key: string, pick?: ReactionPick) => void;
  selectedKey?: string | null;
  /** Пока false, наборы не перечитываются (шторка закрыта). */
  active?: boolean;
}) => {
  const [all, setAll] = useState(() => !!selectedKey && EXTRA_REACTIONS.some((r) => r.emoji === selectedKey));
  const [packs, setPacks] = useState(cachedCustomPacks);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    refreshCustomPacks().then((p) => { if (alive) setPacks(p); }).catch(() => {});
    return () => { alive = false; };
  }, [active]);
  const list = all ? [...MAIN_REACTIONS, ...EXTRA_REACTIONS] : MAIN_REACTIONS;
  const cell = (sel: boolean) => cn(
    "w-12 h-12 rounded-full flex items-center justify-center active:opacity-70",
    sel ? "bg-primary/20 ring-2 ring-primary" : "bg-surface-4",
  );
  // Паки — чипами: с несколькими наборами список длинный, нужный эмодзи
  // искать прокруткой долго. "" — всё, "std" — обычные, иначе id пака.
  const filled = (packs || []).filter((p) => p.items.length);
  const [tab, setTab] = useState<string>("");
  const showStd = tab === "" || tab === "std";
  const shownPacks = tab === "" ? filled : filled.filter((p) => p.id === tab);
  const chip = (sel: boolean) => cn(
    "h-8 px-3 rounded-full text-small whitespace-nowrap shrink-0 active:opacity-70",
    sel ? "bg-primary text-primary-foreground" : "bg-surface-4 text-foreground/80",
  );
  return (
    <>
      {filled.length > 0 && (
        <div className="-mx-4 px-4 mb-3 flex gap-2 overflow-x-auto" style={{ scrollbarWidth: "none" }} role="tablist">
          <button type="button" role="tab" aria-selected={tab === ""} onClick={() => setTab("")} className={chip(tab === "")}>{t("Все")}</button>
          <button type="button" role="tab" aria-selected={tab === "std"} onClick={() => setTab("std")} className={chip(tab === "std")}>{t("Обычные")}</button>
          {filled.map((p) => (
            <button key={p.id} type="button" role="tab" aria-selected={tab === p.id} onClick={() => setTab(p.id)} className={chip(tab === p.id)}>{p.name}</button>
          ))}
        </div>
      )}
      {showStd && <div className="flex flex-wrap gap-2">
        {list.map((r, i) => (
          <button
            key={r.emoji}
            type="button"
            title={t(r.label)}
            aria-label={t(r.label)}
            aria-pressed={selectedKey === r.emoji}
            onClick={() => onPick(r.emoji, { key: r.emoji, emoji: r.emoji })}
            className={cn(cell(selectedKey === r.emoji), "text-[26px] leading-none")}
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
      </div>}
      {shownPacks.map((p) => (
        <section key={p.id} className={showStd ? "mt-4" : ""}>
          {tab === "" && <p className="mb-2 text-caption text-subtle truncate">{p.name}</p>}
          <div className="flex flex-wrap gap-2">
            {p.items.map((e) => {
              const custom = { url: e.file_url, ...(e.repaint ? { repaint: true } : {}) };
              const glyph = e.emoji || "🙂";
              const key = customReactionKey(e.id);
              return (
                <button
                  key={e.id}
                  type="button"
                  title={glyph}
                  aria-label={glyph}
                  aria-pressed={selectedKey === key}
                  onClick={() => onPick(key, { key, emoji: glyph, custom })}
                  className={cn(cell(selectedKey === key), "text-foreground")}
                >
                  <CustomEmoji url={e.file_url} alt={glyph} repaint={e.repaint} className="w-[30px] h-[30px] object-contain" />
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
};

/** Одна реакция картинкой — для подсказок и настроек. */
export const ReactionGlyph = ({ pick, size = 22, className }: { pick: ReactionPick; size?: number; className?: string }) =>
  pick.custom
    ? <CustomEmoji url={pick.custom.url} alt={pick.emoji || ""} repaint={pick.custom.repaint} className={cn("object-contain", className)} style={{ width: size, height: size }} />
    : <NotoEmoji emoji={pick.emoji || pick.key} size={size} className={className} />;

export const ReactionPicker = ({ open, onPick, onClose }: {
  open: boolean;
  onPick: (key: string, pick?: ReactionPick) => void;
  onClose: () => void;
}) => {
  const navigate = useNavigate();
  const quick = useQuickReaction();
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[75] flex items-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="ui-card relative w-full max-h-[75vh] overflow-y-auto overscroll-contain rounded-t-[16px] bg-surface-2 p-4 pb-[calc(var(--sab)+20px)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-foreground/20" aria-hidden />
        {/* Какая реакция ставится двойным тапом — и где её поменять. Сверху:
            с несколькими наборами эмодзи до низа шторки долго листать. */}
        <button
          type="button"
          onClick={() => { onClose(); navigate("/profile/reactions"); }}
          className="mb-3 w-full flex items-center gap-2 rounded-lg bg-surface-3 px-3 py-2 text-small text-subtle active:opacity-70"
        >
          <span className="flex-1 min-w-0 text-left truncate">{t("Двойной тап ставит")}</span>
          <ReactionGlyph pick={quick} size={20} />
          <span className="text-primary shrink-0">{t("Изменить")}</span>
        </button>
        <ReactionGrid onPick={onPick} active={open} />
      </div>
    </div>
  );
};

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
export function applyReaction(list: ReactionSummary[] | undefined, key: string, pick?: ReactionPick): ReactionSummary[] {
  const rows = (list || []).map((r) => ({ ...r }));
  const found = rows.find((r) => reactionKey(r) === key);
  if (found?.mine) {
    found.count -= 1;
    found.mine = false;
    return rows.filter((r) => r.count > 0);
  }
  if (found) { found.count += 1; found.mine = true; return rows; }
  if (pick?.custom) return [...rows, { emoji: pick.emoji || "🙂", key, custom: pick.custom, count: 1, mine: true }];
  return [...rows, { emoji: key, count: 1, mine: true }];
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
