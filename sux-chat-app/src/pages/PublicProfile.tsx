import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { MessageSquare, Share2, ArrowLeft, Copy, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import Identicon from "@/components/Identicon";
import SavedGallery, { SavedTile, pluralPhotos } from "@/components/SavedGallery";
import { api, type SavedImage } from "@/api/client";
import { shareProfile, PUBLIC_ORIGIN } from "@/lib/share";

/**
 * Карточка по ссылке «Поделиться профилем» — https://huyax.e-tree.su/u/<ник>.
 * Это единственный способ найти человека: поиска по людям в приложении нет.
 * Показывает то же, что UserProfileModal из чата: аватар, ник, статус (первая
 * строка bio), «О себе», сохранёнки и информацию. В установленном
 * приложении ссылка открывается здесь же (universal link), в браузере — та
 * же страница плюс ссылка на установку. Без сессии уводим на вход и
 * возвращаемся сюда через ?next=.
 */
type Card = { id: string; username: string; avatar_url?: string | null; bio?: string | null; is_bot?: boolean; created_at?: string | null };

const PublicProfile = () => {
  const { username = "" } = useParams();
  const navigate = useNavigate();
  const [card, setCard] = useState<Card | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "missing" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<{ count: number; items: SavedImage[] } | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);

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
        api.listSavedImages(p.id, 5).then((d) => alive && setSaved(d)).catch(() => alive && setSaved({ count: 0, items: [] }));
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

  const copy = async (value: string) => {
    try { await navigator.clipboard.writeText(value); toast.success("Скопировано"); }
    catch { toast.error("Не удалось скопировать"); }
  };

  const isMe = !!card && !!me && card.id === me;

  return (
    <div className="h-full bg-background text-foreground flex flex-col">
      <div className="pad-safe-top px-3 py-2 flex items-center gap-2 shrink-0">
        <button type="button" onClick={() => navigate("/chat", { replace: true })} className="w-10 h-10 rounded-md flex items-center justify-center bg-surface-2" aria-label="К чатам">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <span className="text-body font-semibold">Профиль</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-[calc(var(--sab)+32px)]">
        {state === "loading" && <div className="mt-16 text-center text-subtle text-small">Загрузка…</div>}
        {state === "missing" && (
          <div className="mt-16 text-center space-y-2">
            <p className="text-body font-semibold">Такого пользователя нет</p>
            <p className="text-small text-subtle">Ссылка устарела или ник изменился.</p>
          </div>
        )}
        {state === "error" && <div className="mt-16 text-center text-small text-subtle">Не удалось загрузить профиль.</div>}

        {state === "ok" && card && (
          <div className="mt-4 space-y-5 max-w-md mx-auto">
            <div className="flex items-center gap-5">
              <Identicon id={card.id} avatarUrl={card.avatar_url || null} className="w-[104px] h-[104px] rounded-lg shrink-0" />
              <div className="min-w-0">
                <h2 className="text-[24px] leading-tight font-semibold truncate">{card.username}</h2>
                <p className="mt-2 text-body text-subtle truncate">{card.bio ? card.bio.split("\n")[0] : "Статус не указан"}</p>
                {card.is_bot && <span className="mt-1 inline-block text-caption text-subtle uppercase tracking-wide">бот</span>}
              </div>
            </div>

            <div className="flex gap-3">
              {!isMe && (
                <button type="button" onClick={write} disabled={busy} className="flex-1 h-10 rounded-md bg-primary text-primary-foreground font-medium flex items-center justify-center gap-2 active:opacity-90 disabled:opacity-50">
                  <MessageSquare className="w-4 h-4" /> {busy ? "Открываю…" : "Написать"}
                </button>
              )}
              <button type="button" onClick={share} className="flex-1 h-10 rounded-md bg-surface-4 text-foreground font-medium flex items-center justify-center gap-2 active:opacity-90">
                <Share2 className="w-4 h-4" /> Поделиться
              </button>
            </div>
            {isMe && <p className="text-caption text-subtle -mt-2">Это ваш профиль — так его увидят те, кому вы отправите ссылку.</p>}

            <div className="border-t border-border" />

            {card.bio && (
              <div className="rounded-lg bg-surface-4 p-4">
                <p className="text-h2 mb-2">О себе</p>
                <p className="text-body text-muted-foreground whitespace-pre-wrap break-words">{card.bio}</p>
              </div>
            )}

            {saved && saved.count > 0 && (
              <div className="rounded-lg bg-surface-4 p-4">
                <div className="flex items-center gap-2">
                  <span className="text-h2 flex-1">Сохранёнки</span>
                  <span className="text-small text-subtle">{pluralPhotos(saved.count)}</span>
                </div>
                <div className="mt-3 grid grid-cols-5 gap-1.5">
                  {saved.items.map((it) => <SavedTile key={it.id} item={it} className="aspect-square w-full rounded-[8px] ring-1 ring-border" onClick={() => setGalleryOpen(true)} />)}
                </div>
                <button type="button" onClick={() => setGalleryOpen(true)} className="mt-3 -mb-4 -mx-4 px-4 h-11 w-[calc(100%+32px)] border-t border-border flex items-center text-body active:bg-surface-3">
                  <span className="flex-1 text-left">Все сохранёнки</span>
                  <ChevronRight className="w-4 h-4 text-subtle" />
                </button>
              </div>
            )}

            <div className="rounded-lg bg-surface-4 p-4">
              <p className="text-h2 mb-2">Информация</p>
              {[
                ["Имя пользователя", "@" + card.username],
                ["ID пользователя", card.id],
                ...(card.created_at ? [["Дата регистрации", new Date(card.created_at).toLocaleDateString("ru-RU")]] : []),
              ].map(([label, value]) => (
                <div key={label} className="flex items-center gap-3 h-9">
                  <span className="text-small text-subtle w-32 shrink-0">{label}</span>
                  <span className="text-small text-muted-foreground flex-1 min-w-0 truncate">{value}</span>
                  <button type="button" onClick={() => copy(value)} className="p-1.5 text-subtle active:text-foreground" aria-label={`Скопировать: ${label}`}>
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

            {!Capacitor.isNativePlatform() && (
              <p className="text-caption text-subtle text-center">
                Удобнее в приложении —{" "}
                <a href={`${PUBLIC_ORIGIN}/apk/`} className="underline text-foreground">скачать ХУЯКС</a>
              </p>
            )}
          </div>
        )}
      </div>

      {galleryOpen && card && (
        <SavedGallery profileId={card.id} own={isMe} title={isMe ? "Мои сохранёнки" : `Сохранёнки ${card.username}`} onClose={() => setGalleryOpen(false)} />
      )}
    </div>
  );
};

export default PublicProfile;
