import { useEffect, useState } from "react";
import { Search, Share2, X } from "lucide-react";
import { toast } from "sonner";
import ScreenHeader from "@/components/ScreenHeader";
import Identicon from "@/components/Identicon";
import { api, type MiniAppItem } from "@/api/client";
import { openMiniApp } from "@/lib/miniapp";
import { shareMiniApp } from "@/lib/share";
import { t, tn } from "@/lib/i18n";

/**
 * Каталог мини-приложений: все боты, у которых есть приложение, популярные
 * первыми, с поиском и ссылкой на каждое (https://wyx.su/u/<бот>?app). Это и
 * перечень стороннего ПО внутри WYX, который требует App Store (4.7.4).
 */
export default function MiniApps() {
  const [items, setItems] = useState<MiniAppItem[] | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    let alive = true;
    const h = setTimeout(() => {
      api.listMiniApps(q.trim())
        .then((rows) => { if (alive) setItems(rows); })
        .catch(() => { if (alive) setItems((l) => l ?? []); });
    }, q ? 250 : 0);
    return () => { alive = false; clearTimeout(h); };
  }, [q]);

  const share = async (it: MiniAppItem) => {
    const r = await shareMiniApp(it.title, it.bot.username);
    if (r === "copied") toast.success(t("Ссылка скопирована"));
    else if (r === "error") toast.error(t("Не удалось поделиться"));
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      <ScreenHeader title={t("Мини-приложения")} />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-xl mx-auto px-4 py-4 space-y-3">
          <label className="flex items-center gap-2 h-10 px-3 rounded-md bg-surface-2 border border-border">
            <Search className="w-4 h-4 text-subtle shrink-0" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Найти приложение")} enterKeyHint="search"
              className="flex-1 min-w-0 bg-transparent outline-none text-body" />
            {q && <button type="button" onClick={() => setQ("")} aria-label={t("Очистить")} className="text-subtle"><X className="w-4 h-4" /></button>}
          </label>

          {items === null ? (
            <p className="text-small text-subtle">{t("Загрузка…")}</p>
          ) : items.length === 0 ? (
            <div className="ui-card rounded-lg bg-surface-2 border border-border p-4 text-small text-subtle">
              {q ? t("Ничего не найдено") : t("Пока ни у одного бота нет мини-приложения. Своё можно подключить в студии: бот → «Мини-приложение».")}
            </div>
          ) : (
            <div className="ui-card rounded-lg bg-surface-2 border border-border divide-y divide-border overflow-hidden">
              {items.map((it) => (
                <div key={it.bot.id} className="flex items-center gap-3 px-3 py-3">
                  <button type="button" onClick={() => void openMiniApp({ botId: it.bot.id, botName: it.bot.username })}
                    className="min-w-0 flex-1 flex items-center gap-3 text-left active:opacity-80">
                    <Identicon id={it.bot.id} avatarUrl={it.bot.avatar_url} className="w-11 h-11 rounded-[12px] shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-body font-medium truncate">{it.title}</span>
                      <span className="block text-caption text-subtle truncate">
                        @{it.bot.username}{it.users ? ` · ${tn(it.users, "{n} пользователь", "{n} пользователя", "{n} пользователей")}` : ""}
                      </span>
                      {it.description && <span className="block text-caption text-subtle line-clamp-2">{it.description}</span>}
                    </span>
                  </button>
                  {/* Открывает вся строка; справа — только «Поделиться», чтобы
                      подписи не сжимались. */}
                  <button type="button" onClick={() => void share(it)} className="p-2 text-subtle active:text-primary shrink-0" aria-label={t("Поделиться")}>
                    <Share2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <p className="px-1 text-caption text-subtle">
            {t("Мини-приложения делают боты: это их страницы, открытые внутри WYX. Перед первым запуском приложение спросит разрешение узнать ваш ник и аватар.")}
          </p>
        </div>
      </div>
    </div>
  );
}
