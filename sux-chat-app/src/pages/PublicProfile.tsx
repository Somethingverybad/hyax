import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { MessageSquare, Share2, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import Identicon from "@/components/Identicon";
import { api } from "@/api/client";
import { shareProfile, PUBLIC_ORIGIN } from "@/lib/share";

/**
 * Карточка по ссылке «Поделиться профилем» — https://huyax.e-tree.su/u/<ник>.
 * Это единственный способ найти человека: поиска по людям в приложении нет.
 * В установленном приложении ссылка открывается здесь же (universal link),
 * в браузере — та же страница с кнопкой «Написать» и ссылкой на установку.
 * Без сессии уводим на вход и возвращаемся сюда через ?next=.
 */
type Card = { id: string; username: string; avatar_url?: string | null; bio?: string; is_bot?: boolean };

const PublicProfile = () => {
  const { username = "" } = useParams();
  const navigate = useNavigate();
  const [card, setCard] = useState<Card | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "missing" | "error">("loading");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem("access_token")) {
      navigate(`/auth?next=${encodeURIComponent(`/u/${username}`)}`, { replace: true });
      return;
    }
    let alive = true;
    (async () => {
      try {
        const [p, my] = await Promise.all([api.getProfileByUsername(username), api.getProfile().catch(() => null)]);
        if (!alive) return;
        setCard(p as Card);
        setMe(my?.id || null);
        setState("ok");
      } catch (e: any) {
        if (!alive) return;
        setState(e?.message === "not_found" ? "missing" : "error");
      }
    })();
    return () => { alive = false; };
  }, [username, navigate]);

  const write = async () => {
    if (!card || busy) return;
    setBusy(true);
    try {
      let chatId: string;
      try {
        chatId = (await api.createDirectChat(card.id)).id;
      } catch (e: any) {
        if (e?.message === "exists" && e.chatId) chatId = e.chatId;
        else throw e;
      }
      navigate("/chat", { replace: true, state: { chatId } });
    } catch {
      toast.error("Не удалось открыть чат");
      setBusy(false);
    }
  };

  const share = async () => {
    if (!card) return;
    const r = await shareProfile(card.username);
    if (r === "copied") toast.success("Ссылка скопирована");
    else if (r === "error") toast.error("Не удалось поделиться");
  };

  const isMe = !!card && !!me && card.id === me;

  return (
    <div className="h-full bg-background text-foreground flex flex-col">
      <div className="pad-safe-top px-3 py-2 flex items-center gap-2">
        <button type="button" onClick={() => navigate("/chat", { replace: true })} className="w-10 h-10 rounded-md flex items-center justify-center bg-surface-2" aria-label="К чатам">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <span className="text-body font-semibold">Профиль</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8">
        {state === "loading" && <div className="mt-16 text-center text-subtle text-small">Загрузка…</div>}
        {state === "missing" && (
          <div className="mt-16 text-center space-y-2">
            <p className="text-body font-semibold">Такого пользователя нет</p>
            <p className="text-small text-subtle">Ссылка устарела или ник изменился.</p>
          </div>
        )}
        {state === "error" && <div className="mt-16 text-center text-small text-subtle">Не удалось загрузить профиль.</div>}

        {state === "ok" && card && (
          <div className="mt-6 flex flex-col items-center text-center">
            <Identicon id={card.id} avatarUrl={card.avatar_url || null} className="w-28 h-28" />
            <p className="mt-4 text-[24px] leading-tight font-semibold break-all">{card.username}</p>
            {card.is_bot && <span className="mt-1 text-caption text-subtle uppercase tracking-wide">бот</span>}
            {card.bio && <p className="mt-3 text-small text-muted-foreground whitespace-pre-wrap break-words max-w-sm">{card.bio}</p>}

            <div className="mt-8 w-full max-w-sm space-y-2">
              {isMe ? (
                <button type="button" onClick={share} className="w-full h-11 rounded-md bg-surface-4 text-foreground text-body font-medium flex items-center justify-center gap-2 active:opacity-90">
                  <Share2 className="w-4 h-4" /> Поделиться профилем
                </button>
              ) : (
                <button type="button" onClick={write} disabled={busy} className="w-full h-11 rounded-md bg-primary text-primary-foreground text-body font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
                  <MessageSquare className="w-4 h-4" /> {busy ? "Открываю…" : "Написать"}
                </button>
              )}
              {isMe && <p className="text-caption text-subtle">Это ваш профиль — так его увидят те, кому вы отправите ссылку.</p>}
            </div>

            {!Capacitor.isNativePlatform() && (
              <p className="mt-10 text-caption text-subtle">
                Удобнее в приложении —{" "}
                <a href={`${PUBLIC_ORIGIN}/apk/`} className="underline text-foreground">скачать ХУЯКС</a>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default PublicProfile;
