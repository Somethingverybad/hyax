import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { Radio, Share2, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import Identicon from "@/components/Identicon";
import { api } from "@/api/client";
import { shareChannel, PUBLIC_ORIGIN } from "@/lib/share";
import { t, tn } from "@/lib/i18n";

/**
 * Канал по ссылке «Поделиться каналом» — https://huyax.e-tree.su/c/<@username|id>.
 * Открыть можно и без подписки (как из поиска): подписка — уже в ленте.
 * Без сессии — на вход и обратно через ?next=.
 */
type Ch = { id: string; name: string; username?: string | null; description?: string; avatar_url?: string | null; subscribers_count?: number; my_role?: string | null };

const PublicChannel = () => {
  const { handle = "" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [ch, setCh] = useState<Ch | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "missing" | "error">("loading");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem("access_token")) {
      navigate(`/auth?next=${encodeURIComponent(`/c/${handle}${params.get("post") ? `?post=${params.get("post")}` : ""}`)}`, { replace: true });
      return;
    }
    let alive = true;
    api.getChannelByHandle(handle)
      .then((c) => { if (alive) { setCh(c); setState("ok"); } })
      .catch((e) => { if (alive) setState(e?.message === "not_found" ? "missing" : "error"); });
    return () => { alive = false; };
  }, [handle, navigate]);

  const open = async (subscribe: boolean) => {
    if (!ch || busy) return;
    setBusy(true);
    try {
      if (subscribe && !ch.my_role) await api.subscribeChannel(ch.id);
      // Ссылка на конкретный пост (?post=): лента канала прокрутит к нему.
      const post = params.get("post");
      if (post) { try { sessionStorage.setItem("hyax:openPost", post); } catch { /* приватный режим */ } }
      navigate("/chat", { replace: true, state: { chatId: ch.id, kind: "channel", title: ch.name } });
    } catch {
      toast.error(t("Не удалось открыть канал"));
      setBusy(false);
    }
  };

  return (
    <div className="h-full bg-background text-foreground flex flex-col">
      <div className="pad-safe-top px-3 py-2 flex items-center gap-2 shrink-0">
        <button type="button" onClick={() => navigate("/chat", { replace: true })} className="w-10 h-10 rounded-md flex items-center justify-center bg-surface-2" aria-label={t("К чатам")}>
          <ArrowLeft className="w-5 h-5" />
        </button>
        <span className="text-body font-semibold">{t("Канал")}</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-[calc(var(--sab)+32px)]">
        {state === "loading" && <div className="mt-16 text-center text-subtle text-small">{t("Загрузка…")}</div>}
        {state === "missing" && (
          <div className="mt-16 text-center space-y-2">
            <p className="text-body font-semibold">{t("Такого канала нет")}</p>
            <p className="text-small text-subtle">{t("Ссылка устарела или канал удалён.")}</p>
          </div>
        )}
        {state === "error" && <div className="mt-16 text-center text-small text-subtle">{t("Не удалось загрузить канал.")}</div>}

        {state === "ok" && ch && (
          <div className="mt-4 space-y-5 max-w-md mx-auto">
            <div className="flex items-center gap-5">
              {ch.avatar_url
                ? <Identicon id={ch.id} avatarUrl={ch.avatar_url} className="w-[104px] h-[104px] rounded-lg shrink-0" />
                : <span className="w-[104px] h-[104px] rounded-lg shrink-0 bg-surface-2 flex items-center justify-center"><Radio className="w-10 h-10 text-primary" /></span>}
              <div className="min-w-0">
                <h2 className="text-[24px] leading-tight font-semibold truncate">{ch.name}</h2>
                <p className="mt-2 text-body text-subtle truncate">{tn(ch.subscribers_count ?? 0, "{n} подписчик", "{n} подписчика", "{n} подписчиков")}{ch.username ? ` · @${ch.username}` : ""}</p>
              </div>
            </div>

            <div className="flex gap-3">
              {ch.my_role ? (
                <button type="button" onClick={() => open(false)} disabled={busy} className="flex-1 h-10 rounded-md bg-primary text-primary-foreground font-medium disabled:opacity-50">
                  {busy ? t("Открываю…") : t("Открыть канал")}
                </button>
              ) : (
                <>
                  <button type="button" onClick={() => open(true)} disabled={busy} className="flex-1 h-10 rounded-md bg-primary text-primary-foreground font-medium disabled:opacity-50">
                    {busy ? "…" : t("Подписаться")}
                  </button>
                  <button type="button" onClick={() => open(false)} disabled={busy} className="flex-1 h-10 rounded-md bg-surface-4 text-foreground font-medium disabled:opacity-50">
                    {t("Посмотреть")}
                  </button>
                </>
              )}
            </div>
            <button type="button" onClick={async () => { const r = await shareChannel(ch); if (r === "copied") toast.success(t("Ссылка скопирована")); else if (r === "error") toast.error(t("Не удалось поделиться")); }}
              className="w-full h-10 rounded-md bg-surface-4 text-foreground font-medium flex items-center justify-center gap-2">
              <Share2 className="w-4 h-4" /> {t("Поделиться")}
            </button>

            {ch.description && (
              <div className="rounded-lg bg-surface-4 p-4">
                <p className="text-h2 mb-2">{t("О канале")}</p>
                <p className="text-body text-muted-foreground whitespace-pre-wrap break-words">{ch.description}</p>
              </div>
            )}

            {!Capacitor.isNativePlatform() && (
              <p className="text-caption text-subtle text-center">
                {t("Удобнее в приложении —")}{" "}
                <a href={`${PUBLIC_ORIGIN}/apk/`} className="underline text-foreground">{t("скачать WYX")}</a>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default PublicChannel;
