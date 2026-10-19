import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Check, Loader2, Users, X } from "lucide-react";
import { api, type PollInfo } from "@/api/client";
import Identicon from "@/components/Identicon";
import { t as tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Опрос в посте Стены (backend chat/polls.py). Вопрос — текст поста (его
 * рисует лента, вместе с переводом), здесь — варианты и итоги.
 *
 * Пока не голосовал — варианты кнопками; проголосовал — полосы с процентами
 * и галочкой у своего (автор видит их сразу и тоже может голосовать). Сменить
 * выбор — «Отменить голос» и снова. В открытом опросе тап по варианту после
 * голоса — кто его выбрал; в анонимном этого не узнает никто.
 */
const PollCard = ({ postId, question, poll, onChange, onOpenProfile }: {
  postId: string;
  question: ReactNode;
  poll: PollInfo;
  onChange: (poll: PollInfo) => void;
  onOpenProfile?: (id: string) => void;
}) => {
  const [busy, setBusy] = useState<string | null>(null);
  const [votersFor, setVotersFor] = useState<PollInfo["options"][number] | null>(null);
  const voted = poll.voted.length > 0;

  const run = async (key: string, call: () => Promise<{ poll: PollInfo }>) => {
    if (busy) return;
    setBusy(key);
    try { onChange((await call()).poll); }
    catch (e) { toast.error((e as Error)?.message || tr("Не удалось проголосовать")); }
    finally { setBusy(null); }
  };
  const tap = (o: PollInfo["options"][number]) => {
    if (!voted) void run(o.id, () => api.votePoll(postId, o.id));
    else if (!poll.anonymous) setVotersFor(o);
  };

  return (
    <div>
      <div className="text-body font-semibold">{question}</div>
      <p className="mt-0.5 text-caption text-subtle">{poll.anonymous ? tr("Анонимный опрос") : tr("Открытый опрос")}</p>
      <div className="mt-2 space-y-1.5">
        {poll.options.map((o) => {
          const mine = poll.voted.includes(o.id);
          const pct = poll.results && poll.total ? Math.round(((o.votes || 0) * 100) / poll.total) : 0;
          return (
            <button
              key={o.id}
              type="button"
              onClick={(e) => { e.stopPropagation(); tap(o); }}
              disabled={!!busy || (voted && poll.anonymous)}
              className={cn(
                "relative w-full min-h-10 rounded-lg overflow-hidden border text-left transition-opacity disabled:opacity-100",
                mine ? "border-primary/60" : "border-border",
                // До голоса — кнопки на подложке, чтобы было видно, что на них жмут.
                !poll.results && "bg-surface-2",
                !voted && "active:opacity-70",
              )}
            >
              {poll.results && (
                <span className={cn("absolute inset-y-0 left-0 transition-[width] duration-300", mine ? "bg-primary/25" : "bg-foreground/10")}
                  style={{ width: `${pct}%` }} aria-hidden />
              )}
              <span className="relative flex items-center gap-2 px-3 py-2">
                {poll.results && <span className="w-10 shrink-0 text-small font-semibold tabular-nums">{pct}%</span>}
                <span className="flex-1 text-body break-words">{o.text}</span>
                {busy === o.id ? <Loader2 className="w-4 h-4 shrink-0 animate-spin text-subtle" />
                  : mine ? <Check className="w-4 h-4 shrink-0 text-primary" /> : null}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex items-center gap-3 text-caption text-subtle">
        <span>{poll.total ? tr("Голосов: {n}", { n: poll.total }) : tr("Пока никто не голосовал")}</span>
        {voted && (
          <button type="button" disabled={!!busy} onClick={(e) => { e.stopPropagation(); void run("retract", () => api.unvotePoll(postId)); }}
            className="underline underline-offset-2 disabled:opacity-50">
            {tr("Отменить голос")}
          </button>
        )}
        {voted && !poll.anonymous && <span className="ml-auto flex items-center gap-1"><Users className="w-3.5 h-3.5" />{tr("Тап — кто выбрал")}</span>}
      </div>
      {votersFor && (
        <VotersSheet postId={postId} option={votersFor} onClose={() => setVotersFor(null)}
          onOpenProfile={onOpenProfile ? (id) => { setVotersFor(null); onOpenProfile(id); } : undefined} />
      )}
    </div>
  );
};

/** Кто выбрал вариант — только в открытом опросе. */
const VotersSheet = ({ postId, option, onClose, onOpenProfile }: {
  postId: string;
  option: PollInfo["options"][number];
  onClose: () => void;
  onOpenProfile?: (id: string) => void;
}) => {
  const [data, setData] = useState<{ count: number; voters: { id: string; username: string; avatar_url?: string | null }[] } | null>(null);
  useEffect(() => {
    let alive = true;
    api.pollVoters(postId, option.id).then((d) => { if (alive) setData(d); })
      .catch((e) => { if (alive) { toast.error((e as Error)?.message || tr("Не удалось загрузить")); onClose(); } });
    return () => { alive = false; };
  }, [postId, option.id]);

  return createPortal(
    <div className="fixed inset-0 z-[85] bg-black/60 flex items-end md:items-center md:justify-center" onClick={onClose}>
      <div className="ui-card w-full md:w-[420px] max-h-[70vh] bg-surface-2 rounded-t-[16px] md:rounded-lg flex flex-col pb-[var(--sab)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 h-14 shrink-0">
          <span className="text-h2 flex-1 truncate">{option.text}</span>
          {data && <span className="text-caption text-subtle shrink-0">{data.count}</span>}
          <button type="button" onClick={onClose} className="p-1.5 text-subtle" aria-label={tr("Закрыть")}><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-1.5">
          {!data ? <div className="py-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-subtle" /></div>
            : data.voters.length === 0 ? <p className="py-6 text-center text-small text-subtle">{tr("Этот вариант пока никто не выбрал")}</p>
            : data.voters.map((u) => (
              <button key={u.id} type="button" onClick={() => onOpenProfile?.(u.id)}
                className="w-full h-12 px-3 rounded-md flex items-center gap-3 text-left bg-surface-4 active:opacity-70">
                <Identicon id={u.id} avatarUrl={u.avatar_url} className="w-8 h-8" />
                <span className="flex-1 text-body truncate">{u.username}</span>
              </button>
            ))}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default PollCard;
