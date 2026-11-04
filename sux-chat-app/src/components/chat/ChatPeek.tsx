import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "@/api/client";
import { readMessages } from "@/lib/messageCache";
import { t as tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Сколько последних сообщений показывает мини-окно. */
const PEEK_COUNT = 30;

type PeekMessage = {
  id: string;
  sender?: { id?: string; username?: string } | null;
  content?: string | null;
  cipher?: string | null;
  created_at?: string;
  file_url?: string | null;
  file_name?: string | null;
  file_preview?: string | null;
  voice_url?: string | null;
  video_url?: string | null;
  sticker?: unknown;
  geo_lat?: number | null;
  poll?: unknown;
  action?: { emoji?: string } | null;
};

const isImage = (m: PeekMessage) => !!m.file_url && /\.(jpe?g|png|gif|webp|heic|avif)$/i.test(m.file_name || m.file_url || "");

/** Подпись вместо того, что в мини-окне не показываем целиком. */
function label(m: PeekMessage): string {
  const text = (m.content || "").trim();
  if (text) return text;
  if (m.cipher) return `🔒 ${tr("Зашифрованное сообщение")}`;
  if (m.video_url) return `▲ ${tr("Видео-сообщение")}`;
  if (m.voice_url) return `🎤 ${tr("Голосовое сообщение")}`;
  if (m.sticker) return tr("Стикер");
  if (m.geo_lat != null) return `📍 ${tr("Геопозиция")}`;
  if (m.poll) return `📊 ${tr("Опрос")}`;
  if (m.action?.emoji) return m.action.emoji;
  if (isImage(m)) return "";
  if (m.file_url) return `📎 ${m.file_name || tr("Файл")}`;
  return tr("Сообщение");
}

const time = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

/**
 * Мини-окно переписки по удержанию строки чата (ChatRowMenu): последние
 * сообщения, как в Telegram. Сначала из кэша ленты (мгновенно), потом
 * свежие с сервера. Только смотрит: прочитанным ничего не отмечает (sync
 * без since — обычная страница ленты, отметку ставит mark_chat_as_read).
 */
const ChatPeek = ({ chatId, myId, group }: { chatId: string; myId: string; group: boolean }) => {
  const [msgs, setMsgs] = useState<PeekMessage[] | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const cached = await readMessages(chatId).catch(() => null);
      if (!alive) return;
      if (cached?.messages?.length) setMsgs((cached.messages as PeekMessage[]).slice(-PEEK_COUNT));
      try {
        const r = await api.syncMessages(chatId, { limit: PEEK_COUNT });
        if (alive) setMsgs(r.messages as PeekMessage[]);
      } catch {
        if (alive && !cached?.messages?.length) setMsgs([]);
      }
    })();
    return () => { alive = false; };
  }, [chatId]);
  // Внизу — последние, как в самой переписке.
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  if (msgs === null) return <div className="h-full" />;
  if (!msgs.length) {
    return <div className="h-full flex items-center justify-center text-small text-subtle">{tr("Сообщений пока нет")}</div>;
  }
  return (
    // Верхний пузырь срезан краем окна — край растворяется, а не режет.
    <div ref={boxRef} className="h-full overflow-hidden px-3 py-2 flex flex-col gap-1"
      style={{ maskImage: "linear-gradient(to bottom, transparent, #000 28px)", WebkitMaskImage: "linear-gradient(to bottom, transparent, #000 28px)" }}>
      <div className="mt-auto" />
      {msgs.map((m, i) => {
        const own = String(m.sender?.id ?? "") === String(myId);
        const prev = msgs[i - 1];
        const showName = group && !own && String(prev?.sender?.id ?? "") !== String(m.sender?.id ?? "");
        const text = label(m);
        return (
          <div key={m.id} className={cn("flex", own ? "justify-end" : "justify-start")}>
            <div className={cn("msg-bubble max-w-[80%] px-3 pt-1.5 pb-[5px] text-body", own ? "msg-own" : "msg-peer")}>
              {showName && <div className="text-caption font-semibold text-primary truncate">{m.sender?.username}</div>}
              {isImage(m) && m.file_preview && (
                <img src={m.file_preview} alt="" className="mb-1 rounded-lg w-40 max-w-full h-24 object-cover" />
              )}
              {text && <span className="whitespace-pre-wrap break-words line-clamp-4">{text}</span>}
              <span className="ml-2 align-bottom text-[11px] opacity-60">{time(m.created_at)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default ChatPeek;
