import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Check, Music2, Palette, Plus, Sticker as StickerIcon } from "lucide-react";
import { api, mediaUrl } from "@/api/client";
import { packLinkKind } from "@/lib/linkify";
import { setInstalledThemes, setTheme, getInstalledThemes } from "@/lib/theme";
import { normalizeTheme } from "@/themes/engine";
import { syncNotificationSounds } from "@/lib/notificationSounds";

type Info = { title: string; subtitle: string; cover?: string | null; added: boolean; mine: boolean };

/**
 * Карточка пака или темы прямо в сообщении: иконка, название, автор и кнопка
 * «Добавить себе». Раньше ссылка вела наружу, в браузере не было сессии, и пак
 * не открывался вовсе. Тап по карточке открывает страницу внутри приложения.
 */
const PackLinkCard = ({ url, own }: { url: string; own?: boolean }) => {
  const navigate = useNavigate();
  const target = packLinkKind(url);
  const [info, setInfo] = useState<Info | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!target) return;
    let alive = true;
    const load = async () => {
      try {
        if (target.kind === "sound") {
          const p = await api.getSoundPack(target.id);
          return { title: p.name, subtitle: `Пак звуков · ${p.sounds_count ?? p.sounds.length} звуков`, added: p.added || p.mine || p.is_default, mine: p.mine || p.is_default };
        }
        if (target.kind === "sticker") {
          const p = await api.getStickerPack(target.id);
          const first = (await api.getStickers(target.id).catch(() => []))[0];
          const mine = !!p.author && p.author.id === (() => { try { return JSON.parse(localStorage.getItem("cache_user") || "null")?.id; } catch { return null; } })();
          return { title: p.name, subtitle: `Стикерпак · ${p.stickers_count} стикеров`, cover: first?.file_url, added: p.is_saved || mine, mine };
        }
        const t = normalizeTheme(await api.getTheme(target.id));
        return { title: t.name, subtitle: t.author ? `Тема · автор ${t.author}` : "Тема оформления", added: !!t.installed || !!t.mine, mine: !!t.mine };
      } catch {
        return null;
      }
    };
    load().then((r) => alive && setInfo(r));
    return () => { alive = false; };
  }, [target?.kind, target?.id]);

  if (!target || info === null) return null;

  const add = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!info || busy) return;
    setBusy(true);
    try {
      if (target.kind === "sound") { await api.addSoundPack(target.id); void syncNotificationSounds().catch(() => {}); }
      else if (target.kind === "sticker") await api.saveStickerPack(target.id);
      else {
        const saved = normalizeTheme(await api.installTheme(target.id));
        setInstalledThemes([saved, ...getInstalledThemes().filter((t) => t.id !== saved.id)]);
        setTheme(saved);
      }
      setInfo({ ...info, added: true });
      toast.success(target.kind === "theme" ? "Тема установлена и включена" : "Добавлено");
    } catch (e: any) {
      toast.error(e?.message || "Не получилось");
    } finally {
      setBusy(false);
    }
  };

  const Icon = target.kind === "sound" ? Music2 : target.kind === "sticker" ? StickerIcon : Palette;
  const path = target.kind === "sound" ? `/sp/${target.id}` : target.kind === "sticker" ? `/stp/${target.id}` : `/t/${target.id}`;

  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); navigate(path); }}
      className={`ui-card mt-1.5 w-full max-w-[260px] rounded-lg overflow-hidden text-left ${own ? "bg-black/15" : "bg-surface-2"}`}
    >
      <span className="px-2.5 py-2 flex items-center gap-2.5">
        <span className="w-10 h-10 shrink-0 rounded-md bg-surface-3 flex items-center justify-center overflow-hidden">
          {info?.cover ? <img src={mediaUrl(info.cover)} alt="" className="w-8 h-8 object-contain" /> : <Icon className="w-5 h-5 text-primary" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-small font-medium truncate">{info ? info.title : "Загрузка…"}</span>
          <span className="block text-caption opacity-70 truncate">{info ? info.subtitle : " "}</span>
        </span>
      </span>
      {info && (
        <span className="block px-2.5 pb-2">
          {info.added ? (
            <span className="h-8 w-full rounded-md bg-surface-4 text-caption font-medium flex items-center justify-center gap-1.5">
              <Check className="w-3.5 h-3.5" /> {info.mine ? "Уже у вас" : "Добавлено"}
            </span>
          ) : (
            <span
              role="button"
              tabIndex={0}
              onClick={add}
              onKeyDown={(e) => { if (e.key === "Enter") add(e as unknown as React.MouseEvent); }}
              aria-disabled={busy}
              className="h-8 w-full rounded-md bg-primary text-primary-foreground text-caption font-semibold flex items-center justify-center gap-1.5 active:opacity-90"
            >
              <Plus className="w-3.5 h-3.5" /> {busy ? "…" : "Добавить себе"}
            </span>
          )}
        </span>
      )}
    </button>
  );
};

export default PackLinkCard;
