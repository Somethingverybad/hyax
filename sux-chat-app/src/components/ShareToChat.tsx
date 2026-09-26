import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Bookmark, Share2, Users, Radio } from "lucide-react";
import Identicon from "@/components/Identicon";
import { api } from "@/api/client";
import { readCache } from "@/lib/session-cache";

/**
 * «Отправить в чат» — шторка со списком переписок.
 *
 * Нужна там, где раньше было только системное «Поделиться»: оно уводит из
 * приложения, и переслать профиль знакомому внутри хуякса было нельзя.
 * Системный способ — большой кнопкой, закреплённой внизу шторки: список
 * чатов может быть длинным, а выход наружу нужен не реже.
 *
 * Каналы по умолчанию не показываем: писать в них может только владелец, а
 * пересылка ссылки в канал — не то, чего ждут от «поделиться профилем».
 * Пересылка сообщений (includeChannels) их показывает — своим каналом
 * делятся постами из переписки.
 */
type Row = { id: string; title: string; kind: "saved" | "group" | "direct" | "channel"; peerId?: string; avatar?: string | null };

const toRows = (chats: any[], me?: string, includeChannels?: boolean, excludeChatId?: string): Row[] => chats
  .filter((c) => (includeChannels || c.kind !== "channel") && c.id !== excludeChatId)
  .map((c): Row => {
    if (c.kind === "saved") return { id: c.id, title: "Избранное", kind: "saved" };
    if (c.kind === "channel") return { id: c.id, title: c.name || "Канал", kind: "channel", avatar: c.avatar_url };
    if (c.is_group) return { id: c.id, title: c.name || "Группа", kind: "group", avatar: c.avatar_url };
    const peer = (c.participants || []).find((p: any) => p.id !== me);
    return { id: c.id, title: peer?.username || c.name || "Чат", kind: "direct", peerId: peer?.id, avatar: peer?.avatar_url };
  })
  // «Избранное» — первой строкой, как в пересылке сообщений.
  .sort((a, b) => Number(b.kind === "saved") - Number(a.kind === "saved"));

const ShareToChat = ({ open, text, title, onClose, onShareOutside, onPick, includeChannels, excludeChatId }: {
  open: boolean;
  /** Что отправляем: обычно ссылка. */
  text: string;
  /** Подпись в шапке шторки. */
  title: string;
  onClose: () => void;
  /** Системное «Поделиться» — если его стоит предложить. */
  onShareOutside?: () => void;
  /** Только выбрать чат — отправкой займётся вызывающий (вложения из «Поделиться»). */
  onPick?: (chatId: string, title: string) => void;
  /** Показывать и каналы (пересылка сообщений). */
  includeChannels?: boolean;
  /** Не показывать этот чат (откуда пересылаем). */
  excludeChatId?: string;
}) => {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || rows) return;
    api.getChats()
      .then((chats) => setRows(toRows(chats, readCache<{ id: string }>("user")?.id, includeChannels, excludeChatId)))
      .catch(() => setRows([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rows]);

  useEffect(() => { if (!open) setQuery(""); }, [open]);

  if (!open) return null;

  const send = async (row: Row) => {
    if (onPick) { onPick(row.id, row.title); onClose(); return; }
    if (busy || !text) return;
    setBusy(true);
    try {
      await api.sendMessage(row.id, text);
      toast.success(row.kind === "saved" ? "Добавлено в избранное" : `Отправлено: ${row.title}`);
      onClose();
    } catch (e: any) {
      toast.error(e?.message || "Не удалось отправить");
    } finally { setBusy(false); }
  };

  const q = query.trim().toLowerCase();
  const shown = (rows || []).filter((r) => !q || r.title.toLowerCase().includes(q));

  // Шторка обычно открывается поверх другой (карточка профиля), а React
  // всплывает клики по дереву компонентов, а не по DOM: без stopPropagation
  // тап мимо закрыл бы заодно и то, что под ней.
  return (
    <div
      className="fixed inset-0 z-[80] bg-black/40 flex items-end md:items-center md:justify-center"
      onClick={(e) => { e.stopPropagation(); onClose(); }}
    >
      <div
        className="ui-card relative w-full md:w-[420px] rounded-t-[16px] md:rounded-lg bg-surface-2 max-h-[75vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 px-4 pt-4 pb-2 space-y-2">
          <div className="md:hidden mx-auto h-1 w-9 rounded-full bg-foreground/20" aria-hidden />
          <p className="text-h2">{title}</p>

          {rows && rows.length > 6 && (
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск по чатам"
              className="w-full h-10 px-3 rounded-md bg-surface-4 text-body outline-none"
            />
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-2 space-y-2">
          {rows === null ? (
            <p className="text-small text-subtle">Загрузка…</p>
          ) : rows.length === 0 ? (
            <p className="text-small text-subtle">Пока некуда отправлять — нет переписок.</p>
          ) : shown.length === 0 ? (
            <p className="text-small text-subtle">Ничего не нашлось</p>
          ) : shown.map((r) => (
            <button
              key={r.id}
              type="button"
              disabled={busy}
              onClick={() => void send(r)}
              className="w-full min-h-12 px-3 rounded-md flex items-center gap-3 text-left bg-surface-4 active:opacity-70 disabled:opacity-50"
            >
              {r.kind === "saved" ? (
                <span className="w-8 h-8 rounded-md shrink-0 bg-primary flex items-center justify-center">
                  <Bookmark className="w-4 h-4 text-primary-foreground" />
                </span>
              ) : r.kind === "channel" && !r.avatar ? (
                <span className="w-8 h-8 rounded-md shrink-0 bg-surface-3 flex items-center justify-center">
                  <Radio className="w-4 h-4 text-primary" />
                </span>
              ) : r.kind === "group" && !r.avatar ? (
                <span className="w-8 h-8 rounded-md shrink-0 bg-surface-3 flex items-center justify-center">
                  <Users className="w-4 h-4 text-primary" />
                </span>
              ) : (
                <Identicon id={r.peerId || r.id} avatarUrl={r.avatar} className="w-8 h-8" />
              )}
              <span className="flex-1 text-body truncate">{r.title}</span>
            </button>
          ))}
        </div>

        {onShareOutside && (
          <div className="shrink-0 px-4 pt-2 pb-[calc(var(--sab)+16px)] md:pb-4">
            <button
              type="button"
              onClick={() => { onClose(); onShareOutside(); }}
              className="w-full h-12 rounded-md bg-primary text-primary-foreground text-body font-semibold flex items-center justify-center gap-2 active:opacity-90"
            >
              <Share2 className="w-5 h-5" />
              Поделиться за пределами WhoYaX
            </button>
          </div>
        )}
        {!onShareOutside && <div className="shrink-0 h-[calc(var(--sab)+16px)] md:h-4" aria-hidden />}
      </div>
    </div>
  );
};

export default ShareToChat;
