import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ThumbsUp, ThumbsDown, Check, Undo2, Trash2, Sparkles, Send } from "lucide-react";
import { toast } from "sonner";
import ScreenHeader from "@/components/ScreenHeader";
import { api, type IdeaItem } from "@/api/client";
import { cn } from "@/lib/utils";

/**
 * Профиль → Долгий ящик. Идеи всех людей (без имён авторов): топ, «Бездна» —
 * все от новых к старым, реализованные и свои. Голос за чужую идею — один,
 * +5 к вайбометру; лайк приносит автору +10. Админ отмечает «Реализовано»
 * и убирает мусор. Сервер — chat/ideabox.py. Чат с ботом «Долгий ящик» — для
 * старых версий приложения.
 */
type Tab = "top" | "new" | "done" | "mine";
const TABS: { id: Tab; label: string }[] = [
  { id: "top", label: "Топ" },
  { id: "new", label: "Бездна" },
  { id: "done", label: "Реализовано" },
  { id: "mine", label: "Мои" },
];
const EMPTY: Record<Tab, string> = {
  top: "Открытых идей пока нет — предложите первую.",
  new: "В бездне пусто.",
  done: "Пока ничего не реализовано.",
  mine: "Вы ещё не предлагали идей.",
};
const PAGE = 20;
const dateFmt = (s: string) => new Date(s).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });

