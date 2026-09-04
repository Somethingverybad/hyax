import { useEffect, useState } from "react";
import { ChevronLeft, Download, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, type SavedImage } from "@/api/client";
import { useMediaUrl } from "@/hooks/use-media-url";
import ImageViewer from "@/components/ImageViewer";

/** Плитка сохранёнки: картинка грузится через useMediaUrl (медиа за токеном). */
export const SavedTile = ({ item, className, onClick }: { item: SavedImage; className?: string; onClick?: () => void }) => {
  const url = useMediaUrl(item.file_url);
  return (
    <button type="button" onClick={onClick} className={`relative overflow-hidden rounded-md bg-surface-3 ${className || ""}`} aria-label={item.file_name || "Сохранёнка"}>
      {url ? <img src={url} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" draggable={false} /> : <span className="absolute inset-0 animate-pulse bg-surface-3" />}
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
  const [items, setItems] = useState<SavedImage[] | null>(null);
  const [open, setOpen] = useState<SavedImage | null>(null);
  const openUrl = useMediaUrl(open?.file_url || "");

  useEffect(() => {
    let alive = true;
    api.listSavedImages(profileId).then((d) => alive && setItems(d.items)).catch(() => alive && setItems([]));
    return () => { alive = false; };
  }, [profileId]);

  const remove = async (it: SavedImage) => {
    try {
      await api.deleteSavedImage(it.id);
      setItems((prev) => {
        const next = (prev || []).filter((x) => x.id !== it.id);
        onChanged?.(next.length);
        return next;
      });
      setOpen(null);
      toast.success("Удалено из сохранёнок");
    } catch (e: any) {
      toast.error(e?.message || "Не удалось удалить");
    }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-background flex flex-col" onClick={(e) => e.stopPropagation()}>
      <div className="shrink-0 flex items-center gap-2 px-3 py-3 pad-safe-top min-h-14 border-b border-border">
        <button type="button" onClick={onClose} className="p-2 -ml-2" aria-label="Назад">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <span className="text-h1 truncate">{title || "Сохранёнки"}</span>
        {items && <span className="ml-auto text-small text-subtle">{items.length}</span>}
      </div>
      <div className="flex-1 overflow-y-auto p-3 pad-safe-bottom">
        {items === null ? (
          <p className="py-10 text-center text-small text-subtle">Загрузка…</p>
        ) : items.length === 0 ? (
          <p className="py-10 text-center text-small text-subtle px-6">
            {own ? "Пока пусто. Открой фото в чате, тапни по нему и выбери «Добавить в сохранёнки»." : "Сохранёнок пока нет"}
          </p>
        ) : (
          <div className="grid grid-cols-3 md:grid-cols-5 gap-1.5">
            {items.map((it) => <SavedTile key={it.id} item={it} className="aspect-[4/5] w-full" onClick={() => setOpen(it)} />)}
          </div>
        )}
      </div>
      {open && openUrl && (
        <ImageViewer
          item={{ url: openUrl, name: open.file_name || "image" }}
          onClose={() => setOpen(null)}
          actions={[
            { label: "Скачать", icon: <Download className="w-5 h-5 text-subtle" />, onClick: () => window.open(openUrl, "_blank") },
            ...(own ? [{ label: "Удалить из сохранёнок", icon: <Trash2 className="w-5 h-5" />, danger: true, onClick: () => void remove(open) }] : []),
          ]}
        />
      )}
    </div>
  );
};

export default SavedGallery;
