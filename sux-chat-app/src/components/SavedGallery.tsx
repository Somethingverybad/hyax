import { useEffect, useRef, useState } from "react";
import { ChevronLeft, Download, Heart, Share2, Trash2 } from "lucide-react";
import { saveFileToDevice } from "@/lib/saveFile";
import { toast } from "sonner";
import { api, mediaUrl, type SavedImage } from "@/api/client";
import { useMediaUrl } from "@/hooks/use-media-url";
import ImageViewer, { type ViewerItem } from "@/components/ImageViewer";
import ShareToChat from "@/components/ShareToChat";
import { cn } from "@/lib/utils";
import { useMint, MintIcon } from "@/themes/mint";
import { useGlassHeight } from "@/themes/mint/glass";
import { t, tn } from "@/lib/i18n";

/** «1 фото», «12 фото» — слово не склоняется, но пусть будет одной точкой. */
export const pluralPhotos = (n: number) => tn(n, "{n} фото", "{n} фото", "{n} фото");

/** Плитка сохранёнки: картинка грузится через useMediaUrl (медиа за токеном).
 *  Внизу — сердечко со счётчиком, если за неё уже поднимали вайб. */
export const SavedTile = ({ item, className, onClick }: { item: SavedImage; className?: string; onClick?: () => void }) => {
  const url = useMediaUrl(item.file_url);
  return (
    <button type="button" onClick={onClick} className={`relative overflow-hidden rounded-md bg-surface-3 ${className || ""}`} aria-label={item.file_name || t("Сохранёнка")}>
      {url ? <img src={url} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" draggable={false} /> : <span className="absolute inset-0 animate-pulse bg-surface-3" />}
      {(item.vibes || 0) > 0 && (
        <span className="absolute left-1.5 bottom-1.5 h-5 px-1.5 rounded-full bg-black/55 text-white text-[11px] font-semibold tabular-nums flex items-center gap-1">
          <Heart className={cn("w-3 h-3", item.vibed && "text-[#ff3b5c]")} fill="currentColor" strokeWidth={0} />{item.vibes}
        </span>
      )}
    </button>
  );
};

/** Все сохранёнки: сетка на весь экран. own — свои: можно удалять. */
const SavedGallery = ({ profileId, own, title, onClose, onChanged }: {
  profileId?: string;
  own: boolean;
  title?: string;
  onClose: () => void;
  onChanged?: (count: number) => void;
}) => {
  const [rawItems, setItems] = useState<SavedImage[] | null>(null);
  const mint = useMint();
  const glassRef = useRef<HTMLDivElement>(null);
  useGlassHeight(glassRef, mint);
  // «Мята»: кнопка сортировки в шапке — новые сверху или старые сверху.
  const [oldFirst, setOldFirst] = useState(false);
  const items = rawItems && oldFirst ? [...rawItems].reverse() : rawItems;
  // Открытая сохранёнка — позицией в списке: просмотрщик листает их свайпом.
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const viewerItems: ViewerItem[] = (items || []).map((it) => ({
    raw: it.file_url, name: it.file_name || "image", messageId: it.id,
  }));

  useEffect(() => {
    let alive = true;
    api.listSavedImages(profileId).then((d) => alive && setItems(d.items)).catch(() => alive && setItems([]));
    return () => { alive = false; };
  }, [profileId]);

  // Вайб за картинку: двойной тап по ней в просмотре или сердечко внизу.
  // Рисуем сразу, ответ сервера поправит счётчик; уже поднятый — ничего.
  const patch = (id: string, p: Partial<SavedImage>) => setItems((prev) => (prev || []).map((x) => (x.id === id ? { ...x, ...p } : x)));
  const raise = async (it: SavedImage) => {
    if (own || it.vibed) return;
    patch(it.id, { vibed: true, vibes: (it.vibes || 0) + 1 });
    try {
      const r = await api.raiseSavedVibe(it.id);
      patch(it.id, { vibed: r.vibed, vibes: r.vibes });
    } catch (e: any) {
      if (e?.state) patch(it.id, { vibed: e.state.vibed, vibes: e.state.vibes });
      else patch(it.id, { vibed: false, vibes: it.vibes || 0 });
      if (e?.status !== 409) toast.error(e?.message || t("Не получилось"));
    }
  };
  // «Поделиться»: в чат — сообщением с этой картинкой, наружу — системным окном.
  const [shareFor, setShareFor] = useState<SavedImage | null>(null);
  const sendTo = async (it: SavedImage, chatId: string, title: string) => {
    try {
      await api.sendMessageWithFile(chatId, { file_url: it.file_url, file_name: it.file_name || "photo.jpg", file_size: 0 });
      toast.success(t("Отправлено: {title}", { title }));
    } catch (e: any) {
      toast.error(e?.message || t("Не удалось отправить"));
    }
  };
  const shareOutside = async (it: SavedImage) => {
    const url = it.file_url.startsWith("s3://") ? await api.signMedia(it.file_url) : mediaUrl(it.file_url);
    await saveFileToDevice(url, it.file_name || "photo.jpg");
  };
  const cur = openIdx !== null ? (items || [])[openIdx] : null;

  const remove = async (it: SavedImage) => {
    try {
      await api.deleteSavedImage(it.id);
      setItems((prev) => {
        const next = (prev || []).filter((x) => x.id !== it.id);
        onChanged?.(next.length);
        return next;
      });
      setOpenIdx(null);
      toast.success(t("Удалено из сохранёнок"));
    } catch (e: any) {
      toast.error(e?.message || t("Не удалось удалить"));
    }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-background flex flex-col" style={mint ? { backgroundImage: "linear-gradient(155deg, hsl(var(--background)) 10%, hsl(var(--chat-canvas)) 100%)" } : undefined} onClick={(e) => e.stopPropagation()}>
      {mint ? (
        <div ref={glassRef} className="mint-glass shrink-0 pad-safe-top">
          <div className="mint-head !pt-[19px] !pb-[12px]">
            <button type="button" onClick={onClose} aria-label={t("Назад")} className="mint-pill w-[37px] h-[31px] inline-flex items-center justify-center mint-muted">
              <MintIcon name="back" size={[7, 13]} />
            </button>
            <span className="mint-title truncate">{title || t("Сохранёнки")}</span>
            <button type="button" onClick={() => setOldFirst((v) => !v)} aria-label={oldFirst ? t("Сначала новые") : t("Сначала старые")}
              className="mint-lime w-[46px] h-[34px] inline-flex items-center justify-center gap-[1px]">
              <MintIcon name="sort" size={[10, 15]} style={{ transform: "rotate(180deg)" }} />
              <MintIcon name="sort" size={[10, 15]} />
            </button>
          </div>
        </div>
      ) : (
      <div className="shrink-0 flex items-center gap-2 px-3 py-3 pad-safe-top min-h-14 border-b border-border">
        <button type="button" onClick={onClose} className="p-2 -ml-2" aria-label={t("Назад")}>
          <ChevronLeft className="w-6 h-6" />
        </button>
        <span className="text-h1 truncate">{title || t("Сохранёнки")}</span>
        {items && <span className="ml-auto text-small text-subtle">{items.length}</span>}
      </div>
      )}
      <div className={mint ? "flex-1 overflow-y-auto px-[17px] pb-3 pad-safe-bottom" : "flex-1 overflow-y-auto p-3 pad-safe-bottom"}>
        {items === null ? (
          <p className="py-10 text-center text-small text-subtle">{t("Загрузка…")}</p>
        ) : items.length === 0 ? (
          <p className="py-10 text-center text-small text-subtle px-6">
            {own ? t("Пока пусто. Открой фото в чате, тапни по нему и выбери «Добавить в сохранёнки».") : t("Сохранёнок пока нет")}
          </p>
        ) : (
          <div className={mint ? "grid grid-cols-3 md:grid-cols-5 gap-[4px]" : "grid grid-cols-3 md:grid-cols-5 gap-1.5"}>
            {items.map((it, i) => <SavedTile key={it.id} item={it} className={mint ? "aspect-[117/130] w-full !rounded-[20px]" : "aspect-[4/5] w-full"} onClick={() => setOpenIdx(i)} />)}
          </div>
        )}
      </div>
      {openIdx !== null && viewerItems[openIdx] && (
        <ImageViewer
          items={viewerItems}
          index={openIdx}
          onIndex={setOpenIdx}
          onClose={() => setOpenIdx(null)}
          onDoubleTap={own ? undefined : () => { if (cur) void raise(cur); }}
          footer={cur && (
            <div className="flex items-center gap-1 rounded-full bg-black/55 backdrop-blur-md p-1 text-white">
              <button
                type="button"
                onClick={() => void raise(cur)}
                disabled={own}
                aria-pressed={!!cur.vibed}
                aria-label={own ? t("Вайб за фото: {n}", { n: cur.vibes || 0 }) : cur.vibed ? t("Вы подняли вайб") : t("Поднять вайб")}
                className="h-11 min-w-11 px-3 rounded-full flex items-center justify-center gap-1.5 active:scale-90 transition-transform disabled:active:scale-100"
              >
                <Heart className={cn("w-6 h-6", cur.vibed && "text-[#ff3b5c]")} fill={cur.vibed ? "currentColor" : "none"} />
                {(cur.vibes || 0) > 0 && <span className="text-small font-semibold tabular-nums">{cur.vibes}</span>}
              </button>
              <button type="button" onClick={() => setShareFor(cur)} aria-label={t("Поделиться")}
                className="h-11 w-11 rounded-full flex items-center justify-center active:scale-90 transition-transform">
                <Share2 className="w-5 h-5" />
              </button>
            </div>
          )}
          actions={[
            { label: t("Скачать"), icon: <Download className="w-5 h-5 text-subtle" />, onClick: async () => {
              const cur = viewerItems[openIdx];
              const url = cur.raw.startsWith("s3://") ? await api.signMedia(cur.raw) : mediaUrl(cur.raw);
              await saveFileToDevice(url, cur.name || "photo.jpg");
            } },
            ...(own ? [{ label: t("Удалить из сохранёнок"), icon: <Trash2 className="w-5 h-5" />, danger: true, onClick: () => {
              const it = (items || [])[openIdx];
              if (it) void remove(it);
            } }] : []),
          ]}
        />
      )}
      <ShareToChat
        open={!!shareFor}
        title={t("Отправить фото")}
        text=""
        onClose={() => setShareFor(null)}
        onPick={(chatId, title) => { if (shareFor) void sendTo(shareFor, chatId, title); }}
        onShareOutside={() => { if (shareFor) void shareOutside(shareFor); }}
      />
    </div>
  );
};

export default SavedGallery;
