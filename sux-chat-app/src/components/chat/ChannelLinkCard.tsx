import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Radio, ArrowRight } from "lucide-react";
import { api, mediaUrl } from "@/api/client";
import { Linkify, channelLinkRef } from "@/lib/linkify";

type Info = { id: string; name: string; username?: string | null; avatar?: string | null; subs: number; subscribed: boolean };

const pluralSubs = (n: number) => {
  const m10 = n % 10, m100 = n % 100;
  const w = m10 === 1 && m100 !== 11 ? "подписчик" : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? "подписчика" : "подписчиков";
  return `${n} ${w}`;
};

/**
 * Карточка канала в сообщении — так приходит «Поделиться каналом» и
 * «Поделиться постом»: аватар, название, подписчики и кнопка. Как
 * ProfileLinkCard: голая ссылка huyax.e-tree.su/c/<канал> ни о чём не
 * говорила. Кнопка подписывает (если ещё нет) и открывает канал; со ссылкой
 * на пост (?post=) лента прокрутит к нему — id передаём через sessionStorage,
 * как PublicChannel.
 */
const ChannelLinkCard = ({ url, own }: { url: string; own?: boolean }) => {
  const navigate = useNavigate();
  const ref = channelLinkRef(url);
  const [info, setInfo] = useState<Info | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!ref) return;
    let alive = true;
    api.getChannelByHandle(ref.handle)
      .then((c) => alive && setInfo({
        id: c.id, name: c.name, username: c.username, avatar: c.avatar_url,
        subs: c.subscribers_count ?? 0, subscribed: !!c.my_role,
      }))
      .catch(() => alive && setInfo(null));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref?.handle]);

  if (!ref) return null;
  // Канал не загрузился (удалён, сеть) — ссылку из текста мы уже убрали,
  // так что возвращаем её, иначе сообщение останется пустым.
  if (info === null) return <p className="text-body break-all"><Linkify text={url} /></p>;

  const open = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!info || busy) return;
    setBusy(true);
    try {
      if (!info.subscribed) await api.subscribeChannel(info.id);
      if (ref.post) { try { sessionStorage.setItem("hyax:openPost", ref.post); } catch { /* приватный режим */ } }
      // Chat.tsx ловит смену location и открывает канал, даже если мы уже на /chat.
      navigate("/chat", { state: { chatId: info.id, kind: "channel", title: info.name } });
    } catch {
      toast.error("Не удалось открыть канал");
    } finally {
      setBusy(false);
    }
  };

  const label = busy ? "Открываю…" : ref.post ? "К посту" : info?.subscribed ? "Открыть" : "Подписаться";

  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); navigate(`/c/${encodeURIComponent(ref.handle)}${ref.post ? `?post=${encodeURIComponent(ref.post)}` : ""}`); }}
      className={`ui-card mt-1.5 w-full max-w-[260px] rounded-lg overflow-hidden text-left ${own ? "bg-black/15" : "bg-surface-2"}`}
    >
      <span className="px-2.5 py-2 flex items-center gap-2.5">
        <span className="w-10 h-10 rounded-md shrink-0 overflow-hidden bg-surface-4 flex items-center justify-center">
          {info?.avatar
            ? <img src={mediaUrl(info.avatar)} alt="" className="w-full h-full object-cover" />
            : <Radio className="w-5 h-5 text-primary" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-small font-medium truncate">{info ? info.name : `@${ref.handle}`}</span>
          <span className="block text-caption opacity-70 truncate">
            {info ? `${ref.post ? "Пост · " : ""}${pluralSubs(info.subs)}${info.username ? ` · @${info.username}` : ""}` : "Загрузка…"}
          </span>
        </span>
      </span>
      {info && (
        <span className="block px-2.5 pb-2">
          <span
            role="button"
            tabIndex={0}
            onClick={open}
            onKeyDown={(e) => { if (e.key === "Enter") open(e as unknown as React.MouseEvent); }}
            aria-disabled={busy}
            className="h-8 w-full rounded-md bg-primary text-primary-foreground text-caption font-semibold flex items-center justify-center gap-1.5 active:opacity-90"
          >
            <ArrowRight className="w-3.5 h-3.5" /> {label}
          </span>
        </span>
      )}
    </button>
  );
};

export default ChannelLinkCard;