export default function ProfileIdeas() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.id === params.get("tab")) ? params.get("tab") : "top") as Tab;
  const [items, setItems] = useState<IdeaItem[] | null>(null);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [count, setCount] = useState(0);
  const [admin, setAdmin] = useState(false);
  const [vibe, setVibe] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const reqRef = useRef(0);

  const load = useCallback(async (t: Tab, p: number) => {
    const req = ++reqRef.current;
    setLoading(true);
    try {
      const d = await api.getIdeas(t, p, PAGE);
      if (req !== reqRef.current) return;
      setItems((prev) => (p === 1 || !prev ? d.items : [...prev, ...d.items.filter((i) => !prev.some((x) => x.id === i.id))]));
      setPage(d.page); setPages(d.pages); setCount(d.count); setAdmin(d.is_admin); setVibe(d.my_vibe);
    } catch {
      if (req === reqRef.current) toast.error("Не удалось загрузить идеи");
    } finally {
      if (req === reqRef.current) setLoading(false);
    }
  }, []);
  useEffect(() => { setItems(null); void load(tab, 1); }, [tab, load]);

  const patch = (idea: IdeaItem) => setItems((prev) => prev && prev.map((i) => (i.id === idea.id ? idea : i)));

  const vote = async (idea: IdeaItem, value: 1 | -1) => {
    if (busyId || idea.mine || idea.my_vote) return;
    setBusyId(idea.id);
    patch({ ...idea, my_vote: value, likes: idea.likes + (value > 0 ? 1 : 0), dislikes: idea.dislikes + (value < 0 ? 1 : 0) });
    try {
      const r = await api.ideaAction(idea.id, "vote", value);
      if (r.idea) patch(r.idea);
      if (typeof r.my_vibe === "number") setVibe(r.my_vibe);
      toast.success("+5 к вайбометру");
    } catch (e: any) {
      patch(idea);
      toast.error(e?.message || "Не получилось");
    } finally { setBusyId(null); }
  };

  const adminAct = async (idea: IdeaItem, act: "done" | "hide") => {
    if (busyId) return;
    setBusyId(idea.id);
    try {
      const r = await api.ideaAction(idea.id, act);
      if (act === "hide" || (tab === "top" && r.idea?.status === "done") || (tab === "done" && r.idea?.status !== "done")) {
        setItems((prev) => prev && prev.filter((i) => i.id !== idea.id));
        setCount((c) => Math.max(0, c - 1));
      } else if (r.idea) patch(r.idea);
      toast.success(act === "hide" ? "Идея убрана" : r.idea?.status === "done" ? "Отмечено: реализовано" : "Отметка снята");
    } catch (e: any) {
      toast.error(e?.message || "Не получилось");
    } finally { setBusyId(null); }
  };

  const submit = async () => {
    const text = draft.trim();
    if (sending || text.length < 3) return;
    setSending(true);
    try {
      await api.createIdea(text);
      setDraft("");
      toast.success("Идея в ящике — спасибо!");
      if (tab === "new" || tab === "mine") void load(tab, 1);
      else setParams({ tab: "mine" }, { replace: true });
    } catch (e: any) {
      toast.error(e?.message || "Не удалось отправить");
    } finally { setSending(false); }
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      <ScreenHeader
        title="Долгий ящик"
        right={vibe !== null ? (
          <span className="shrink-0 min-w-10 h-10 px-1 inline-flex items-center justify-end gap-1 text-small text-subtle tabular-nums" title="Ваш вайбометр">
            <Sparkles className="w-4 h-4 text-primary" />{vibe}
          </span>
        ) : undefined}
      />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-xl mx-auto px-4 py-4 space-y-3">
          <section className="ui-card rounded-lg bg-surface-2 border border-border p-4">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, 4000))}
              rows={3}
              placeholder="Что добавить, что поменять, что бесит?"
              className="w-full resize-none bg-background border border-border rounded-md px-3 py-2.5 text-body focus:outline-none focus:border-amber placeholder:text-muted-foreground"
            />
            <p className="mt-2 text-caption text-subtle leading-snug">
              Идею увидят все — без вашего имени. Голос за чужую идею: +5 к вайбометру, лайк вашей: +10 вам.
            </p>
            <div className="mt-2 flex justify-end">
              <button type="button" onClick={submit} disabled={sending || draft.trim().length < 3}
                className="shrink-0 h-10 px-4 rounded-md bg-primary text-primary-foreground text-small font-medium flex items-center gap-2 active:opacity-90 disabled:opacity-50">
                <Send className="w-4 h-4" />{sending ? "Отправляю…" : "Предложить"}
              </button>
            </div>
          </section>

          <div className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist">
              {TABS.map((t) => (
                <button key={t.id} type="button" role="tab" aria-selected={tab === t.id}
                  onClick={() => setParams({ tab: t.id }, { replace: true })}
                  className={cn("shrink-0 h-9 px-3 rounded-full text-small font-medium border",
                    tab === t.id ? "bg-primary text-primary-foreground border-primary" : "border-border text-foreground active:bg-surface-3")}>
                  {t.label}
                </button>
              ))}
          </div>

          {items === null ? (
            <p className="py-10 text-center text-small text-subtle">Загружаю…</p>
          ) : items.length === 0 ? (
            <p className="py-10 text-center text-small text-subtle">{EMPTY[tab]}</p>
          ) : (
            <ul className="space-y-2">
              {items.map((idea, i) => (
                <li key={idea.id} className="ui-card rounded-lg bg-surface-2 border border-border p-3.5">
                  <div className="flex items-start gap-3">
                    {tab === "top" && <span className="shrink-0 w-6 text-h2 text-subtle tabular-nums">{i + 1}</span>}
                    <div className="min-w-0 flex-1">
                      <p className="text-body whitespace-pre-wrap break-words">{idea.text}</p>
                      <p className="mt-1.5 text-caption text-subtle flex flex-wrap gap-x-2">
                        <span>{dateFmt(idea.created_at)}</span>
                        {idea.status === "done" && <span className="text-online">✓ реализовано{idea.done_at ? ` ${dateFmt(idea.done_at)}` : ""}</span>}
                        {idea.mine && <span>ваша идея</span>}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    <VoteBtn up count={idea.likes} chosen={idea.my_vote > 0} disabled={idea.mine || !!idea.my_vote || busyId === idea.id} onClick={() => vote(idea, 1)} />
                    <VoteBtn count={idea.dislikes} chosen={idea.my_vote < 0} disabled={idea.mine || !!idea.my_vote || busyId === idea.id} onClick={() => vote(idea, -1)} />
                    {admin && (
                      <span className="ml-auto flex gap-2">
                        <button type="button" onClick={() => adminAct(idea, "done")} disabled={busyId === idea.id}
                          className="h-9 px-3 rounded-md bg-surface-4 text-small font-medium flex items-center gap-1.5 active:opacity-80 disabled:opacity-50">
                          {idea.status === "done" ? <><Undo2 className="w-4 h-4" />Снять</> : <><Check className="w-4 h-4" />Реализовано</>}
                        </button>
                        <button type="button" onClick={() => adminAct(idea, "hide")} disabled={busyId === idea.id} aria-label="Убрать идею"
                          className="h-9 w-9 rounded-md bg-surface-4 text-destructive flex items-center justify-center active:opacity-80 disabled:opacity-50">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {items && page < pages && (
            <button type="button" onClick={() => load(tab, page + 1)} disabled={loading}
              className="w-full h-11 rounded-md border border-border text-small font-medium active:bg-surface-3 disabled:opacity-50">
              {loading ? "Загружаю…" : `Показать ещё (${count - items.length})`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function VoteBtn({ up, count, chosen, disabled, onClick }: { up?: boolean; count: number; chosen: boolean; disabled: boolean; onClick: () => void }) {
  const Icon = up ? ThumbsUp : ThumbsDown;
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={chosen} aria-label={up ? "Нравится" : "Не нравится"}
      className={cn("h-9 px-3 rounded-md border text-small font-medium tabular-nums flex items-center gap-1.5 active:opacity-80",
        chosen ? "bg-primary text-primary-foreground border-primary" : "border-border text-foreground",
        disabled && !chosen && "opacity-60")}>
      <Icon className="w-4 h-4" />{count}
    </button>
  );
}
