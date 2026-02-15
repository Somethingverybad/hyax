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
    <div className="flex flex-col h-full max-h-[400px] bg-popover text-popover-foreground rounded-lg overflow-hidden">
      {/* Заголовок с кнопкой управления */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <h3 className="font-semibold text-sm sm:text-base text-foreground">Стикеры</h3>
        <Button
          onClick={onManagePacks}
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
        >
          <Settings className="w-3 h-3 sm:w-4 sm:h-4" />
        </Button>
      </div>

      {/* Tabs для паков */}
      <Tabs value={selectedPackId || undefined} onValueChange={setSelectedPackId} className="flex-1 flex flex-col min-h-0">
        <ScrollArea className="shrink-0 border-b border-border">
          <TabsList className="w-full justify-start h-auto px-2 py-1.5 bg-muted flex-nowrap">
            {myPacks.map((userPack) => (
              <TabsTrigger 
                key={userPack.pack.id} 
                value={userPack.pack.id}
                className="text-xs px-2 py-1 whitespace-nowrap data-[state=active]:bg-background data-[state=active]:text-foreground"
              >
                {userPack.pack.name}
              </TabsTrigger>
            ))}
          </TabsList>
        </ScrollArea>

        <div className="flex-1 min-h-0 overflow-hidden">
          {myPacks.map((userPack) => (
            <TabsContent 
              key={userPack.pack.id} 
              value={userPack.pack.id}
              className="h-full mt-0 data-[state=inactive]:hidden"
            >
              <ScrollArea className="h-full bg-background/50">
                {stickers.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-muted-foreground text-xs sm:text-sm px-4 text-center">
                    В этом паке пока нет стикеров
                  </div>
                ) : (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5 sm:gap-2 p-2">
                    {stickers.map((sticker) => (
                      <button
                        key={sticker.id}
                        onClick={() => handleStickerClick(sticker)}
                        className={cn(
                          "aspect-square rounded-lg overflow-hidden",
                          "border-2 border-border hover:border-primary active:border-primary",
                          "transition-all hover:scale-105 active:scale-95",
                          "bg-muted/30 hover:bg-muted/50"
                        )}
                      >
                        <img
                          src={sticker.file_url}
                          alt={sticker.file_name}
                          className="w-full h-full object-contain p-0.5 sm:p-1"
                          loading="lazy"
                        />
                      </button>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </TabsContent>
          ))}
        </div>
      </Tabs>
    </div>
  );
};

export default StickerPicker;
