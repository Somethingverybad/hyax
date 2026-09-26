import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Eye, X } from "lucide-react";
import Identicon from "@/components/Identicon";
import { api } from "@/api/client";

type Data = Awaited<ReturnType<typeof api.messageViewers>>;

const fmt = (iso: string) => {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" }) + " " + d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
};

/**
 * «Просмотры и реакции» из меню сообщения: кто прочитал (со временем) и кто
 * какую реакцию поставил. Прочитавших со статусом «Скрыт» сервер не отдаёт —
 * просмотр у них не засчитывается; реакции видны у всех.
 */
const ViewersSheet = ({ messageId, onClose, onOpenProfile }: { messageId: string; onClose: () => void; onOpenProfile?: (id: string) => void }) => {
  const [data, setData] = useState<Data | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    api.messageViewers(messageId).then((d) => alive && setData(d)).catch(() => alive && setData(null));
    return () => { alive = false; };
  }, [messageId]);

  const Row = ({ id, username, avatar, right }: { id: string; username: string; avatar?: string | null; right: string }) => (
    <button
      type="button"
      onClick={() => { if (onOpenProfile) { onClose(); onOpenProfile(id); } }}
      className="w-full h-12 px-3 rounded-md flex items-center gap-3 text-left bg-surface-4 active:opacity-70"
    >
      <Identicon id={id} avatarUrl={avatar} className="w-8 h-8" />
      <span className="flex-1 text-body truncate">{username}</span>
      <span className="text-small text-subtle shrink-0">{right}</span>
    </button>
  );

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end md:items-center md:justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="ui-card relative w-full md:w-[420px] rounded-t-[16px] md:rounded-lg bg-surface-2 flex flex-col max-h-[75vh]" onClick={(e) => e.stopPropagation()}>
        <div className="shrink-0 px-4 pt-4 pb-2">
          <div className="md:hidden mx-auto mb-2 h-1 w-9 rounded-full bg-foreground/20" aria-hidden />
          <div className="flex items-center gap-2">
            <Eye className="w-5 h-5 text-primary" />
            <p className="text-h2 flex-1">Просмотры и реакции</p>
            <button type="button" onClick={onClose} className="p-1.5 text-subtle" aria-label="Закрыть"><X className="w-4 h-4" /></button>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-[calc(var(--sab)+16px)] md:pb-4 space-y-4">
          {data === undefined ? (
            <p className="text-small text-subtle">Загрузка…</p>
          ) : data === null ? (
            <p className="text-small text-subtle">Не удалось загрузить</p>
          ) : (
            <>
              <section className="space-y-1.5">
                <p className="text-caption text-subtle uppercase tracking-wide">Прочитали{data.read_by.length ? ` · ${data.read_by.length}` : ""}</p>
                {data.read_by.length === 0
                  ? <p className="text-small text-subtle">Пока никто. Тех, кто скрыл статус «в сети», здесь не будет.</p>
                  : data.read_by.map((r) => <Row key={r.id} id={r.id} username={r.username} avatar={r.avatar_url} right={fmt(r.read_at)} />)}
              </section>
              <section className="space-y-1.5">
                <p className="text-caption text-subtle uppercase tracking-wide">Реакции{data.reactions.length ? ` · ${data.reactions.reduce((n, g) => n + g.users.length, 0)}` : ""}</p>
                {data.reactions.length === 0
                  ? <p className="text-small text-subtle">Реакций нет</p>
                  : data.reactions.map((g) => (
                    <div key={g.emoji} className="space-y-1.5">
                      {g.users.map((u) => <Row key={g.emoji + u.id} id={u.id} username={u.username} avatar={u.avatar_url} right={g.emoji} />)}
                    </div>
                  ))}
              </section>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default ViewersSheet;
