import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { MessageSquare } from "lucide-react";
import Identicon from "@/components/Identicon";
import { api } from "@/api/client";
import { Linkify, profileLinkName } from "@/lib/linkify";
import { readCache } from "@/lib/session-cache";

type Info = { id: string; username: string; avatar?: string | null; subtitle: string };

/**
 * Карточка профиля прямо в сообщении — так приходит «Поделиться профилем»:
 * аватар, ник, строка «О себе» и кнопка «Написать». Голая ссылка на
 * huyax.e-tree.su/u/<ник> ничего не говорила о человеке, пока по ней не тапнешь.
 * Тап по карточке открывает полный профиль, «Написать» — сразу переписку.
 */
const ProfileLinkCard = ({ url, own }: { url: string; own?: boolean }) => {
  const navigate = useNavigate();
  const username = profileLinkName(url);
  const [info, setInfo] = useState<Info | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!username) return;
    let alive = true;
    api.getProfileByUsername(username)
      .then((p) => alive && setInfo({
        id: p.id,
        username: p.username,
        avatar: p.avatar_url,
        subtitle: p.is_bot ? "Бот" : (p.bio || "").split("\n")[0] || "Профиль в WhoYaX",
      }))
      .catch(() => alive && setInfo(null));
    return () => { alive = false; };
  }, [username]);

  if (!username) return null;
  // Профиль не загрузился (удалён, сеть) — ссылку из текста мы уже убрали,
  // так что возвращаем её, иначе сообщение останется пустым.
  if (info === null) return <p className="text-body break-all"><Linkify text={url} /></p>;

  const me = readCache<{ id: string }>("user")?.id;
  const isMe = !!info && info.id === me;

  const write = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!info || busy) return;
    setBusy(true);
    try {
      let chatId: string;
      try {
        chatId = (await api.createDirectChat(info.id)).id;
      } catch (err: any) {
        if (err?.message === "exists" && err.chatId) chatId = err.chatId;
        else throw err;
      }
      // Chat.tsx ловит смену location и открывает этот чат, даже если мы уже на /chat.
      navigate("/chat", { state: { chatId, title: info.username } });
    } catch {
      toast.error("Не удалось открыть чат");
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); navigate(`/u/${encodeURIComponent(username)}`); }}
      className={`ui-card mt-1.5 w-full max-w-[260px] rounded-lg overflow-hidden text-left ${own ? "bg-black/15" : "bg-surface-2"}`}
    >
      <span className="px-2.5 py-2 flex items-center gap-2.5">
        <Identicon id={info?.id || username} avatarUrl={info?.avatar} className="w-10 h-10" />
        <span className="min-w-0 flex-1">
          <span className="block text-small font-medium truncate">{info ? info.username : username}</span>
          <span className="block text-caption opacity-70 truncate">{info ? info.subtitle : "Загрузка…"}</span>
        </span>
      </span>
      {info && (
        <span className="block px-2.5 pb-2">
          {isMe ? (
            <span className="h-8 w-full rounded-md bg-surface-4 text-caption font-medium flex items-center justify-center">
              Это вы
            </span>
          ) : (
            <span
              role="button"
              tabIndex={0}
              onClick={write}
              onKeyDown={(e) => { if (e.key === "Enter") write(e as unknown as React.MouseEvent); }}
              aria-disabled={busy}
              className="h-8 w-full rounded-md bg-primary text-primary-foreground text-caption font-semibold flex items-center justify-center gap-1.5 active:opacity-90"
            >
              <MessageSquare className="w-3.5 h-3.5" /> {busy ? "Открываю…" : "Написать"}
            </span>
          )}
        </span>
      )}
    </button>
  );
};

export default ProfileLinkCard;
