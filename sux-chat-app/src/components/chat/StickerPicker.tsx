import { useEffect, useRef, useState } from "react";
import { api } from "@/api/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Plus } from "lucide-react";

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
  // Создание набора: имя вводится один раз, дальше выбираются файлы.
  const [creating, setCreating] = useState(false);
  const [newPackName, setNewPackName] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadPacks = async (selectId?: string) => {
    try {
      const list = await api.getMyStickerPacks();
      setPacks(list || []);
      setActivePackId(selectId ?? list?.[0]?.pack?.id ?? null);
    } catch {
      setPacks([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPacks();
  }, []);

  // Файлы грузятся по одному: сервер возвращает ссылку, и стикер привязывается
  // к набору. Порядок сохраняем по позиции в выборе.
  const addFiles = async (files: FileList | null) => {
    if (!files?.length || !activePackId) return;
    setBusy(true);
    let added = 0;
    for (let i = 0; i < files.length; i++) {
      try {
        const up = await api.uploadSticker(files[i]);
        await api.createSticker(activePackId, up.file_url, up.file_name, i);
        added += 1;
      } catch (e: any) {
        toast.error(e?.message || "Стикер не загрузился");
      }
    }
    if (added) {
      toast.success(`Добавлено: ${added}`);
      setStickers((await api.getStickers(activePackId)) || []);
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const createPack = async () => {
    const name = newPackName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const pack = await api.createStickerPack(name);
      setNewPackName("");
      setCreating(false);
      await loadPacks(pack.id);
      toast.success("Набор создан — теперь добавьте стикеры");
    } catch (e: any) {
      toast.error(e?.message || "Не удалось создать набор");
    } finally {
      setBusy(false);
    }
  };

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

  const createForm = (
    <div className="flex gap-2 px-3 py-2 border-b border-border shrink-0">
      <input
        value={newPackName}
        onChange={(e) => setNewPackName(e.target.value)}
        placeholder="Название набора"
        className="flex-1 bg-secondary px-3 py-1.5 text-sm outline-none"
        autoFocus
      />
      <button
        type="button"
        onClick={createPack}
        disabled={busy || !newPackName.trim()}
        className="px-3 py-1.5 bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-40"
      >
        Создать
      </button>
      <button
        type="button"
        onClick={() => { setCreating(false); setNewPackName(""); }}
        className="px-3 py-1.5 bg-secondary text-xs"
      >
        Отмена
      </button>
    </div>
  );

  if (packs.length === 0) {
    return (
      <div className="h-64 flex flex-col">
        {creating ? createForm : null}
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-sm text-muted-foreground">Наборов пока нет</p>
          {!creating && (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold"
            >
              Создать набор
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-64 flex flex-col">
      {creating && createForm}

      {/* Полоса наборов */}
      <div className="flex gap-2 px-3 py-2 overflow-x-auto border-b border-border shrink-0">
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="px-2.5 py-1.5 bg-secondary text-muted-foreground shrink-0"
          aria-label="Новый набор"
        >
          <Plus className="w-4 h-4" />
        </button>
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

      {/* Добавление стикеров в выбранный набор */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => addFiles(e.target.files)}
      />

      {/* Сетка стикеров */}
      <div className="flex-1 overflow-y-auto p-2">
        {stickers.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-3">
            <p className="text-sm text-muted-foreground">В наборе пусто</p>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-40"
            >
              {busy ? "Загрузка…" : "Добавить стикеры"}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="aspect-square flex items-center justify-center bg-secondary text-muted-foreground disabled:opacity-40"
              aria-label="Добавить стикеры"
            >
              <Plus className="w-6 h-6" />
            </button>
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
