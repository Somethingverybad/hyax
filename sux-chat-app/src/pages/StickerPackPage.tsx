import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Sticker as StickerIcon, Share2, Check, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import ScreenHeader from "@/components/ScreenHeader";
import { api, mediaUrl, type StickerPackInfo } from "@/api/client";
import { stickerPackLink } from "@/lib/share";
import AdultLock, { AdultBadge } from "@/components/AdultLock";

/**
 * Стикерпак по ссылке /stp/<id> — как /sp/<id> для звуков. Сетка стикеров
 * для просмотра и кнопка «Добавить»: после неё пак появляется в панели
 * стикеров. До этого экрана пак можно было получить только по id через
 * «share_code», а маршрута в приложении не было — ссылка из студии вела в 404.
 */
const StickerPackPage = () => {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [pack, setPack] = useState<StickerPackInfo | null | undefined>(undefined);
  const [stickers, setStickers] = useState<{ id: string; file_url: string; emoji?: string | null }[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api.getStickerPack(id).then((p) => alive && setPack(p)).catch(() => alive && setPack(null));
    api.getStickers(id).then((l) => alive && setStickers(l || [])).catch(() => {});
    return () => { alive = false; };
  }, [id]);

  const act = async () => {
    if (!pack || busy) return;
    setBusy(true);
    try {
      if (pack.is_saved) { await api.unsaveStickerPack(pack.id); toast.success("Пак убран"); }
      else { await api.saveStickerPack(pack.id); toast.success("Пак добавлен — он появится в панели стикеров"); }
      setPack({ ...pack, is_saved: !pack.is_saved });
    } catch (e: any) {
      toast.error(e?.message || "Не получилось");
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    try { await navigator.clipboard.writeText(stickerPackLink(id)); toast.success("Ссылка скопирована"); }
    catch { toast.error("Не удалось скопировать"); }
  };

  const mine = !!pack && !!pack.author && pack.author.id === (() => { try { return JSON.parse(localStorage.getItem("cache_user") || "null")?.id; } catch { return null; } })();

  return (
    <div className="h-screen flex flex-col bg-background">
      <ScreenHeader
        title="Стикерпак"
        onBack={() => (window.history.length > 1 ? navigate(-1) : navigate("/chat", { replace: true }))}
        right={
          <button type="button" onClick={share} className="w-10 h-10 flex items-center justify-center text-subtle active:opacity-60" aria-label="Поделиться">
            <Share2 className="w-5 h-5" />
          </button>
        }
      />
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {pack === undefined ? (
          <p className="py-10 text-center text-small text-subtle">Загрузка…</p>
        ) : pack === null ? (
          <p className="py-10 text-center text-small text-subtle">Пак не найден или приватный</p>
        ) : (
          <>
            <div className="flex items-center gap-4">
              <span className="w-16 h-16 rounded-lg bg-surface-3 flex items-center justify-center shrink-0 overflow-hidden">
                {stickers[0] ? <img src={mediaUrl(stickers[0].file_url)} alt="" className="w-12 h-12 object-contain" /> : <StickerIcon className="w-7 h-7 text-primary" />}
              </span>
              <div className="min-w-0">
                <p className="text-[22px] leading-tight font-semibold truncate">{pack.name}{pack.is_adult && <AdultBadge />}</p>
                <p className="mt-1 text-small text-subtle truncate">
                  {pack.author?.username ? `Автор: ${pack.author.username}` : "Без автора"} · {pack.stickers_count} стикеров
                </p>
              </div>
            </div>

            {pack.adult_locked && <AdultLock />}

            {!mine && !pack.adult_locked && (
              <button
                type="button"
                onClick={act}
                disabled={busy}
                className={`w-full h-11 rounded-md font-medium flex items-center justify-center gap-2 active:opacity-90 disabled:opacity-50 ${pack.is_saved ? "bg-surface-4 text-foreground" : "bg-primary text-primary-foreground"}`}
              >
                {pack.is_saved ? <><Trash2 className="w-4 h-4" /> Убрать из моих</> : <><Plus className="w-4 h-4" /> Добавить себе</>}
              </button>
            )}
            {mine && <p className="px-1 text-small text-subtle flex items-center gap-1.5"><Check className="w-4 h-4 text-primary" /> Это твой пак — он уже у тебя</p>}

            {!pack.adult_locked && <div className="rounded-lg bg-surface-2 border border-border p-3 grid grid-cols-4 gap-2">
              {stickers.map((s) => (
                <div key={s.id} className="aspect-square rounded-md bg-surface-3 flex items-center justify-center overflow-hidden">
                  <img src={mediaUrl(s.file_url)} alt={s.emoji || ""} className="w-full h-full object-contain" loading="lazy" />
                </div>
              ))}
              {stickers.length === 0 && <p className="col-span-4 py-6 text-center text-small text-subtle">Стикеры ещё грузятся</p>}
            </div>}
          </>
        )}
      </div>
    </div>
  );
};

export default StickerPackPage;
