import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Flag, Image as ImageIcon, Lightbulb, Sparkles, UserRound } from "lucide-react";
import ScreenHeader from "@/components/ScreenHeader";
import Identicon from "@/components/Identicon";
import { VibeBar } from "@/components/Vibometer";
import { api, mediaUrl, type VibeEvent, type VibeHistory } from "@/api/client";
import { getLang, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Настройки → Вайбометр → «Кто поднимал вайб»: кто и за что поднимал мой
 * вайб и что его снимало. Анонимные голоса и лайки идей — без имени (сервер
 * имя не отдаёт), жалобы — без автора.
 */
const ProfileVibeHistory = () => {
  const t = useT();
  const navigate = useNavigate();
  const [data, setData] = useState<VibeHistory | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { api.vibeHistory().then(setData).catch(() => setFailed(true)); }, []);

  const lang = getLang();
  const when = (iso: string) => {
    const d = new Date(iso);
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : lang === "ko" ? "ko-KR" : "en-GB", {
      day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }), hour: "2-digit", minute: "2-digit",
    }).format(d);
  };
  const title = (e: VibeEvent) => {
    const name = e.who?.username;
    switch (e.kind) {
      case "profile": return name ? t("{name} поднял(а) ваш вайб", { name }) : t("Кто-то поднял ваш вайб");
      case "saved": return name ? t("{name} лайкнул(а) вашу сохранёнку", { name }) : t("Лайк вашей сохранёнки");
      case "idea_like": return t("Лайк вашей идеи");
      case "idea_vote": return t("Вы проголосовали за идею");
      case "report": return t("Жалоба на вас");
      case "playlist_like": return name ? t("{name} лайкнул(а) ваш плейлист", { name }) : t("Лайк вашего плейлиста");
    }
  };
  const icon = (e: VibeEvent) => {
    if (e.who) return <Identicon id={e.who.id} avatarUrl={e.who.avatar_url} className="w-10 h-10 shrink-0" />;
    const Icon = e.kind === "report" ? Flag : e.kind === "saved" ? ImageIcon : e.kind.startsWith("idea") ? Lightbulb : UserRound;
    return (
      <span className={cn("w-10 h-10 shrink-0 rounded-full flex items-center justify-center", e.kind === "report" ? "bg-destructive/10 text-destructive" : "bg-surface-4 text-subtle")}>
        <Icon className="w-5 h-5" />
      </span>
    );
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      <ScreenHeader title={t("Кто поднимал вайб")} />
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {data && (
          <div className="rounded-lg bg-surface-4 p-4 mb-4">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary shrink-0" />
              <span className="text-h2 flex-1">{t("Вайбометр")}</span>
              <span className="text-[22px] leading-none font-semibold tabular-nums">{data.vibe}</span>
            </div>
            <VibeBar vibe={data.vibe} />
            {data.silent && <p className="mt-2 text-caption text-subtle">{t("Пока выключен звук входящих, другим вайбометр показывает минус. Здесь — настоящий.")}</p>}
          </div>
        )}
        {!data && !failed && <p className="py-10 text-center text-small text-subtle">{t("Загрузка…")}</p>}
        {failed && <p className="py-10 text-center text-small text-subtle">{t("Не удалось загрузить историю вайба")}</p>}
        {data && !data.items.length && <p className="py-10 text-center text-small text-subtle">{t("Пока никто не поднимал ваш вайб. Его поднимают в профиле, лайком сохранёнки и голосами за идеи.")}</p>}
        {data && data.items.length > 0 && (
          <div className="ui-card rounded-lg bg-surface-2 border border-border divide-y divide-border">
            {data.items.map((e, i) => {
              const open = e.who ? () => navigate(`/u/${encodeURIComponent(e.who!.username)}`) : undefined;
              return (
                <div key={i} className={cn("flex items-center gap-3 px-4 py-3", open && "cursor-pointer active:bg-surface-3")} onClick={open}>
                  {icon(e)}
                  <div className="flex-1 min-w-0">
                    <p className="text-body line-clamp-2 break-words">{title(e)}</p>
                    {e.idea && <p className="text-caption text-subtle line-clamp-2 break-words">«{e.idea}»</p>}
                    {e.playlist && <p className="text-caption text-subtle line-clamp-1 break-words">«{e.playlist}»</p>}
                    <p className="text-caption text-subtle">{when(e.at)}</p>
                  </div>
                  {e.image && <img src={mediaUrl(e.image)} alt="" className="w-10 h-10 rounded-md object-cover shrink-0" loading="lazy" />}
                  <span className={cn("text-body font-semibold tabular-nums shrink-0", e.points < 0 ? "text-destructive" : "text-primary")}>
                    {e.points > 0 ? `+${e.points}` : `−${Math.abs(e.points)}`}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        {data && data.items.length > 0 && (
          <p className="text-caption text-subtle px-1 mt-3">{t("Анонимные голоса и лайки идей — без имени: так их отдали. Голоса до этого обновления показываются анонимными — тогда выбор «анонимно» не сохранялся.")}</p>
        )}
      </div>
    </div>
  );
};

export default ProfileVibeHistory;
