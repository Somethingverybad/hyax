import { useEffect, useRef, useState } from "react";
import { Mic, Search as SearchIcon, X } from "lucide-react";
import Identicon from "@/components/Identicon";
import { api, type MessageHit } from "@/api/client";
import { getLang, t } from "@/lib/i18n";


/**
 * Результаты поиска по сообщениям (сервер: MessageSearchView). Используется
 * в поиске списка чатов (по всем чатам, с названием чата) и внутри чата
 * (ChatSearchPanel — только этот чат). Совпадение в тексте подсвечено.
 */
const when = (iso: string) => {
  const d = new Date(iso);
  const lang = getLang();
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : lang === "ko" ? "ko-KR" : "en-GB",
    sameDay ? { hour: "2-digit", minute: "2-digit" }
      : { day: "numeric", month: "short", ...(d.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }) }).format(d);
};

/** Текст с подсветкой запроса (без учёта регистра). */
export function Highlight({ text, q }: { text: string; q: string }) {
  const needle = q.trim().toLowerCase();
  if (!needle) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let i = 0;
  const lower = text.toLowerCase();
  for (;;) {
    const j = lower.indexOf(needle, i);
    if (j < 0) { parts.push(text.slice(i)); break; }
    if (j > i) parts.push(text.slice(i, j));
    parts.push(<mark key={j} className="bg-amber/30 text-foreground rounded-[3px] px-px">{text.slice(j, j + needle.length)}</mark>);
    i = j + needle.length;
  }
  return <>{parts}</>;
}

export function MessageHits({ hits, q, showChat, onPick, hasMore, onMore, loading }: {
  hits: MessageHit[]; q: string; showChat: boolean; onPick: (h: MessageHit) => void;
  hasMore?: boolean; onMore?: () => void; loading?: boolean;
}) {
  return (
    <div>
      {hits.map((h) => {
        const title = showChat ? (h.chat.kind === "saved" ? t("Избранное") : h.chat.kind === "wall" ? t("Стена") : h.chat.title || t("Чат")) : h.sender?.username || "";
        const sub = showChat && h.sender && (h.chat.is_group || h.chat.kind === "channel" || h.chat.kind === "wall") ? h.sender.username : null;
        const avatarId = showChat ? (h.chat.peer_id || h.chat.id) : (h.sender?.id || h.chat.id);
        const avatarUrl = showChat ? h.chat.avatar_url : h.sender?.avatar_url;
        return (
          <button key={h.id} type="button" onClick={() => onPick(h)}
            className="w-full flex items-start gap-3 py-2 text-left rounded-md hover:bg-surface-2 active:bg-surface-3">
            <Identicon id={avatarId} avatarUrl={avatarUrl} className="w-[46px] h-[46px] md:w-9 md:h-9 shrink-0 mt-0.5" />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span className="text-h2 md:text-[15px] truncate flex-1">{title}{sub ? <span className="text-subtle font-normal"> · {sub}</span> : null}</span>
                <span className="text-caption text-subtle shrink-0 tabular-nums">{when(h.created_at)}</span>
              </span>
              <span className="block text-small text-subtle line-clamp-2 break-words">
                {h.transcript && <Mic className="inline w-3.5 h-3.5 mr-1 -mt-0.5 opacity-70" aria-label={t("Расшифровка голосового")} />}
                <Highlight text={h.text} q={q} />
              </span>
            </span>
          </button>
        );
      })}
      {hasMore && onMore && (
        <button type="button" onClick={onMore} disabled={loading} className="w-full py-2 text-small text-primary text-left disabled:opacity-50">
          {loading ? t("Загрузка…") : t("Показать ещё")}
        </button>
      )}
    </div>
  );
}

/** Поиск, который сам ходит на сервер: запрос с задержкой, «ещё» — курсором. */
export function useMessageSearch(q: string, chatId?: string) {
  const [hits, setHits] = useState<MessageHit[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const query = q.trim();
  useEffect(() => {
    const my = ++seq.current;
    if (query.length < 2) { setHits([]); setHasMore(false); setLoading(false); return; }
    setLoading(true);
    const timer = setTimeout(() => {
      api.searchMessages(query, { chat: chatId }).then((r) => {
        if (my !== seq.current) return;
        setHits(r.items); setHasMore(r.has_more); setLoading(false);
      }).catch(() => { if (my === seq.current) { setHits([]); setHasMore(false); setLoading(false); } });
    }, 350);
    return () => clearTimeout(timer);
  }, [query, chatId]);
  const more = () => {
    const last = hits[hits.length - 1];
    if (!last || loading) return;
    setLoading(true);
    const my = seq.current;
    api.searchMessages(query, { chat: chatId, before: last.created_at }).then((r) => {
      if (my !== seq.current) return;
      setHits((prev) => [...prev, ...r.items.filter((x) => !prev.some((p) => p.id === x.id))]); setHasMore(r.has_more); setLoading(false);
    }).catch(() => { if (my === seq.current) setLoading(false); });
  };
  return { hits, hasMore, loading, more, active: query.length >= 2 };
}

/** Поиск внутри чата: поле сверху, результаты списком; тап — к сообщению. */
export function ChatSearchPanel({ chatId, onPick, onClose }: { chatId: string; onPick: (messageId: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const s = useMessageSearch(q, chatId);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[60] bg-background flex flex-col">
      <div className="pad-safe-top px-3 py-2 flex items-center gap-2 border-b border-border">
        <label className="flex-1 flex items-center gap-2 h-11 md:h-9 px-3 rounded-md bg-surface-1 text-subtle focus-within:ring-1 focus-within:ring-amber">
          <SearchIcon className="w-5 h-5 md:w-4 md:h-4 shrink-0" />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Искать в чате…")}
            className="flex-1 min-w-0 bg-transparent outline-none text-body text-foreground" />
          {q && <button type="button" onClick={() => setQ("")} className="p-1 text-subtle" aria-label={t("Очистить")}><X className="w-4 h-4" /></button>}
        </label>
        <button type="button" onClick={onClose} className="h-11 md:h-9 px-3 rounded-md text-small text-primary font-medium">{t("Отмена")}</button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-2">
        {!s.active && <p className="py-10 text-center text-small text-subtle">{t("Введите хотя бы две буквы")}</p>}
        {s.active && !s.loading && !s.hits.length && <p className="py-10 text-center text-small text-subtle">{t("Ничего не найдено")}</p>}
        {s.active && s.loading && !s.hits.length && <p className="py-10 text-center text-small text-subtle">{t("Ищу…")}</p>}
        <MessageHits hits={s.hits} q={q} showChat={false} onPick={(h) => onPick(h.id)} hasMore={s.hasMore} onMore={s.more} loading={s.loading} />
      </div>
    </div>
  );
}

export default MessageHits;
