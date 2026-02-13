import { useState, useEffect } from "react";
import { api } from "@/api/client";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Settings } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Sticker {
  id: string;
  pack: string;
  pack_name: string;
  file_url: string;
  file_name: string;
  emoji?: string;
  order: number;
  created_at: string;
}

interface StickerPack {
  id: string;
  name: string;
  description?: string;
  author: {
    id: string;
    username: string;
  };
  is_public: boolean;
  stickers_count: number;
  is_saved: boolean;
  created_at: string;
  updated_at: string;
}

interface UserStickerPack {
  id: string;
  pack: StickerPack;
  added_at: string;
}

interface StickerPickerProps {
  onSelectSticker: (sticker: Sticker) => void;
  onManagePacks?: () => void;
}

const StickerPicker = ({ onSelectSticker, onManagePacks }: StickerPickerProps) => {
  const [myPacks, setMyPacks] = useState<UserStickerPack[]>([]);
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);
  const [stickers, setStickers] = useState<Sticker[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadMyPacks();
  }, []);

  useEffect(() => {
    if (selectedPackId) {
      loadStickers(selectedPackId);
    }
  }, [selectedPackId]);

  const loadMyPacks = async () => {
    try {
      setLoading(true);
      const packs = await api.getMyStickerPacks();
      setMyPacks(packs);
      
      // Автоматически выбираем первый пак
      if (packs.length > 0 && !selectedPackId) {
        setSelectedPackId(packs[0].pack.id);
      }
    } catch (error) {
      console.error("Failed to load sticker packs:", error);
      toast.error("Не удалось загрузить стикерпаки");
    } finally {
      setLoading(false);
    }
  };

  const loadStickers = async (packId: string) => {
    try {
      const loadedStickers = await api.getStickers(packId);
      setStickers(loadedStickers);
    } catch (error) {
      console.error("Failed to load stickers:", error);
      toast.error("Не удалось загрузить стикеры");
    }
  };

  const handleStickerClick = (sticker: Sticker) => {
    onSelectSticker(sticker);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (myPacks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 px-4 text-center">
        <p className="text-muted-foreground mb-4">У вас нет сохраненных стикерпаков</p>
        <Button onClick={onManagePacks} variant="outline" size="sm">
          <Plus className="w-4 h-4 mr-2" />
          Добавить стикерпак
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-popover text-popover-foreground">
      {/* Заголовок с кнопкой управления */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <h3 className="font-semibold text-foreground">Стикеры</h3>
        <Button
          onClick={onManagePacks}
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
        >
          <Settings className="w-4 h-4" />
        </Button>
      </div>

      {/* Tabs для паков */}
      <Tabs value={selectedPackId || undefined} onValueChange={setSelectedPackId} className="flex-1 flex flex-col">
        <TabsList className="w-full justify-start overflow-x-auto px-2 py-1 bg-muted">
          {myPacks.map((userPack) => (
            <TabsTrigger 
              key={userPack.pack.id} 
              value={userPack.pack.id}
              className="text-xs px-3 data-[state=active]:bg-background data-[state=active]:text-foreground"
            >
              {userPack.pack.name}
            </TabsTrigger>
          ))}
        </TabsList>

        {myPacks.map((userPack) => (
          <TabsContent 
            key={userPack.pack.id} 
            value={userPack.pack.id}
            className="flex-1 mt-0"
          >
            <ScrollArea className="h-64 bg-background/50">
              {stickers.length === 0 ? (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                  В этом паке пока нет стикеров
                </div>
              ) : (
                <div className="grid grid-cols-4 gap-2 p-2">
                  {stickers.map((sticker) => (
                    <button
                      key={sticker.id}
                      onClick={() => handleStickerClick(sticker)}
                      className={cn(
                        "aspect-square rounded-lg overflow-hidden",
                        "border-2 border-border hover:border-primary",
                        "transition-all hover:scale-105 active:scale-95",
                        "bg-muted/30 hover:bg-muted/50"
                      )}
                    >
                      <img
                        src={sticker.file_url}
                        alt={sticker.file_name}
                        className="w-full h-full object-contain"
                      />
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
};

export default StickerPicker;
