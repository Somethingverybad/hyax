import { useEffect, useState } from "react";
import { api } from "@/api/client";
import { cn } from "@/lib/utils";

interface Sticker {
  id: string;
  pack: string;
  pack_name: string;
  file_url: string;
  file_name: string;
  emoji?: string;
}

interface UserStickerPack {
  id: string;
  pack: {
    id: string;
    name: string;
    stickers_count: number;
  };
}

interface StickerPickerProps {
  onSelect: (sticker: Sticker) => void;
}

/**
 * Панель стикеров в стиле мессенджеров: наборы полосой сверху, сетка снизу.
 *
 * Портирована из веб-версии, но упрощена под телефон: управление наборами
 * (создание, импорт, удаление) осталось в вебе — на маленьком экране это
 * отдельный сценарий, который мешал бы основному.
 */
const StickerPicker = ({ onSelect }: StickerPickerProps) => {
  const [packs, setPacks] = useState<UserStickerPack[]>([]);
  const [activePackId, setActivePackId] = useState<string | null>(null);
  const [stickers, setStickers] = useState<Sticker[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const list = await api.getMyStickerPacks();
        setPacks(list || []);
        const first = list?.[0]?.pack?.id ?? null;
        setActivePackId(first);
      } catch {
        setPacks([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!activePackId) {
      setStickers([]);
      return;
    }
    (async () => {
      try {
        setStickers((await api.getStickers(activePackId)) || []);
      } catch {
        setStickers([]);
      }
    })();
  }, [activePackId]);

  if (loading) {
    return (
      <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">
        Загрузка стикеров…
      </div>
    );
  }

  if (packs.length === 0) {
    return (
      <div className="h-64 flex flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-sm text-muted-foreground">
          Наборов пока нет. Добавьте их в веб-версии — здесь они появятся сами.
        </p>
      </div>
    );
  }

  return (
    <div className="h-64 flex flex-col">
      {/* Полоса наборов */}
      <div className="flex gap-2 px-3 py-2 overflow-x-auto border-b border-border shrink-0">
        {packs.map((p) => (
          <button
            key={p.pack.id}
            type="button"
            onClick={() => setActivePackId(p.pack.id)}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs whitespace-nowrap transition-colors",
              activePackId === p.pack.id
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground",
            )}
          >
            {p.pack.name}
          </button>
        ))}
      </div>

      {/* Сетка стикеров */}
      <div className="flex-1 overflow-y-auto p-2">
        {stickers.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            В наборе пусто
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-2">
            {stickers.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onSelect(s)}
                className="aspect-square rounded-lg p-1 active:scale-90 transition-transform"
              >
                <img
                  src={s.file_url}
                  alt={s.emoji || ""}
                  className="w-full h-full object-contain"
                  loading="lazy"
                />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default StickerPicker;
